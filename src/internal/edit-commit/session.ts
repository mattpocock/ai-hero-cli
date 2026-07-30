import { Effect } from "effect";
import type { BranchCommit } from "../../branch-commits.js";
import { GitService } from "../../git-service.js";
import {
  beginStackSession,
  replayFollowing,
  type StackSession,
} from "../stack/session.js";

/**
 * Edit-commit's session: the shared stack spine plus the commit being edited.
 *
 * The spine itself lives in `../stack/session.ts` and is shared with add,
 * rename and delete. Only the middle — parking the target's diff in the
 * working tree, then re-authoring it — is specific to editing.
 */
export interface EditSession extends StackSession {
  target: BranchCommit;
}

export {
  applyToLiveBranch,
  conflictedFiles,
  filesWithMarkers,
  finish,
  loadCommits,
  NotAGitRepoError,
  publish,
  resumeCherryPick,
  unwind,
  type UnwindOptions,
} from "../stack/session.js";

/**
 * Park the target commit's diff in the working tree on a fresh temp branch.
 *
 * The target is resolved by the caller *before* this runs, so a bad reference
 * can never strand a temp branch.
 */
export const beginSession = (opts: {
  commits: Array<BranchCommit>;
  target: BranchCommit;
  liveBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const session = yield* beginStackSession({
      liveBranch: opts.liveBranch,
      base: opts.target.sha,
      following: opts.commits.length - opts.target.sequence,
      operation: "edit-commit",
    });

    // Rewind onto the target's parent, leaving its diff unstaged for editing.
    yield* git.applyAsUnstagedChanges(opts.target.sha);

    return {
      ...session,
      target: opts.target,
    } satisfies EditSession;
  });

/**
 * Re-author the target commit from the working tree, then replay the commits
 * that followed it. Reports whether the replay stopped on a conflict.
 */
export const recompose = (session: EditSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* git.stageAll();
    // The original subject is reused verbatim — editing a lesson's contents
    // must never silently rename the lesson. Renaming is `rename-commit`.
    yield* git.commit(session.target.message);

    return yield* replayFollowing(session);
  });
