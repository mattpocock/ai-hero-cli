import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { resolveCommitRef } from "../src/branch-commits.js";
import {
  beginAddSession,
  composeStub,
  type InsertPosition,
} from "../src/internal/add-commit/session.js";
import {
  applyToLiveBranch,
  finish,
  loadCommits,
  loadCommitsAllowingEmpty,
  publish,
} from "../src/internal/stack/session.js";
import { composeSubject } from "../src/internal/stack/slug.js";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";
import { git, makeLayer, stackOf } from "./helpers/make-layer.js";

/**
 * Integration tests for add-commit's git layer, against a real repo + bare
 * remote. The slug/title prompts sit above these functions.
 */
describe("add-commit session", () => {
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

  /** A repo whose live branch carries no lessons at all. */
  const makeEmptyStackRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  const subject = composeSubject({
    slug: "add-stub",
    title: "A stub",
  });

  /** Run a full add through to the live branch. */
  const addAt = (position: (commits: never) => InsertPosition) =>
    Effect.gen(function* () {
      const commits = yield* loadCommits({
        branch: "live-run-through",
        mainBranch: "main",
      });

      const session = yield* beginAddSession({
        commits,
        position: position(commits as never),
        liveBranch: "live-run-through",
      });

      const result = yield* composeStub({ session, subject });
      expect(result.conflict).toBe(false);

      yield* applyToLiveBranch(session);
      yield* finish(session);
      return session;
    });

  it.effect("adds a stub at the end of the stack", () => {
    const { workingDir } = makeRepo();

    return addAt(() => ({ _tag: "end" })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(stackOf(workingDir)).toEqual([
            "add-first: First",
            "add-second: Second",
            "add-third: Third",
            subject,
          ]);
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("adds a stub at the start of the stack", () => {
    const { workingDir } = makeRepo();

    return addAt(() => ({ _tag: "start" })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(stackOf(workingDir)).toEqual([
            subject,
            "add-first: First",
            "add-second: Second",
            "add-third: Third",
          ]);
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("adds a stub after a chosen lesson", () => {
    const { workingDir } = makeRepo();

    return addAt((commits) => ({
      _tag: "after",
      commit: resolveCommitRef(commits, "add-first")!,
    })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(stackOf(workingDir)).toEqual([
            "add-first: First",
            subject,
            "add-second: Second",
            "add-third: Third",
          ]);
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("the stub it adds is empty", () => {
    const { workingDir } = makeRepo();

    return addAt(() => ({ _tag: "end" })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // No paths in the diff against its parent.
          const changed = git(
            workingDir,
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            "live-run-through"
          );
          expect(changed).toBe("");
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("preserves the contents of replayed lessons", () => {
    const { workingDir } = makeRepo();

    return addAt(() => ({ _tag: "start" })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(
            git(workingDir, "show", "live-run-through:c.txt")
          ).toBe("third");
          expect(
            git(workingDir, "show", "live-run-through:a.txt")
          ).toBe("first");
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("adds the first lesson to an empty stack", () => {
    const { workingDir } = makeEmptyStackRepo();

    return Effect.gen(function* () {
      const commits = yield* loadCommitsAllowingEmpty({
        branch: "live-run-through",
        mainBranch: "main",
      });
      expect(commits).toEqual([]);

      const session = yield* beginAddSession({
        commits,
        position: { _tag: "end" },
        liveBranch: "live-run-through",
      });

      const result = yield* composeStub({ session, subject });
      expect(result.conflict).toBe(false);
      expect(session.following).toBe(0);

      yield* applyToLiveBranch(session);
      yield* finish(session);

      expect(stackOf(workingDir)).toEqual([subject]);
    }).pipe(Effect.provide(makeLayer(workingDir)));
  });

  it.effect("publishes the new stack to origin", () => {
    const { workingDir } = makeRepo();

    return Effect.gen(function* () {
      const commits = yield* loadCommits({
        branch: "live-run-through",
        mainBranch: "main",
      });

      const session = yield* beginAddSession({
        commits,
        position: { _tag: "end" },
        liveBranch: "live-run-through",
      });

      yield* composeStub({ session, subject });
      yield* applyToLiveBranch(session);
      yield* publish(session);
      yield* finish(session);

      const remote = git(
        workingDir,
        "log",
        "--format=%s",
        "-1",
        "origin/live-run-through"
      );
      expect(remote).toBe(subject);
    }).pipe(Effect.provide(makeLayer(workingDir)));
  });
});
