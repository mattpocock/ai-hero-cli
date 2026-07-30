import { Effect } from "effect";
import type { BranchCommit } from "../../branch-commits.js";
import { GitService } from "../../git-service.js";
import {
  beginStackSession,
  replayFollowing,
  type StackSession,
} from "../stack/session.js";

/**
 * Where a new lesson goes in the stack. Resolved from the picker before any
 * branch moves, so a bad position can't strand a temp branch.
 */
export type InsertPosition =
  | { _tag: "start" }
  | { _tag: "end" }
  | { _tag: "after"; commit: BranchCommit };

/**
 * The base sha a new lesson's temp branch starts from.
 *
 * "At the start" is just "insert after the first lesson's parent" — no
 * special case beyond asking git for that parent.
 */
const resolveBase = (opts: {
  position: InsertPosition;
  commits: Array<BranchCommit>;
  liveBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    switch (opts.position._tag) {
      case "end":
        return yield* git.revParse(opts.liveBranch);
      case "after":
        return opts.position.commit.sha;
      case "start": {
        const first = opts.commits[0];
        // An empty stack has no first lesson, so "the start" *is* the tip.
        if (!first) {
          return yield* git.revParse(opts.liveBranch);
        }
        return yield* git.revParse(`${first.sha}^`);
      }
    }
  });

/** How many commits will need replaying after inserting at `position`. */
const countFollowing = (opts: {
  position: InsertPosition;
  commits: Array<BranchCommit>;
}) => {
  switch (opts.position._tag) {
    case "end":
      return 0;
    case "start":
      return opts.commits.length;
    case "after":
      return opts.commits.length - opts.position.commit.sequence;
  }
};

/**
 * Open a session with the temp branch parked where the new lesson belongs.
 *
 * `replayFrom` is the same sha as the base: everything after the insertion
 * point gets replayed on top of the new stub.
 */
export const beginAddSession = (opts: {
  commits: Array<BranchCommit>;
  position: InsertPosition;
  liveBranch: string;
}) =>
  Effect.gen(function* () {
    const base = yield* resolveBase({
      position: opts.position,
      commits: opts.commits,
      liveBranch: opts.liveBranch,
    });

    return yield* beginStackSession({
      liveBranch: opts.liveBranch,
      base,
      following: countFollowing({
        position: opts.position,
        commits: opts.commits,
      }),
      operation: "add-commit",
    });
  });

/**
 * Commit the empty stub, then replay everything that followed the insertion
 * point. The stub carries a subject and no content — `edit-commit` fills it
 * in later, and the empty commit survives every subsequent replay because
 * `cherryPick` keeps redundant commits.
 */
export const composeStub = (opts: {
  session: StackSession;
  subject: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* git.commit(opts.subject);

    return yield* replayFollowing(opts.session);
  });
