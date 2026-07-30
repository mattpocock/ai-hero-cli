import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { resolveCommitRef } from "../src/branch-commits.js";
import {
  beginDeleteSession,
  replayWithoutTarget,
} from "../src/internal/delete-commit/session.js";
import {
  applyToLiveBranch,
  conflictedFiles,
  finish,
  loadCommits,
  unwind,
} from "../src/internal/stack/session.js";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";
import { git, makeLayer, stackOf } from "./helpers/make-layer.js";

describe("delete-commit session", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const makeRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("add-first: First", { "a.txt": "first" }),
        commit("add-second: Second", { "b.txt": "second" }),
        commit("add-third: Third", { "c.txt": "third" }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  /** A stack where each lesson edits the same file, so a delete conflicts. */
  const makeConflictingRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("add-first: First", { "shared.txt": "v1\n" }),
        commit("add-second: Second", { "shared.txt": "v2\n" }),
        commit("add-third: Third", { "shared.txt": "v3\n" }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  const deleteLesson = (ref: string) =>
    Effect.gen(function* () {
      const commits = yield* loadCommits({
        branch: "live-run-through",
        mainBranch: "main",
      });
      const target = resolveCommitRef(commits, ref)!;

      const session = yield* beginDeleteSession({
        commits,
        target,
        liveBranch: "live-run-through",
      });

      const result = yield* replayWithoutTarget(session);
      return { session, result };
    });

  it.effect("drops a mid-stack lesson and replays the rest", () => {
    const { workingDir } = makeRepo();

    return Effect.gen(function* () {
      const { result, session } = yield* deleteLesson(
        "add-second"
      );
      expect(result.conflict).toBe(false);

      yield* applyToLiveBranch(session);
      yield* finish(session);

      expect(stackOf(workingDir)).toEqual([
        "add-first: First",
        "add-third: Third",
      ]);
      // The deleted lesson's file is gone; the survivor's remains.
      expect(
        git(workingDir, "show", "live-run-through:c.txt")
      ).toBe("third");
      expect(() =>
        git(workingDir, "show", "live-run-through:b.txt")
      ).toThrow();
    }).pipe(Effect.provide(makeLayer(workingDir)));
  });

  it.effect("drops the tip, replaying nothing", () => {
    const { workingDir } = makeRepo();

    return Effect.gen(function* () {
      const { result, session } = yield* deleteLesson("add-third");
      expect(session.following).toBe(0);
      expect(result.conflict).toBe(false);

      yield* applyToLiveBranch(session);
      yield* finish(session);

      expect(stackOf(workingDir)).toEqual([
        "add-first: First",
        "add-second: Second",
      ]);
    }).pipe(Effect.provide(makeLayer(workingDir)));
  });

  it.effect("drops the first lesson, replaying all the rest", () => {
    const { workingDir } = makeRepo();

    return Effect.gen(function* () {
      const { result, session } = yield* deleteLesson("add-first");
      expect(session.following).toBe(2);
      expect(result.conflict).toBe(false);

      yield* applyToLiveBranch(session);
      yield* finish(session);

      expect(stackOf(workingDir)).toEqual([
        "add-second: Second",
        "add-third: Third",
      ]);
    }).pipe(Effect.provide(makeLayer(workingDir)));
  });

  it.effect("takes a backup branch before rewriting", () => {
    const { workingDir } = makeRepo();

    return Effect.gen(function* () {
      const before = git(
        workingDir,
        "rev-parse",
        "live-run-through"
      );

      const { session } = yield* deleteLesson("add-second");
      expect(session.backupBranch).toMatch(
        /^backup\/live-run-through-pre-delete-commit-\d+$/
      );

      yield* applyToLiveBranch(session);
      yield* finish(session);

      // The backup still names the pre-delete tip.
      expect(
        git(workingDir, "rev-parse", session.backupBranch!)
      ).toBe(before);
      expect(stackOf(workingDir, session.backupBranch!)).toEqual([
        "add-first: First",
        "add-second: Second",
        "add-third: Third",
      ]);
    }).pipe(Effect.provide(makeLayer(workingDir)));
  });

  it.effect(
    "reports a conflict when a later lesson builds on the deleted one",
    () => {
      const { workingDir } = makeConflictingRepo();

      return Effect.gen(function* () {
        const { result } = yield* deleteLesson("add-second");
        expect(result.conflict).toBe(true);
        expect(yield* conflictedFiles).toContain("shared.txt");
      }).pipe(Effect.provide(makeLayer(workingDir)));
    }
  );

  it.effect(
    "unwinds a conflicted delete back to the original stack",
    () => {
      const { workingDir } = makeConflictingRepo();

      return Effect.gen(function* () {
        const before = git(
          workingDir,
          "rev-parse",
          "live-run-through"
        );

        const { result, session } = yield* deleteLesson(
          "add-second"
        );
        expect(result.conflict).toBe(true);

        yield* unwind(session, {
          midCherryPick: true,
          liveBranchMoved: false,
          keepTempBranch: false,
        });

        expect(
          git(workingDir, "rev-parse", "live-run-through")
        ).toBe(before);
        expect(stackOf(workingDir)).toEqual([
          "add-first: First",
          "add-second: Second",
          "add-third: Third",
        ]);
      }).pipe(Effect.provide(makeLayer(workingDir)));
    }
  );
});
