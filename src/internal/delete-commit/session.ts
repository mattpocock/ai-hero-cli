import { Effect } from "effect";
import type { BranchCommit } from "../../branch-commits.js";
import { GitService } from "../../git-service.js";
import {
  beginStackSession,
  replayFollowing,
  type StackSession,
} from "../stack/session.js";

/**
 * Open a session with the temp branch parked on the target's **parent**, while
 * still replaying from the target itself.
 *
 * That gap between base and `replayFrom` is the whole deletion: the range
 * `target..head` covers the commits *after* the target, so replaying it onto
 * the target's parent reconstructs the stack without it.
 *
 * Takes a backup branch first — this is the one operation that destroys
 * authored work rather than moving it.
 */
export const beginDeleteSession = (opts: {
  commits: Array<BranchCommit>;
  target: BranchCommit;
  liveBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const parent = yield* git.revParse(`${opts.target.sha}^`);

    return yield* beginStackSession({
      liveBranch: opts.liveBranch,
      base: parent,
      replayFrom: opts.target.sha,
      following: opts.commits.length - opts.target.sequence,
      operation: "delete-commit",
      backup: true,
    });
  });

/**
 * Replay the commits that followed the deleted one.
 *
 * There is no "compose" step — the temp branch already sits at the parent, so
 * the deletion has happened simply by not replaying the target.
 */
export const replayWithoutTarget = (session: StackSession) =>
  replayFollowing(session);
