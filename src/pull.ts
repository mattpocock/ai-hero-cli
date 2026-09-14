import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { ensureNotOnProtectedBranch } from "./errors.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";
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

      const workingBranch = yield* ensureNotOnProtectedBranch(
        "pull"
      );

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

      // Merge upstream/main into current branch. main itself now shares
      // real ancestry with upstream/main (it's the same branch the
      // student cloned and has been committing on directly), so we no
      // longer need --allow-unrelated-histories to paper over a fresh
      // dev branch's history — dropping it here means a genuinely wrong
      // --upstream fails loudly instead of silently two-root-merging.
      yield* git.merge("upstream/main", {
        allowUnrelatedHistories: workingBranch !== "main",
      });

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
            // Usually a real content conflict, but `git merge` also exits
            // non-zero when it refuses to merge unrelated histories (e.g.
            // --upstream pointing at the wrong repo) - which this maps to
            // the same tag, since both need a human to look before
            // resolving anything.
            yield* Console.log(
              "\nMerge failed. If this is a content conflict, resolve it and commit. If you didn't expect a conflict at all, check that --upstream points at the right repo - git refuses to merge histories with no common ancestor."
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
