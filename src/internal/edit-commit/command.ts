import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Data, Effect, Option } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  CommitNotFoundError,
  resolveCommitRef,
  selectCommit,
} from "../../branch-commits.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../../constants.js";
import { PromptService } from "../../prompt-service.js";
import {
  applyToLiveBranch,
  beginSession,
  conflictedFiles,
  filesWithMarkers,
  finish,
  loadCommits,
  NotAGitRepoError,
  publish,
  recompose,
  resumeCherryPick,
  unwind,
} from "./session.js";

export class NotATtyError extends Data.TaggedError(
  "NotATtyError"
) {}

/**
 * The stage the session has reached, which decides how a cancellation unwinds.
 *
 *   editing  -> the target's diff is in the working tree, uncommitted.
 *   conflict -> a cherry-pick has stopped; resolved files are uncommitted.
 *   composed -> everything is committed on the temp branch.
 *   applied  -> the live branch has been moved onto the temp branch.
 */
type Stage = "editing" | "conflict" | "composed" | "applied";

const commitOption = Options.text("commit").pipe(
  Options.withAlias("c"),
  Options.withDescription(
    "Lesson to edit: a lesson id (slug or numeric) or a SHA prefix. Omit to pick from a list."
  ),
  Options.optional
);

const branchOption = Options.text("branch").pipe(
  Options.withDescription("The live branch holding the commits"),
  Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
);

const mainBranchOption = Options.text("main-branch").pipe(
  Options.withDescription("The base branch of the project"),
  Options.withDefault("main")
);

/**
 * Walk the cherry-pick conflict loop until it clears or the user aborts.
 * Returns false when the user chose to abort the whole session.
 *
 * Written as a loop rather than a recursive effect so the error and
 * requirement channels stay inferred.
 */
const resolveConflicts = Effect.gen(function* () {
  const prompts = yield* PromptService;

  while (true) {
    const files = yield* conflictedFiles;
    yield* Console.log("\n⚠️  Cherry-pick conflict:");
    for (const file of files) {
      yield* Console.log(`   ${file}`);
    }

    const action =
      yield* prompts.selectCherryPickConflictAction();

    if (action === "abort") {
      return false;
    }

    // Never take "continue" on trust — a committed `<<<<<<<` surfaces later as
    // a broken exercise for students rather than immediately for the author.
    const stillMarked = yield* filesWithMarkers;
    if (stillMarked.length > 0) {
      yield* Console.log(
        "\nThese files still contain conflict markers:"
      );
      for (const file of stillMarked) {
        yield* Console.log(`   ${file}`);
      }
      continue;
    }

    const result = yield* resumeCherryPick;
    if (result.conflict) {
      continue;
    }

    yield* Console.log("✓ Cherry-pick complete");
    return true;
  }
});

