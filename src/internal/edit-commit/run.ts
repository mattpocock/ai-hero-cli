import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import * as path from "node:path";
import { getCommitsBetweenBranches } from "../../branch-commits.js";
import { GitService, GitServiceConfig } from "../../git-service.js";
import {
  CommitNotFoundError,
  LeaseRejectedError,
  SessionExistsError,
  UnresolvedConflictsError,
} from "./errors.js";
import {
  clearState,
  type EditCommitState,
  readStateOption,
  requireState,
  writeState,
} from "./state.js";

export interface Envelope {
  phase: "editing" | "conflict" | "ready" | "published";
  target: {
    sha: string;
    message: string;
    sequence: number;
  };
  following: number;
  conflictedFiles: Array<string>;
  nextStep: string;
}

export interface BeginOptions {
  /** Commit to edit: a sequence number (1-based) or a SHA prefix. */
  commit: string;
  branch: string;
  mainBranch: string;
}

export const runBegin = (opts: BeginOptions) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    // Refuse if a session is already in progress.
    const existing = yield* readStateOption;
    if (existing) {
      return yield* Effect.fail(
        new SessionExistsError({ phase: existing.phase })
      );
    }

    yield* git.fetchOrigin();

    const commits = yield* getCommitsBetweenBranches({
      mainBranch: opts.mainBranch,
      liveBranch: opts.branch,
    });

    // A bare integer within range is a 1-based sequence number; anything
    // else is treated as a SHA prefix. (Resolving sequence first avoids a
    // SHA that merely starts with that digit shadowing the sequence.)
    const asSequence = /^\d+$/.test(opts.commit)
      ? commits.find(
          (c) => c.sequence === Number(opts.commit)
        )
      : undefined;
    const target =
      asSequence ??
      commits.find((c) => c.sha.startsWith(opts.commit));

    // Resolve the target before any branch mutation, so a bad reference
    // doesn't strand a temp branch.
    if (!target) {
      return yield* Effect.fail(
        new CommitNotFoundError({ commit: opts.commit })
      );
    }

    const following = commits.length - target.sequence;
    const targetBranchHead = yield* git.revParse(opts.branch);

    const originalBranch = yield* git.getCurrentBranch();
    const tempBranch = `matt/edit-commit-${Date.now()}`;
    yield* git.checkoutNewBranch(tempBranch);

    yield* git.applyAsUnstagedChanges(target.sha);

    yield* writeState({
      phase: "editing",
      tempBranch,
      originalBranch,
      liveBranch: opts.branch,
      mainBranch: opts.mainBranch,
      targetSha: target.sha,
      targetMessage: target.message,
      targetSequence: target.sequence,
      targetBranchHead,
      following,
    });

    const envelope: Envelope = {
      phase: "editing",
      target: {
        sha: target.sha,
        message: target.message,
        sequence: target.sequence,
      },
      following,
      conflictedFiles: [],
      nextStep:
        "Edit the unstaged working-tree changes, then run `edit-commit continue`.",
    };
    return envelope;
  });

/** Files with unmerged paths, parsed from `git status --short`. */
const conflictedFiles = (git: GitService) =>
  Effect.gen(function* () {
    const status = yield* git.getStatusShort();
    return status
      .split("\n")
      .filter(Boolean)
      .filter((line) => {
        const xy = line.slice(0, 2);
        return (
          xy.includes("U") || xy === "AA" || xy === "DD"
        );
      })
      .map((line) => line.slice(3).trim());
  });

const target = (state: EditCommitState) => ({
  sha: state.targetSha,
  message: state.targetMessage,
  sequence: state.targetSequence,
});

/** Persist + describe the conflict phase from the current unmerged paths. */
const enterConflict = (
  git: GitService,
  state: EditCommitState
) =>
  Effect.gen(function* () {
    const files = yield* conflictedFiles(git);
    yield* writeState({ ...state, phase: "conflict" });
    return {
      phase: "conflict",
      target: target(state),
      following: state.following,
      conflictedFiles: files,
      nextStep:
        "Resolve the conflicted files, then run `edit-commit continue`.",
    } satisfies Envelope;
  });

/** Persist + describe the ready phase. */
const enterReady = (state: EditCommitState) =>
  Effect.gen(function* () {
    yield* writeState({ ...state, phase: "ready" });
    return {
      phase: "ready",
      target: target(state),
      following: state.following,
      conflictedFiles: [],
      nextStep:
        "Inspect the recomposed branch, then run `edit-commit publish` to force-push.",
    } satisfies Envelope;
  });

