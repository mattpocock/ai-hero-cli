import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect } from "effect";
import * as path from "node:path";
import { getCommitsBetweenBranches } from "../../branch-commits.js";
import type { CherryPickConflictError } from "../../git-service/errors.js";
import { GitService, GitServiceConfig } from "../../git-service.js";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
}> {}

/**
 * A live rewrite of the lesson stack, held in one process and deliberately
 * **not** persisted — a session that outlives its process is not resumable.
 *
 * Every internal command is the same spine with a different middle: park a
 * temp branch at some base, do the thing, replay everything that followed,
 * then apply / publish / finish — or `unwind` back to how we found it.
 */
export interface StackSession {
  tempBranch: string;
  originalBranch: string;
  liveBranch: string;
  /** Live branch tip before the session began — what we replay up to. */
  targetBranchHead: string;
  /**
   * Replay commits *after* this sha. Distinct from the temp branch's base:
   * `delete` bases at the target's parent but still replays from the target,
   * which is precisely what drops it.
   */
  replayFrom: string;
  /** Number of commits that will be replayed. For display only. */
  following: number;
  /** Backup branch taken before a destructive rewrite, if any. */
  backupBranch: string | null;
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
 * Read the lesson stack, tolerating an empty one.
 *
 * Only `add-commit` uses this: "there are no lessons yet" is a perfectly good
 * state to be adding the first lesson from, whereas edit/rename/delete have
 * nothing to act on and should keep failing loudly.
 */
export const loadCommitsAllowingEmpty = (opts: {
  branch: string;
  mainBranch: string;
}) =>
  loadCommits(opts).pipe(
    Effect.catchTag("NoCommitsFoundError", () => Effect.succeed([]))
  );

/**
 * Open a session on a fresh temp branch based at `base`.
 *
 * The caller resolves everything it needs *before* calling this, so a bad
 * reference can never strand a temp branch.
 */
export const beginStackSession = (opts: {
  liveBranch: string;
  /** Where the temp branch starts. */
  base: string;
  /** Replay commits after this sha (defaults to `base`). */
  replayFrom?: string;
  following: number;
  /** Name prefix for the temp branch, e.g. "edit-commit". */
  operation: string;
  /** Snapshot the live branch under `backup/` before rewriting. */
  backup?: boolean;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const targetBranchHead = yield* git.revParse(opts.liveBranch);
    const originalBranch = yield* git.getCurrentBranch();

    // The backup is taken before anything moves, so it always names the
    // pre-rewrite tip even if the session later unwinds badly.
    let backupBranch: string | null = null;
    if (opts.backup) {
      backupBranch = `backup/${opts.liveBranch}-pre-${
        opts.operation
      }-${Date.now()}`;
      yield* git.createBranchAt(backupBranch, targetBranchHead);
    }

    const tempBranch = `matt/${opts.operation}-${Date.now()}`;
    yield* git.checkoutNewBranchAt(tempBranch, opts.base);

    return {
      tempBranch,
      originalBranch,
      liveBranch: opts.liveBranch,
      targetBranchHead,
      replayFrom: opts.replayFrom ?? opts.base,
      following: opts.following,
      backupBranch,
    } satisfies StackSession;
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
export const detectConflict = <A, R>(
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
 * Replay the commits that followed onto the temp branch. Reports whether the
 * replay stopped on a conflict.
 */
export const replayFollowing = (session: StackSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    if (session.following === 0) {
      return { conflict: false as const };
    }

    return yield* detectConflict(
      git.cherryPick(
        `${session.replayFrom}..${session.targetBranchHead}`
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
export const applyToLiveBranch = (session: StackSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    yield* git.checkout(session.liveBranch);
    yield* git.resetHard(session.tempBranch);
  });

/** Force-push the recomposed live branch to origin. */
export const publish = (session: StackSession) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    yield* git.pushForceWithLease("origin", session.liveBranch);
  });

/** Return to the branch we started on and drop the temp branch. */
export const finish = (session: StackSession) =>
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
 *
 * Deliberately shared by all four commands rather than copied: divergent
 * unwind logic is exactly how orphaned branches come back.
 */
export const unwind = (
  session: StackSession,
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