export const editCommit = CLICommand.make(
  "edit-commit",
  {
    commit: commitOption,
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  ({ branch: liveBranch, commit, mainBranch }) =>
    Effect.gen(function* () {
      const cwd = process.cwd();
      const prompts = yield* PromptService;

      if (!existsSync(path.join(cwd, ".git"))) {
        return yield* new NotAGitRepoError({ path: cwd });
      }

      // This command is interactive by design. Rather than silently degrading
      // into a non-interactive mode, refuse — a caller without a TTY is
      // reaching for something this command no longer offers.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return yield* new NotATtyError();
      }

      const commits = yield* loadCommits({
        branch: liveBranch,
        mainBranch,
      });

      // Resolve the target before touching any branch, so a bad reference
      // can't strand a temp branch.
      const target = Option.isSome(commit)
        ? (resolveCommitRef(commits, commit.value) ??
          (yield* new CommitNotFoundError({
            commit: commit.value,
          })))
        : yield* selectCommit({
            commits,
            promptMessage:
              "Which lesson do you want to edit? (type to search)",
          });

      const label = target.lessonId ?? target.sha;
      const session = yield* beginSession({
        commits,
        target,
        liveBranch,
      });

      let stage: Stage = "editing";

      const body = Effect.gen(function* () {
        yield* Console.log(
          `Editing ${label} on ${session.tempBranch}`
        );
        yield* Console.log(
          session.following === 0
            ? `No commits follow ${label}.`
            : `Will replay ${session.following} commit${
                session.following === 1 ? "" : "s"
              } after it.`
        );
        yield* Console.log(
          "\nSession active. Make your changes — ALL unstaged changes go into the commit."
        );

        yield* prompts.confirmReadyToCommit();

        yield* Console.log(
          `Committing with original message: "${session.target.message}"`
        );
        const result = yield* recompose(session);

        if (result.conflict) {
          stage = "conflict";
          const resolved = yield* resolveConflicts;
          if (!resolved) {
            yield* Console.log("Aborting session…");
            const { discardedFiles } = yield* unwind(session, {
              midCherryPick: true,
              liveBranchMoved: false,
              keepTempBranch: false,
            });
            yield* Console.log(
              `✓ Restored ${session.originalBranch}; discarded ${discardedFiles.length} path(s)`
            );
            return;
          }
        }

        stage = "composed";
        yield* Console.log(`\n✓ ${label} updated`);

        yield* prompts.confirmSaveToTargetBranch(liveBranch);
        yield* applyToLiveBranch(session);
        stage = "applied";
        yield* Console.log(
          `✓ ${liveBranch} updated with your changes`
        );

        yield* prompts.confirmForcePush(liveBranch);
        yield* publish(session);
        yield* Console.log(
          `✓ Pushed ${liveBranch} to origin`
        );

        yield* finish(session);
        yield* Console.log(
          `✓ Switched back to ${session.originalBranch}`
        );
      });

      /**
       * Cancelling a prompt unwinds in-process. Before the edits are committed
       * we ask first, because the unwind throws away hand-written work; once
       * they're committed we unwind silently but keep the temp branch, so
       * backing out of a push never costs you the edit.
       */
      const onCancel = Effect.gen(function* () {
        if (stage === "editing" || stage === "conflict") {
          const discard = yield* prompts.confirmDiscardChanges(
            session.tempBranch
          );

          if (!discard) {
            yield* Console.log(
              `Cancelled. Your changes are on ${session.tempBranch}.`
            );
            return;
          }

          const { discardedFiles } = yield* unwind(session, {
            midCherryPick: stage === "conflict",
            liveBranchMoved: false,
            keepTempBranch: false,
          });
          yield* Console.log(
            `✓ Restored ${session.originalBranch}; discarded ${discardedFiles.length} path(s)`
          );
          return;
        }

        yield* unwind(session, {
          midCherryPick: false,
          liveBranchMoved: stage === "applied",
          keepTempBranch: true,
        });
        yield* Console.log(
          `Cancelled. Your recomposed branch is ${session.tempBranch}.`
        );
      });

      yield* body.pipe(
        Effect.catchTag("PromptCancelledError", () => onCancel),
        // A hard interrupt can't prompt, so leave everything alone and print
        // the breadcrumb needed to find the work again.
        Effect.onInterrupt(() =>
          Console.log(
            `\nInterrupted. Your session is on ${session.tempBranch}.`
          )
        )
      );
    }).pipe(
      Effect.catchTags({
        NotAGitRepoError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(
              `Error: not a git repository: ${error.path}`
            );
            process.exitCode = 1;
          }),
        NotATtyError: () =>
          Effect.gen(function* () {
            yield* Console.error(
              "Error: `edit-commit` is interactive and needs a TTY."
            );
            process.exitCode = 1;
          }),
        NoCommitsFoundError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(
              `Error: No commits found on ${error.liveBranch} beyond ${error.mainBranch}`
            );
            process.exitCode = 1;
          }),
        CommitNotFoundError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(
              `Error: No lesson matching "${error.commit}"`
            );
            process.exitCode = 1;
          }),
        PromptCancelledError: () =>
          Effect.gen(function* () {
            yield* Console.log("Cancelled.");
          }),
      }),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Console.error(`Unexpected error: ${error}`);
          process.exitCode = 1;
        })
      )
    )
).pipe(
  CLICommand.withDescription(
    "Interactively edit a lesson commit and replay the commits after it"
  )
);
