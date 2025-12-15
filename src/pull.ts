import { Command as CLICommand } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";

export class InvalidBranchOperationError extends Data.TaggedError(
  "InvalidBranchOperationError"
)<{
  message: string;
}> {}

export const pull = CLICommand.make(
  "pull",
  {
    cwd: cwdOption,
  },
  ({ cwd }) =>
    Effect.gen(function* () {
      const git = yield* GitService;

      // Validate git repository
      yield* git.ensureIsGitRepo();

      // Get current branch (cannot be main)
      const currentBranch = yield* git.getCurrentBranch();
      if (currentBranch === "main") {
        return yield* new InvalidBranchOperationError({
          message:
            "Cannot pull when on main branch. Switch to a working branch first.",
        });
      }

      // Check for uncommitted changes
      const { hasUncommittedChanges, statusOutput } =
        yield* git.getUncommittedChanges();

      if (hasUncommittedChanges) {
        yield* Console.error("You have uncommitted changes:\n");
        yield* Console.error(statusOutput);
        yield* Console.error(
          "\nCommit or stash your changes before pulling:\n  git stash\n  ai-hero pull\n  git stash pop"
        );
        process.exitCode = 1;
        return;
      }

      // Detect upstream remote
      const { remoteName } = yield* git.detectUpstreamRemote();

      // Fetch main from upstream
      yield* Console.log(`Fetching main from ${remoteName}...`);
      const fetchExitCode = yield* git.runCommandWithExitCode(
        "git",
        "fetch",
        remoteName,
        "main"
      );

      if (fetchExitCode !== 0) {
        yield* Console.error("Failed to fetch from upstream");
        process.exitCode = 1;
        return;
      }

      // Merge upstream/main into current branch
      yield* Console.log(
        `Merging ${remoteName}/main into ${currentBranch}...`
      );
      const mergeExitCode = yield* git.runCommandWithExitCode(
        "git",
        "merge",
        `${remoteName}/main`
      );

      if (mergeExitCode !== 0) {
        yield* Console.log(
          "\nMerge conflicts detected. Resolve conflicts and commit."
        );
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `\n✓ Successfully merged ${remoteName}/main into ${currentBranch}`
      );
    }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd,
        })
      ),
      Effect.catchTags({
        NotAGitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        NoUpstreamFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        InvalidBranchOperationError: (error) => {
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
).pipe(CLICommand.withDescription("Pull latest changes from upstream main"));
