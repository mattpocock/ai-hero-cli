import { Command as CLICommand, Options } from "@effect/cli";
import { Command } from "@effect/platform";
import {
  Config,
  ConfigProvider,
  Console,
  Data,
  Effect,
} from "effect";
import prompt from "prompts";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService, GitServiceConfig } from "../git-service.js";
import { runPrompt } from "../prompt-utils.js";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
  message: string;
}> {}

export class InvalidBranchError extends Data.TaggedError(
  "InvalidBranchError"
)<{
  branch: string;
  message: string;
}> {}

export class NoCommitsFoundError extends Data.TaggedError(
  "NoCommitsFoundError"
)<{
  mainBranch: string;
  liveBranch: string;
}> {}

export class WalkThroughCancelledError extends Data.TaggedError(
  "WalkThroughCancelledError"
) {}

export class HardResetFailedError extends Data.TaggedError(
  "HardResetFailedError"
)<{
  commitSha: string;
  message: string;
}> {}

export class UndoCommitFailedError extends Data.TaggedError(
  "UndoCommitFailedError"
)<{
  message: string;
}> {}

export class UnstageFailedError extends Data.TaggedError(
  "UnstageFailedError"
)<{
  message: string;
}> {}

const applyDemoReset = (commitSha: string) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* Console.log(`\nResetting to ${commitSha}...`);

    // Hard reset to commit
    const hardResetExitCode = yield* git.runCommandWithExitCode(
      "git",
      "reset",
      "--hard",
      commitSha
    );

    if (hardResetExitCode !== 0) {
      yield* Console.error("Failed to reset to commit");
      process.exitCode = 1;
      return yield* Effect.fail(
        new HardResetFailedError({
          commitSha,
          message: "Hard reset failed",
        })
      );
    }

    // Undo commit (move HEAD back, keep changes)
    yield* Console.log("Undoing commit...");
    const undoExitCode = yield* git.runCommandWithExitCode(
      "git",
      "reset",
      "HEAD^"
    );

    if (undoExitCode !== 0) {
      yield* Console.error("Failed to undo commit");
      process.exitCode = 1;
      return yield* Effect.fail(
        new UndoCommitFailedError({
          message: "Undo commit failed",
        })
      );
    }

    // Unstage all changes
    yield* Console.log("Unstaging changes...");
    const unstageExitCode = yield* git.runCommandWithExitCode(
      "git",
      "restore",
      "--staged",
      "."
    );

    if (unstageExitCode !== 0) {
      yield* Console.error("Failed to unstage changes");
      process.exitCode = 1;
      return yield* Effect.fail(
        new UnstageFailedError({
          message: "Unstage failed",
        })
      );
    }

    yield* Console.log(
      "✓ Commit applied with unstaged changes\n"
    );
  });

