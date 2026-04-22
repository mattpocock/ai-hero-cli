import { Effect } from "effect";
import { GitService } from "./git-service.js";

/**
 * Wraps a command effect with upstream remote/branch cleanup.
 * Snapshots whether the `upstream` remote and the target branch exist
 * before running, then cleans up only what the command added.
 */
export const withUpstreamCleanup = <A, E, R>(
  opts: {
    upstream: string;
    targetBranch?: string;
  },
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService;

    // Snapshot pre-existing state
    const remoteExisted = yield* git.hasRemote("upstream");
    const branchExisted = opts.targetBranch
      ? yield* git.hasLocalBranch(opts.targetBranch)
      : false;

    // Run the body with cleanup guaranteed
    return yield* body.pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const git = yield* GitService;

          // Clean up branch first (before removing remote)
          if (!branchExisted && opts.targetBranch) {
            yield* git
              .deleteBranch(opts.targetBranch)
              .pipe(Effect.catchAll(() => Effect.void));
          }

          // Clean up remote (also removes upstream/* tracking refs)
          if (!remoteExisted) {
            yield* git
              .removeRemote("upstream")
              .pipe(Effect.catchAll(() => Effect.void));
          }
        })
      )
    );
  });
