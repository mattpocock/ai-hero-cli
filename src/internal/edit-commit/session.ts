import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import * as path from "node:path";
import type { BranchCommit } from "../../branch-commits.js";
import { getCommitsBetweenBranches } from "../../branch-commits.js";
import type { PlatformError } from "@effect/platform/Error";
import type { CherryPickConflictError } from "../../git-service/errors.js";
import { GitService, GitServiceConfig } from "../../git-service.js";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
}> {}

/**
 * A live edit-commit session. Everything needed to unwind or complete the
 * session is held here, in one process — deliberately not persisted. A session
 * that outlives its process is not resumable; see the changeset.
 */
export interface EditSession {
  tempBranch: string;
  originalBranch: string;
  liveBranch: string;
  target: BranchCommit;
  /** Live branch tip before the session began — what we cherry-pick up to. */
  targetBranchHead: string;
  /** Number of commits following the target on the live branch. */
  following: number;
}

/** Fetch origin and read the lesson stack, oldest first. */
export const loadCommits = (opts: {
  branch: string;
  mainBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* git.fetchOrigin();

    return yield* getCommitsBetweenBranches({
      mainBranch: opts.mainBranch,
      liveBranch: opts.branch,
    });
  });

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

    const following = opts.commits.length - opts.target.sequence;
    const targetBranchHead = yield* git.revParse(opts.liveBranch);
    const originalBranch = yield* git.getCurrentBranch();

    const tempBranch = `matt/edit-commit-${Date.now()}`;
    yield* git.checkoutNewBranch(tempBranch);
    yield* git.applyAsUnstagedChanges(opts.target.sha);

    return {
      tempBranch,
      originalBranch,
      liveBranch: opts.liveBranch,
      target: opts.target,
      targetBranchHead,
      following,
    } satisfies EditSession;
  });

/** All changed paths parsed from `git status --short`. */
const parseStatusPaths = (status: string) =>
  status
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      xy: line.slice(0, 2),
      path: line.slice(3).trim(),
    }));

/** Files with unmerged paths, parsed from `git status --short`. */
export const conflictedFiles = Effect.gen(function* () {
  const git = yield* GitService;
  const status = yield* git.getStatusShort();
  return parseStatusPaths(status)
    .filter(
      ({ xy }) => xy.includes("U") || xy === "AA" || xy === "DD"
    )
    .map((entry) => entry.path);
});

/**
 * Of the currently-unmerged files, those that still contain conflict markers.
 *
 * The point of actually reading the files: "continue" must not take the user's
 * word for it and commit `<<<<<<<` into a lesson, where it surfaces later as a
 * broken exercise for students rather than immediately for the author.
 */
export const filesWithMarkers = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { cwd } = yield* GitServiceConfig;
  const unmerged = yield* conflictedFiles;

  const remaining: Array<string> = [];
  for (const file of unmerged) {
    const content = yield* fs.readFileString(
      path.join(cwd, file)
    );
    if (
      content.includes("<<<<<<<") ||
      content.includes(">>>>>>>")
    ) {
      remaining.push(file);
    }
  }
  return remaining;
});

/**
 * Run a cherry-pick effect and report whether it stopped on a conflict,
 * folding the typed conflict error into a plain boolean result.
 */
const detectConflict = <A, R>(
  effect: Effect.Effect<
    A,
    CherryPickConflictError | PlatformError,
    R
  >
) =>
  effect.pipe(
    Effect.map(() => ({ conflict: false as const })),
    Effect.catchTag("CherryPickConflictError", () =>
      Effect.succeed({ conflict: true as const })
    )
  );

/**
 * Re-author the target commit from the working tree, then replay the commits
 * that followed it. Reports whether the replay stopped on a conflict.
 */
export const recompose = (session: EditSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    yield* git.stageAll();
    // The original subject is reused verbatim — editing a lesson's contents
    // must never silently rename the lesson.
    yield* git.commit(session.target.message);

    if (session.following === 0) {
      return { conflict: false as const };
    }

    return yield* detectConflict(
      git.cherryPick(
        `${session.target.sha}..${session.targetBranchHead}`
      )
    );
  });

/** Resume a conflicted cherry-pick from the resolved working tree. */
export const resumeCherryPick = Effect.gen(function* () {
  const git = yield* GitService;
  yield* git.stageAll();
  return yield* detectConflict(git.cherryPickContinue());
});

/** Move the live branch onto the recomposed temp branch. */
export const applyToLiveBranch = (session: EditSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    yield* git.checkout(session.liveBranch);
    yield* git.resetHard(session.tempBranch);
  });

/** Force-push the recomposed live branch to origin. */
export const publish = (session: EditSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    yield* git.pushForceWithLease("origin", session.liveBranch);
  });

/** Return to the branch we started on and drop the temp branch. */
export const finish = (session: EditSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    yield* git.checkout(session.originalBranch);
    yield* git.deleteBranch(session.tempBranch);
  });

export interface UnwindOptions {
  /** A cherry-pick is mid-flight and must be aborted first. */
  midCherryPick: boolean;
  /** The live branch has already been moved onto the temp branch. */
  liveBranchMoved: boolean;
  /**
   * Leave the temp branch in place rather than deleting it. Used once the
   * user's edits are committed: backing out of publishing shouldn't throw the
   * edits away, so we restore every *other* branch and hand back the name.
   */
  keepTempBranch: boolean;
}

/**
 * Tear the session down and restore the repository to how we found it.
 *
 * This is the fix for the old command's worst behaviour: cancelling a prompt
 * printed "Branch left as-is" and abandoned a `matt/edit-commit-*` branch that
 * nothing could later find. Returns the working-tree paths it discarded.
 */
export const unwind = (
  session: EditSession,
  opts: UnwindOptions
) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const discardedFiles = opts.keepTempBranch
      ? []
      : parseStatusPaths(yield* git.getStatusShort()).map(
          (entry) => entry.path
        );

    if (opts.midCherryPick) {
      yield* git.cherryPickAbort();
    }

    if (!opts.keepTempBranch && !opts.liveBranchMoved) {
      // Still parked on the temp branch with a dirty tree — clear it so the
      // checkout below can't be blocked by uncommitted changes.
      yield* git.resetHard(session.tempBranch);
      yield* git.clean();
    }

    if (opts.liveBranchMoved) {
      // The live branch was already reset onto the temp branch; put it back
      // where it was before the session started.
      yield* git.checkout(session.liveBranch);
      yield* git.resetHard(session.targetBranchHead);
    }

    yield* git.checkout(session.originalBranch);

    if (!opts.keepTempBranch) {
      yield* git.deleteBranch(session.tempBranch);
    }

    return { discardedFiles };
  });