export const walkThrough = CLICommand.make(
  "walk-through",
  {
    mainBranch: Options.text("main-branch").pipe(
      Options.withDescription("Base branch to start from"),
      Options.withDefault("main")
    ),
    liveBranch: Options.text("live-branch").pipe(
      Options.withDescription(
        "Target branch with commits to walk through"
      ),
      Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
    ),
  },
  ({ liveBranch, mainBranch }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const config = yield* GitServiceConfig;

      // Validate git repo
      yield* git.ensureIsGitRepo();

      const currentBranch = yield* git.getCurrentBranch();

      // Branch safety check
      if (
        currentBranch === mainBranch ||
        currentBranch === liveBranch
      ) {
        yield* Console.log(
          `You are on ${currentBranch}. Walk-through requires a working branch.`
        );

        const { branchName } = yield* runPrompt<{
          branchName: string;
        }>(() =>
          prompt([
            {
              type: "text",
              name: "branchName",
              message: "Enter name for new working branch:",
            },
          ])
        );

        const createBranchExitCode =
          yield* git.runCommandWithExitCode(
            "git",
            "checkout",
            "-b",
            branchName
          );

        if (createBranchExitCode !== 0) {
          yield* Console.error("Failed to create branch");
          process.exitCode = 1;
          return yield* Effect.fail(
            new InvalidBranchError({
              branch: branchName,
              message: "Failed to create branch",
            })
          );
        }

        yield* Console.log(
          `✓ Created and switched to ${branchName}`
        );
      } else {
        // Check for uncommitted changes
        const { hasUncommittedChanges, statusOutput } =
          yield* git.getUncommittedChanges();

        if (hasUncommittedChanges) {
          yield* Console.log(
            "\nWarning: You have uncommitted changes:"
          );
          yield* Console.log(statusOutput);

          const { confirm } = yield* runPrompt<{
            confirm: boolean;
          }>(() =>
            prompt([
              {
                type: "confirm",
                name: "confirm",
                message:
                  "This will lose all uncommitted work. Continue?",
                initial: false,
              },
            ])
          );

          if (!confirm) {
            return yield* Effect.fail(
              new WalkThroughCancelledError()
            );
          }
        }
      }

      // Retrieve commits
      yield* Console.log(
        `\nRetrieving commits between ${mainBranch} and ${liveBranch}...`
      );

      const gitLogCommand = Command.make(
        "git",
        "log",
        "--oneline",
        "--reverse",
        `${mainBranch}..${liveBranch}`
      ).pipe(Command.workingDirectory(config.cwd));

      const commitHistory = yield* Command.string(gitLogCommand);

      type WalkThroughCommit = {
        sha: string;
        message: string;
        index: number;
      };

      const commits: Array<WalkThroughCommit> = commitHistory
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line, index) => {
          const [sha, ...messageParts] = line.split(" ");
          const message = messageParts.join(" ");
          return {
            sha: sha!,
            message,
            index,
          };
        });

      if (commits.length === 0) {
        return yield* Effect.fail(
          new NoCommitsFoundError({ mainBranch, liveBranch })
        );
      }

      yield* Console.log(
        `\nFound ${commits.length} commits to walk through\n`
      );

      // Interactive walk-through loop
      let cancelled = false;

      for (const commit of commits) {
        const commitNumber = commit.index + 1;

        yield* Console.log("=".repeat(60));
        yield* Console.log(
          `Commit ${commitNumber}/${commits.length}: ${commit.sha}`
        );
        yield* Console.log(`Message: ${commit.message}`);
        yield* Console.log("=".repeat(60));

        // Apply demo reset
        yield* applyDemoReset(commit.sha);

        // Prompt for continuation
        const { action } = yield* runPrompt<{
          action: "continue" | "cancel";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "action",
              message: `Commit ${commitNumber}/${commits.length} applied. Next?`,
              choices: [
                {
                  title: "Continue to next commit",
                  value: "continue",
                },
                {
                  title: "Cancel walk-through",
                  value: "cancel",
                },
              ],
            },
          ])
        );

        if (action === "cancel") {
          cancelled = true;
          break;
        }
      }

      // Cleanup
      yield* Console.log("\n" + "=".repeat(60));
      yield* Console.log(
        cancelled
          ? "Walk-through cancelled"
          : "Walk-through completed!"
      );
      yield* Console.log(`Returning to ${liveBranch}...`);

      const finalResetExitCode =
        yield* git.runCommandWithExitCode(
          "git",
          "reset",
          "--hard",
          liveBranch
        );

      if (finalResetExitCode !== 0) {
        yield* Console.error(
          `Failed to return to ${liveBranch}`
        );
        process.exitCode = 1;
        return yield* Effect.succeed(void 0);
      }

      yield* Console.log(`✓ Returned to ${liveBranch}`);
      yield* Console.log("=".repeat(60));
    }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd: process.cwd(),
        })
      ),
      Effect.catchTags({
        PromptCancelledError: () => {
          process.exitCode = 0;
          return Effect.succeed(void 0);
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
    "Walk through commits between branches with demo-style resets"
  )
);
