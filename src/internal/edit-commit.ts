import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  getCommitsBetweenBranches,
  selectCommit,
} from "../branch-commits.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService } from "../git-service.js";
import {
  type PromptCancelledError,
  PromptService,
} from "../prompt-service.js";
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
    branch: Options.text("branch").pipe(
      Options.withDescription("Branch to get commits from"),
      Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
    ),
    mainBranch: Options.text("main-branch").pipe(
      Options.withDescription("The main branch of the project"),
      Options.withDefault("main")
    ),
  },
  ({ branch: liveBranch, mainBranch }) =>
    Effect.gen(function* () {
      const cwd = process.cwd();
      const gitService = yield* GitService;
      const promptService = yield* PromptService;

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
        Effect.map(() => ({ failed: false as const })),
        Effect.catchTag("FailedToFetchOriginError", () =>
          Effect.succeed({ failed: true as const })
        )
      );

      if (fetchResult.failed) {
        yield* Console.error("Failed to fetch branch");
        process.exitCode = 1;
        return;
      }

      // Get current branch name
      const originalBranch =
        yield* gitService.getCurrentBranch();

      // Create temporary branch for edit-commit work
      const tempBranchName = `matt/edit-commit-${Date.now()}`;
      yield* Console.log(
        `Creating temporary branch: ${tempBranchName}`
      );

      const createBranchResult = yield* gitService
        .checkoutNewBranch(tempBranchName)
        .pipe(
          Effect.map(() => ({ failed: false as const })),
          Effect.catchTag("FailedToCreateBranchError", () =>
            Effect.succeed({ failed: true as const })
          )
        );

      if (createBranchResult.failed) {
        yield* Console.error(
          `Failed to create temporary branch "${tempBranchName}". A branch with this name may already exist.`
        );
        process.exitCode = 1;
        return;
      }

      // Get commits between main and live branch
      const commits = yield* getCommitsBetweenBranches({
        mainBranch,
        liveBranch,
      });

      // Select commit to edit
      const targetCommit = yield* selectCommit({
        commits,
        promptMessage:
          "Which commit do you want to edit? (type to search)",
      });

      // Store original commit message
      const originalMessage = targetCommit.message;
      const targetSha = targetCommit.sha;
      const commitLabel = `#${targetCommit.sequence}`;

      // Get HEAD of target branch to know what to cherry-pick
      const targetBranchHead = yield* gitService.revParse(
        liveBranch
      );

      // Count following commits on target branch
      const followingCommitCount =
        yield* gitService.revListCount(targetSha, liveBranch);

      if (followingCommitCount === 0) {
        yield* Console.log(
          `Warning: No commits after ${commitLabel}. You can still edit this commit.`
        );
      } else {
        yield* Console.log(
          `Will reset to ${commitLabel}. Will cherry-pick ${followingCommitCount} commit${
            followingCommitCount === 1 ? "" : "s"
          } after.`
        );
      }

      // Reset to target commit
      yield* Console.log(
        `Resetting to ${targetSha} (${commitLabel})...`
      );

      const resetResult = yield* gitService
        .resetHard(targetSha)
        .pipe(
          Effect.map(() => ({ failed: false as const })),
          Effect.catchTag("FailedToResetError", () =>
            Effect.succeed({ failed: true as const })
          )
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
      yield* promptService.confirmReadyToCommit();

      // Commit with original message
      yield* Console.log(
        `Committing with original message: "${originalMessage}"`
      );

      // Add all files and commit
      yield* gitService.stageAll();

      const commitResult = yield* gitService
        .commit(originalMessage)
        .pipe(
          Effect.map(() => ({ failed: false as const })),
          Effect.catchTag("FailedToCommitError", () =>
            Effect.succeed({ failed: true as const })
          )
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
            Effect.map(() => ({ conflict: false as const })),
            Effect.catchTag("CherryPickConflictError", () =>
              Effect.succeed({ conflict: true as const })
            )
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
          yield* resolveConflictLoop(gitService, promptService);
        } else {
          yield* Console.log("✓ Cherry-pick complete");
        }
      }

      yield* Console.log(
        `\n✓ Edit complete! Commit ${commitLabel} updated.`
      );

      // Prompt to save changes to target branch
      yield* promptService.confirmSaveToTargetBranch(liveBranch);

      // Checkout target branch and reset to current branch
      yield* Console.log(
        `Switching to ${liveBranch} and applying changes...`
      );

      const checkoutResult = yield* gitService
        .checkout(liveBranch)
        .pipe(
          Effect.map(() => ({ failed: false as const })),
          Effect.catchTag("FailedToCheckoutError", () =>
            Effect.succeed({ failed: true as const })
          )
        );

      if (checkoutResult.failed) {
        yield* Console.error(
          `Failed to checkout ${liveBranch}. Changes remain on ${tempBranchName}.`
        );
        process.exitCode = 1;
        return;
      }

      const resetToCurrentResult = yield* gitService
        .resetHard(tempBranchName)
        .pipe(
          Effect.map(() => ({ failed: false as const })),
          Effect.catchTag("FailedToResetError", () =>
            Effect.succeed({ failed: true as const })
          )
        );

      if (resetToCurrentResult.failed) {
        yield* Console.error(
          `Failed to reset ${liveBranch} to ${tempBranchName}.`
        );
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `✓ ${liveBranch} updated with your changes`
      );

      // Prompt to force push
      yield* promptService.confirmForcePush(liveBranch);

      // Force push to origin
      yield* Console.log(
        `Force pushing ${liveBranch} to origin...`
      );

      const forcePushResult = yield* gitService
        .pushForceWithLease("origin", liveBranch)
        .pipe(
          Effect.map(() => ({ failed: false as const })),
          Effect.catchTag("FailedToPushError", () =>
            Effect.succeed({ failed: true as const })
          )
        );

      if (forcePushResult.failed) {
        yield* Console.error("Failed to force push");
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `✓ Successfully pushed ${liveBranch} to origin`
      );

      // Go back to the original branch
      yield* Console.log(
        `Switching back to ${originalBranch}...`
      );
      yield* gitService
        .checkout(originalBranch)
        .pipe(
          Effect.catchTag(
            "FailedToCheckoutError",
            () => Effect.void
          )
        );

      yield* Console.log(`✓ Switched back to ${originalBranch}`);

      // Delete temporary branch
      yield* Console.log(
        `Deleting temporary branch ${tempBranchName}...`
      );
      yield* gitService
        .deleteBranch(tempBranchName)
        .pipe(
          Effect.catchTag(
            "FailedToDeleteBranchError",
            () => Effect.void
          )
        );

      yield* Console.log(`✓ Deleted temporary branch`);
    }).pipe(
      Effect.catchTags({
        NotAGitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        NoCommitsFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: No commits found on ${error.liveBranch} beyond ${error.mainBranch}`
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
  gitService: GitService,
  promptService: PromptService
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
    const action =
      yield* promptService.selectCherryPickConflictAction();

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
        Effect.map(() => ({ conflict: false as const })),
        Effect.catchTag("CherryPickConflictError", () =>
          Effect.succeed({ conflict: true as const })
        )
      );

    if (continueResult.conflict) {
      // Another conflict
      yield* Console.log(
        "\n⚠️  Another conflict detected during cherry-pick!"
      );
      yield* Console.log("Resolve conflicts, then continue.\n");
      // Recursive call
      yield* resolveConflictLoop(gitService, promptService);
    } else {
      yield* Console.log("✓ Cherry-pick complete");
    }
  });
}
