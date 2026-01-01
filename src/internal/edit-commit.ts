import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import prompt from "prompts";
import { selectLessonCommit } from "../commit-utils.js";
import type { PromptCancelledError } from "../prompt-utils.js";
import { runPrompt } from "../prompt-utils.js";
import type {
  BadArgument,
  SystemError,
} from "@effect/platform/Error";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService } from "../git-service.js";

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

export class CherryPickConflictError extends Data.TaggedError(
  "CherryPickConflictError"
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
        cwd,
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
      const followingCommitCount = yield* gitService.revListCount(
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

      const resetCommand = Command.make(
        "git",
        "reset",
        "--hard",
        targetSha
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const resetExitCode = yield* Command.exitCode(
        resetCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (resetExitCode !== 0) {
        yield* Console.error("Failed to reset");
        process.exitCode = 1;
        return;
      }

      // Demo mode: undo commit and unstage changes
      yield* Console.log(
        "Undoing commit and unstaging changes..."
      );

      const undoCommand = Command.make(
        "git",
        "reset",
        "HEAD^"
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const undoExitCode = yield* Command.exitCode(
        undoCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (undoExitCode !== 0) {
        yield* Console.error("Failed to undo commit");
        process.exitCode = 1;
        return;
      }

      const unstageCommand = Command.make(
        "git",
        "restore",
        "--staged",
        "."
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const unstageExitCode = yield* Command.exitCode(
        unstageCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (unstageExitCode !== 0) {
        yield* Console.error("Failed to unstage changes");
        process.exitCode = 1;
        return;
      }

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

      // Add all files
      const addCommand = Command.make("git", "add", ".").pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const addExitCode = yield* Command.exitCode(
        addCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (addExitCode !== 0) {
        yield* Console.error("Failed to add files");
        process.exitCode = 1;
        return;
      }

      const commitCommand = Command.make(
        "git",
        "commit",
        "-m",
        originalMessage
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const commitExitCode = yield* Command.exitCode(
        commitCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (commitExitCode !== 0) {
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
        const cherryPickCommand = Command.make(
          "git",
          "cherry-pick",
          `${targetSha}..${targetBranchHead}`
        ).pipe(
          Command.workingDirectory(cwd),
          Command.stdout("inherit"),
          Command.stderr("inherit")
        );

        const cherryPickExitCode = yield* Command.exitCode(
          cherryPickCommand
        ).pipe(Effect.catchAll(() => Effect.succeed(1)));

        if (cherryPickExitCode !== 0) {
          // Conflict detected
          yield* Console.log(
            "\n⚠️  Cherry-pick conflict detected!"
          );
          yield* Console.log(
            "Resolve conflicts, then continue.\n"
          );

          // Enter conflict resolution loop
          yield* resolveConflictLoop(cwd);
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

      const checkoutTargetCommand = Command.make(
        "git",
        "checkout",
        branch
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const checkoutExitCode = yield* Command.exitCode(
        checkoutTargetCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (checkoutExitCode !== 0) {
        yield* Console.error(
          `Failed to checkout ${branch}. Changes remain on ${currentBranch}.`
        );
        process.exitCode = 1;
        return;
      }

      const resetToCurrentCommand = Command.make(
        "git",
        "reset",
        "--hard",
        currentBranch
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const resetToCurrentExitCode = yield* Command.exitCode(
        resetToCurrentCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (resetToCurrentExitCode !== 0) {
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

      const forcePushCommand = Command.make(
        "git",
        "push",
        "origin",
        branch,
        "--force-with-lease"
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const forcePushExitCode = yield* Command.exitCode(
        forcePushCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (forcePushExitCode !== 0) {
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
      const switchBackCommand = Command.make(
        "git",
        "checkout",
        currentBranch
      ).pipe(Command.workingDirectory(cwd));
      yield* Command.exitCode(switchBackCommand);

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
  cwd: string
): Effect.Effect<
  void,
  BadArgument | PromptCancelledError | SystemError,
  CommandExecutor | GitService
> {
  return Effect.gen(function* () {
    const gitService = yield* GitService;

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

      // Abort the cherry-pick
      const abortCommand = Command.make(
        "git",
        "cherry-pick",
        "--abort"
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      yield* Command.exitCode(abortCommand);
      return;
    }

    if (action === "skip") {
      yield* Console.log("✓ Skipping git command");
      return;
    }

    // Continue cherry-pick
    const continueCommand = Command.make(
      "git",
      "cherry-pick",
      "--continue"
    ).pipe(
      Command.workingDirectory(cwd),
      Command.stdout("inherit"),
      Command.stderr("inherit")
    );

    const continueExitCode = yield* Command.exitCode(
      continueCommand
    ).pipe(Effect.catchAll(() => Effect.succeed(1)));

    if (continueExitCode !== 0) {
      // Another conflict
      yield* Console.log(
        "\n⚠️  Another conflict detected during cherry-pick!"
      );
      yield* Console.log("Resolve conflicts, then continue.\n");
      // Recursive call
      yield* resolveConflictLoop(cwd);
    } else {
      yield* Console.log("✓ Cherry-pick complete");
    }
  });
}
