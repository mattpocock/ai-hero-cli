import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";

export class InvalidBranchOperationError extends Data.TaggedError(
  "InvalidBranchOperationError"
)<{
  message: string;
}> {}

export class UncommittedChangesError extends Data.TaggedError(
  "UncommittedChangesError"
)<{
  statusOutput: string;
}> {}

/**
 * Core pull logic, extracted for testability.
 */
export const runPull = (opts: { upstream: string }) =>
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
      return yield* new UncommittedChangesError({
        statusOutput,
      });
    }

    // Set up upstream remote
    yield* git.setUpstreamRemote(opts.upstream);

    // Fetch main from upstream
    yield* Console.log("Fetching main from upstream...");
    yield* git.fetch("upstream", "main");

    // Merge upstream/main into current branch
    yield* Console.log(
      `Merging upstream/main into ${currentBranch}...`
    );
    yield* git.merge("upstream/main");

    yield* Console.log(
      `\n✓ Successfully merged upstream/main into ${currentBranch}`
    );
  });

export const pull = CLICommand.make(
  "pull",
  {
    cwd: cwdOption,
    upstream: Options.text("upstream").pipe(
      Options.withDescription(
        "Git URL or local path to the upstream exercise repo"
      )
    ),
  },
  /* v8 ignore start - CLI error handlers are presentation logic */
  ({ cwd, upstream }) =>
    runPull({ upstream }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd,
        })
      ),
      Effect.catchTags({
        UncommittedChangesError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error("You have uncommitted changes:\n");
            yield* Console.error(error.statusOutput);
            yield* Console.error(
              "\nCommit or stash your changes before pulling:\n  git stash\n  ai-hero pull\n  git stash pop"
            );
            process.exitCode = 1;
          });
        },
        NotAGitRepoError: (error) => {
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
        FailedToFetchError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        MergeConflictError: () => {
          return Effect.gen(function* () {
            yield* Console.log(
              "\nMerge conflicts detected. Resolve conflicts and commit."
            );
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
  /* v8 ignore stop */
).pipe(
  CLICommand.withDescription(
    "Pull latest changes from upstream main"
  )
);
