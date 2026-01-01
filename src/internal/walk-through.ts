import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService, GitServiceConfig } from "../git-service.js";
import { PromptService } from "../prompt-service.js";

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

const applyDemoReset = (commitSha: string) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* Console.log(`\nResetting to ${commitSha}...`);

    // Hard reset to commit
    yield* git.resetHard(commitSha).pipe(
      Effect.catchTag("FailedToResetError", () => {
        process.exitCode = 1;
        return Effect.fail(
          new HardResetFailedError({
            commitSha,
            message: "Hard reset failed",
          })
        );
      })
    );

    // Undo commit (move HEAD back, keep changes)
    yield* Console.log("Undoing commit...");
    yield* git.resetHead();

    // Unstage all changes
    yield* Console.log("Unstaging changes...");
    yield* git.restoreStaged();

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
      const promptService = yield* PromptService;

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

        const branchName =
          yield* promptService.inputBranchName("working");

        yield* git.checkoutNewBranch(branchName).pipe(
          Effect.catchTag("FailedToCreateBranchError", (error) => {
            process.exitCode = 1;
            return Effect.fail(
              new InvalidBranchError({
                branch: branchName,
                message: error.message,
              })
            );
          })
        );

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

          yield* promptService
            .confirmResetWithUncommittedChanges()
            .pipe(
              Effect.catchTag("PromptCancelledError", () =>
                Effect.fail(new WalkThroughCancelledError())
              )
            );
        }
      }

      // Retrieve commits
      yield* Console.log(
        `\nRetrieving commits between ${mainBranch} and ${liveBranch}...`
      );

      const commitHistory = yield* git.getLogOnelineReverse(
        `${mainBranch}..${liveBranch}`
      );

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
        const action = yield* promptService.selectWalkThroughAction(
          commitNumber,
          commits.length
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

      yield* git.resetHard(liveBranch).pipe(
        Effect.catchTag("FailedToResetError", () => {
          process.exitCode = 1;
          return Effect.succeed(void 0);
        })
      );

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
