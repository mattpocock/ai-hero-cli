import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import prompt from "prompts";
import { selectLessonCommit } from "../commit-utils.js";
import type { PromptCancelledError } from "../prompt-utils.js";
import { runPrompt } from "../prompt-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService } from "../git-service.js";
import type { CommandExecutor } from "@effect/platform";
import type {
  BadArgument,
  SystemError,
} from "@effect/platform/Error";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
  message: string;
}> {}

export class NoFollowingCommitsError extends Data.TaggedError(
  "NoFollowingCommitsError"
)<{
  message: string;
}> {}

export class CommitFailedError extends Data.TaggedError(
  "CommitFailedError"
)<{
  message: string;
}> {}

export const editCommit = CLICommand.make(
  "edit-commit",
  {
    lessonId: Args.text({ name: "lesson-id" }).pipe(
      Args.optional
    ),
    branch: Options.text("branch").pipe(
      Options.withDescription(
        "Branch to search for the lesson commit"
      ),
      Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
    ),
  },
  ({ branch, lessonId }) =>
    Effect.gen(function* () {
      const cwd = process.cwd();
      const gitService = yield* GitService;

      // Validate git repository
      const gitDirPath = path.join(cwd, ".git");
      if (!existsSync(gitDirPath)) {
        return yield* Effect.fail(
          new NotAGitRepoError({
            path: cwd,
            message: `Current directory is not a git repository: ${cwd}`,
          })
        );
      }

      // Fetch origin
      const fetchResult = yield* gitService.fetchOrigin().pipe(
        Effect.catchTag("FailedToFetchOriginError", () =>
          Effect.succeed({ failed: true as const })
        ),
        Effect.map(() => ({ failed: false as const }))
      );

      if (fetchResult.failed) {
        yield* Console.error("Failed to fetch branch");
        process.exitCode = 1;
        return;
      }

      // Get current branch name
      const currentBranch = yield* gitService.getCurrentBranch();

      // Check if current branch is the target branch
      if (currentBranch === branch) {
        yield* Console.error(
          `Error: Cannot edit commit on target branch "${branch}". Switch to a different branch first.`
        );
        process.exitCode = 1;
        return;
      }

      // Select lesson commit
      const {
        commit: targetCommit,
        lessonId: selectedLessonId,
      } = yield* selectLessonCommit({
        branch,
        lessonId,
        promptMessage:
          "Which lesson do you want to edit? (type to search)",
        excludeCurrentBranch: false,
      });

      // Store original commit message with lesson ID prefix
      const originalMessage = `${selectedLessonId} ${targetCommit.message}`;
      const targetSha = targetCommit.sha;

      // Get HEAD of target branch to know what to cherry-pick
      const targetBranchHead = yield* gitService.revParse(
        `origin/${branch}`
      );

      // Count following commits on target branch
      const followingCommitCount =
        yield* gitService.revListCount(
          targetSha,
          `origin/${branch}`
        );

      if (followingCommitCount === 0) {
        yield* Console.log(
          `Warning: No commits after ${selectedLessonId}. You can still edit this commit.`
        );
      } else {
        yield* Console.log(
          `Will reset to ${selectedLessonId}. Will cherry-pick ${followingCommitCount} commit${
            followingCommitCount === 1 ? "" : "s"
          } after.`
        );
      }

      // Reset to target commit
      yield* Console.log(
        `Resetting to ${targetSha} (${selectedLessonId})...`
      );

      const resetResult = yield* gitService
        .resetHard(targetSha)
        .pipe(
          Effect.catchTag("FailedToResetError", () =>
            Effect.succeed({ failed: true as const })
          ),
          Effect.map(() => ({ failed: false as const }))
        );

      if (resetResult.failed) {
        yield* Console.error("Failed to reset");
        process.exitCode = 1;
        return;
      }

      // Demo mode: undo commit and unstage changes
      yield* Console.log(
        "Undoing commit and unstaging changes..."
      );

      yield* gitService.resetHead();
      yield* gitService.restoreStaged();

      yield* Console.log(
        "✓ Reset complete with unstaged changes"
      );
      yield* Console.log(
        "\nSession active. Make your changes to the code. ALL unstaged changes will be added to the commit."
      );

      // Wait for user to be ready
      const { ready } = yield* runPrompt<{ ready: boolean }>(
        () =>
          prompt([
            {
              type: "confirm",
              name: "ready",
              message: "Ready to commit?",
              initial: true,
            },
          ])
      );

      if (!ready) {
        yield* Console.log(
          "Session cancelled. Branch left as-is."
        );
        return;
      }

      // Commit with original message
      yield* Console.log(
        `Committing with original message: "${originalMessage}"`
      );

      // Add all files and commit
      yield* gitService.stageAll();

      const commitResult = yield* gitService
        .commit(originalMessage)
        .pipe(
          Effect.catchTag("FailedToCommitError", () =>
            Effect.succeed({ failed: true as const })
          ),
          Effect.map(() => ({ failed: false as const }))
        );

      if (commitResult.failed) {
        return yield* Effect.fail(
          new CommitFailedError({
            message:
              "Failed to commit. You may have no changes to commit.",
          })
        );
      }

      yield* Console.log("✓ Commit complete");

      // Cherry-pick following commits if any
      if (followingCommitCount > 0) {
        yield* Console.log(
          `\nCherry-picking ${followingCommitCount} commit${
            followingCommitCount === 1 ? "" : "s"
          }...`
        );

        // Use range cherry-pick: targetSha..origin/branch
        // This excludes targetSha and includes all commits on target branch
        const cherryPickResult = yield* gitService
          .cherryPick(`${targetSha}..${targetBranchHead}`)
          .pipe(
            Effect.catchTag("CherryPickConflictError", () =>
              Effect.succeed({ conflict: true as const })
            ),
            Effect.map(() => ({ conflict: false as const }))
          );

        if (cherryPickResult.conflict) {
          // Conflict detected
          yield* Console.log(
            "\n⚠️  Cherry-pick conflict detected!"
          );
          yield* Console.log(
            "Resolve conflicts, then continue.\n"
          );

          // Enter conflict resolution loop
          yield* resolveConflictLoop(gitService);
        } else {
          yield* Console.log("✓ Cherry-pick complete");
        }
      }

      yield* Console.log(
        `\n✓ Edit complete! Lesson ${selectedLessonId} updated.`
      );

      // Prompt to save changes to target branch
      const { saveToTarget } = yield* runPrompt<{
        saveToTarget: boolean;
      }>(() =>
        prompt([
          {
            type: "confirm",
            name: "saveToTarget",
            message: `Save changes to ${branch} branch?`,
            initial: true,
          },
        ])
      );

      if (!saveToTarget) {
        yield* Console.log(
          `Changes kept on ${currentBranch}. Session complete.`
        );
        return;
      }

      // Checkout target branch and reset to current branch
      yield* Console.log(
        `Switching to ${branch} and applying changes...`
      );

      const checkoutResult = yield* gitService
        .checkout(branch)
        .pipe(
          Effect.catchTag("FailedToCheckoutError", () =>
            Effect.succeed({ failed: true as const })
          ),
          Effect.map(() => ({ failed: false as const }))
        );

      if (checkoutResult.failed) {
        yield* Console.error(
          `Failed to checkout ${branch}. Changes remain on ${currentBranch}.`
        );
        process.exitCode = 1;
        return;
      }

      const resetToCurrentResult = yield* gitService
        .resetHard(currentBranch)
        .pipe(
          Effect.catchTag("FailedToResetError", () =>
            Effect.succeed({ failed: true as const })
          ),
          Effect.map(() => ({ failed: false as const }))
        );

      if (resetToCurrentResult.failed) {
        yield* Console.error(
          `Failed to reset ${branch} to ${currentBranch}.`
        );
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `✓ ${branch} updated with your changes`
      );

      // Prompt to force push
      const { forcePush } = yield* runPrompt<{
        forcePush: boolean;
      }>(() =>
        prompt([
          {
            type: "confirm",
            name: "forcePush",
            message: `Force push ${branch} to origin?`,
            initial: false,
          },
        ])
      );

      if (!forcePush) {
        yield* Console.log(
          "Local changes saved. Session complete."
        );
        return;
      }

      // Force push to origin
      yield* Console.log(`Force pushing ${branch} to origin...`);

      const forcePushResult = yield* gitService
        .pushForceWithLease("origin", branch)
        .pipe(
          Effect.catchTag("FailedToPushError", () =>
            Effect.succeed({ failed: true as const })
          ),
          Effect.map(() => ({ failed: false as const }))
        );

      if (forcePushResult.failed) {
        yield* Console.error("Failed to force push");
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `✓ Successfully pushed ${branch} to origin`
      );

      // Go back to the original branch
      yield* Console.log(
        `Switching back to ${currentBranch}...`
      );
      yield* gitService
        .checkout(currentBranch)
        .pipe(
          Effect.catchTag(
            "FailedToCheckoutError",
            () => Effect.void
          )
        );

      yield* Console.log(`✓ Switched back to ${currentBranch}`);
    }).pipe(
      Effect.catchTags({
        NotAGitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        CommitNotFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: No commit found for lesson ${error.lessonId} on branch ${error.branch}`
            );
            process.exitCode = 1;
          });
        },
        PromptCancelledError: () => {
          return Effect.gen(function* () {
            yield* Console.log(
              "Operation cancelled. Branch left as-is."
            );
            process.exitCode = 0;
          });
        },
        CommitFailedError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
      }),
      Effect.catchAll((error) => {
        return Effect.gen(function* () {
          yield* Console.error(`Unexpected error: ${error}`);
          process.exitCode = 1;
        });
      })
    )
).pipe(
  CLICommand.withDescription(
    "Edit a commit and cherry-pick following commits"
  )
);

// Recursive conflict resolution loop
function resolveConflictLoop(
  gitService: GitService
): Effect.Effect<
  void,
  PromptCancelledError | BadArgument | SystemError,
  CommandExecutor.CommandExecutor
> {
  return Effect.gen(function* () {
    // Show git status
    const status = yield* gitService.getStatusShort();
    if (status) {
      yield* Console.log(status);
    }

    // Prompt user with options
    const { action } = yield* runPrompt<{
      action: "continue" | "abort" | "skip";
    }>(() =>
      prompt([
        {
          type: "select",
          name: "action",
          message:
            "Cherry-pick conflict. What do you want to do?",
          choices: [
            {
              title: "Continue (run git cherry-pick --continue)",
              value: "continue",
              description:
                "Continue cherry-pick after resolving conflicts",
            },
            {
              title:
                "Skip (already resolved in another session)",
              value: "skip",
              description:
                "Skip running git command, conflicts already resolved",
            },
            {
              title: "Abort (stop cherry-pick)",
              value: "abort",
              description: "Abort the cherry-pick process",
            },
          ],
        },
      ])
    );

    if (action === "abort") {
      yield* Console.log(
        "Cherry-pick aborted. Branch left as-is."
      );

      yield* gitService.cherryPickAbort();
      return;
    }

    if (action === "skip") {
      yield* Console.log("✓ Skipping git command");
      return;
    }

    // Continue cherry-pick
    const continueResult = yield* gitService
      .cherryPickContinue()
      .pipe(
        Effect.catchTag("CherryPickConflictError", () =>
          Effect.succeed({ conflict: true as const })
        ),
        Effect.map(() => ({ conflict: false as const }))
      );

    if (continueResult.conflict) {
      // Another conflict
      yield* Console.log(
        "\n⚠️  Another conflict detected during cherry-pick!"
      );
      yield* Console.log("Resolve conflicts, then continue.\n");
      // Recursive call
      yield* resolveConflictLoop(gitService);
    } else {
      yield* Console.log("✓ Cherry-pick complete");
    }
  });
}