/** Of the currently-unmerged files, those that still contain markers. */
const filesWithMarkers = (git: GitService) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { cwd } = yield* GitServiceConfig;
    const unmerged = yield* conflictedFiles(git);
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

export const runContinue = () =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const state = yield* requireState;

    if (state.phase === "conflict") {
      // Refuse to proceed while any file still has conflict markers.
      const stillMarked = yield* filesWithMarkers(git);
      if (stillMarked.length > 0) {
        return yield* Effect.fail(
          new UnresolvedConflictsError({
            files: stillMarked,
          })
        );
      }
      yield* git.stageAll();
      const result = yield* git.cherryPickContinue().pipe(
        Effect.map(() => ({ conflict: false as const })),
        Effect.catchTag("CherryPickConflictError", () =>
          Effect.succeed({ conflict: true as const })
        )
      );
      return result.conflict
        ? yield* enterConflict(git, state)
        : yield* enterReady(state);
    }

    // editing -> re-author the commit, then replay the following commits.
    yield* git.stageAll();
    yield* git.commit(state.targetMessage);

    if (state.following > 0) {
      const result = yield* git
        .cherryPick(
          `${state.targetSha}..${state.targetBranchHead}`
        )
        .pipe(
          Effect.map(() => ({ conflict: false as const })),
          Effect.catchTag("CherryPickConflictError", () =>
            Effect.succeed({ conflict: true as const })
          )
        );

      if (result.conflict) {
        return yield* enterConflict(git, state);
      }
    }

    return yield* enterReady(state);
  });

export const runPublish = () =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const state = yield* requireState;

    // Move the live branch onto the recomposed temp branch, then push.
    yield* git.checkout(state.liveBranch);
    yield* git.resetHard(state.tempBranch);

    yield* git
      .pushForceWithLease("origin", state.liveBranch)
      .pipe(
        Effect.catchTag("FailedToPushError", () =>
          Effect.fail(
            new LeaseRejectedError({
              branch: state.liveBranch,
            })
          )
        )
      );

    // Restore the original branch and tear the session down.
    yield* git.checkout(state.originalBranch);
    yield* git.deleteBranch(state.tempBranch);
    yield* clearState;

    return {
      phase: "published",
      target: target(state),
      following: state.following,
      conflictedFiles: [],
      nextStep: "Done — the live branch is updated on origin.",
    } satisfies Envelope;
  });

const nextStepFor: Record<EditCommitState["phase"], string> =
  {
    editing:
      "Edit the unstaged working-tree changes, then run `edit-commit continue`.",
    conflict:
      "Resolve the conflicted files, then run `edit-commit continue`.",
    ready:
      "Inspect the recomposed branch, then run `edit-commit publish` to force-push.",
  };

/** Read-only: report the current session phase without mutating anything. */
export const runStatus = () =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const state = yield* requireState;

    const files =
      state.phase === "conflict"
        ? yield* conflictedFiles(git)
        : [];

    return {
      phase: state.phase,
      target: target(state),
      following: state.following,
      conflictedFiles: files,
      nextStep: nextStepFor[state.phase],
    } satisfies Envelope;
  });

export interface AbortResult {
  aborted: true;
  restoredBranch: string;
  deletedBranch: string;
  /** Working-tree paths that were thrown away by the abort. */
  discardedFiles: Array<string>;
}

/** Hard-reset escape hatch: tear the session down from any phase. */
export const runAbort = () =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const state = yield* requireState;

    // Record what we're about to throw away, for the report.
    const discardedFiles = (yield* git.getStatusShort())
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim());

    // If a cherry-pick is mid-flight, abort it first.
    if (state.phase === "conflict") {
      yield* git.cherryPickAbort();
    }

    // Drop any working-tree changes, return to the original branch, and
    // delete the temp branch.
    yield* git.resetHard(state.tempBranch);
    yield* git.clean();
    yield* git.checkout(state.originalBranch);
    yield* git.deleteBranch(state.tempBranch);
    yield* clearState;

    return {
      aborted: true,
      restoredBranch: state.originalBranch,
      deletedBranch: state.tempBranch,
      discardedFiles,
    } satisfies AbortResult;
  });
