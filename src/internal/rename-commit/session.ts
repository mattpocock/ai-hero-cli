import { Effect } from "effect";
import type { BranchCommit } from "../../branch-commits.js";
import { GitService } from "../../git-service.js";
import {
  beginStackSession,
  replayFollowing,
  type StackSession,
} from "../stack/session.js";

/**
 * Open a session with the temp branch parked *on* the target commit.
 *
 * Renaming amends in place rather than rebuilding from the parent, so the
 * tree is untouched by construction — a rename can never alter a lesson's
 * contents.
 */
export const beginRenameSession = (opts: {
  commits: Array<BranchCommit>;
  target: BranchCommit;
  liveBranch: string;
}) =>
  beginStackSession({
    liveBranch: opts.liveBranch,
    base: opts.target.sha,
    following: opts.commits.length - opts.target.sequence,
    operation: "rename-commit",
  });

/**
 * Re-author the target's subject, then replay the commits that followed it.
 *
 * Every downstream lesson gets a new SHA, which is free: students re-fetch,
 * and nothing machine-readable pins a SHA or a slug. The cost of a reslug is
 * human — recorded footage that names the old slug.
 */
export const renameSubject = (opts: {
  session: StackSession;
  subject: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* git.amendCommitMessage(opts.subject);

    return yield* replayFollowing(opts.session);
  });
