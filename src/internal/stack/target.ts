import { Effect, Option } from "effect";
import {
  type BranchCommit,
  CommitNotFoundError,
  resolveCommitRef,
  selectCommit,
} from "../../branch-commits.js";

/**
 * Resolve the lesson a command should act on — from `--commit` when given,
 * otherwise by asking.
 *
 * Always called *before* a session opens, so a bad reference can't strand a
 * temp branch.
 */
export const resolveTarget = (opts: {
  commits: Array<BranchCommit>;
  commit: Option.Option<string>;
  promptMessage: string;
}) =>
  Effect.gen(function* () {
    if (Option.isSome(opts.commit)) {
      return (
        resolveCommitRef(opts.commits, opts.commit.value) ??
        (yield* new CommitNotFoundError({
          commit: opts.commit.value,
        }))
      );
    }

    return yield* selectCommit({
      commits: opts.commits,
      promptMessage: opts.promptMessage,
    });
  });

/** How a lesson is named in progress output. */
export const labelOf = (commit: BranchCommit) =>
  commit.lessonId ?? commit.sha;
