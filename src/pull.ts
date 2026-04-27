import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { ensureNotOnProtectedBranch } from "./errors.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";
import { PromptService } from "./prompt-service.js";
import { withUpstreamCleanup } from "./upstream-cleanup.js";

export class UncommittedChangesError extends Data.TaggedError(
  "UncommittedChangesError"
)<{
  statusOutput: string;
}> {}

/**
 * Core pull logic, extracted for testability.
 */
export const runPull = (opts: { upstream: string }) =>
  withUpstreamCleanup(
    { upstream: opts.upstream },
    Effect.gen(function* () {
      const git = yield* GitService;

      // Validate git repository
      yield* git.ensureIsGitRepo();

      let workingBranch = yield* ensureNotOnProtectedBranch("pull");
      if (workingBranch === "main") {
        const promptService = yield* PromptService;
        yield* Console.log(
          "You're on the main branch. To avoid losing work, create a dev branch to pull upstream changes into."
        );
        const branchName = yield* promptService.inputBranchName(
          "working"
        );
        yield* git.checkoutNewBranch(branchName);
        workingBranch = branchName;
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
        `Merging upstream/main into ${workingBranch}...`
      );
      yield* git.merge("upstream/main");

      yield* Console.log(
        `\n✓ Successfully merged upstream/main into ${workingBranch}`
      );
    })
  );

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
        PromptCancelledError: () => {
          return Effect.gen(function* () {
            yield* Console.log("\nPull cancelled.");
          });
        },
        FailedToCreateBranchError: (error) => {
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
  /* v8 ignore stop */
).pipe(
  CLICommand.withDescription(
    "Pull latest changes from upstream main"
  )
);
