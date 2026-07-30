import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { resolveCommitRef } from "../src/branch-commits.js";
import {
  beginRenameSession,
  renameSubject,
} from "../src/internal/rename-commit/session.js";
import {
  applyToLiveBranch,
  finish,
  loadCommits,
} from "../src/internal/stack/session.js";
import { composeSubject } from "../src/internal/stack/slug.js";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";
import { git, makeLayer, stackOf } from "./helpers/make-layer.js";

describe("rename-commit session", () => {
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

  const renameTo = (ref: string, subject: string) =>
    Effect.gen(function* () {
      const commits = yield* loadCommits({
        branch: "live-run-through",
        mainBranch: "main",
      });
      const target = resolveCommitRef(commits, ref)!;

      const session = yield* beginRenameSession({
        commits,
        target,
        liveBranch: "live-run-through",
      });

      const result = yield* renameSubject({ session, subject });
      expect(result.conflict).toBe(false);

      yield* applyToLiveBranch(session);
      yield* finish(session);
      return session;
    });

  it.effect("renames a mid-stack lesson", () => {
    const { workingDir } = makeRepo();
    const subject = composeSubject({
      slug: "add-second-renamed",
      title: "Renamed",
    });

    return renameTo("add-second", subject).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(stackOf(workingDir)).toEqual([
            "add-first: First",
            subject,
            "add-third: Third",
          ]);
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("leaves the lesson's tree untouched", () => {
    const { workingDir } = makeRepo();
    const subject = composeSubject({
      slug: "add-second-renamed",
      title: "Renamed",
    });

    return renameTo("add-second", subject).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(
            git(workingDir, "show", "live-run-through:b.txt")
          ).toBe("second");
          // The renamed commit still introduces exactly its own file.
          const changed = git(
            workingDir,
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            "live-run-through~1"
          );
          expect(changed).toBe("b.txt");
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("renames the tip, replaying nothing", () => {
    const { workingDir } = makeRepo();
    const subject = composeSubject({
      slug: "add-third-renamed",
      title: "Last",
    });

    return renameTo("add-third", subject).pipe(
      Effect.tap((session) =>
        Effect.sync(() => {
          expect(session.following).toBe(0);
          expect(stackOf(workingDir)).toEqual([
            "add-first: First",
            "add-second: Second",
            subject,
          ]);
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("retitles without changing the slug", () => {
    const { workingDir } = makeRepo();
    const subject = composeSubject({
      slug: "add-second",
      title: "A better title",
    });

    return renameTo("add-second", subject).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(stackOf(workingDir)).toEqual([
            "add-first: First",
            "add-second: A better title",
            "add-third: Third",
          ]);
        })
      ),
      Effect.provide(makeLayer(workingDir))
    );
  });

  it.effect("renames an empty placeholder lesson", () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("add-first: First", { "a.txt": "first" }),
        commit("add-stub: Stub", {}),
      ])
      .build();
    cleanup = repo.cleanup;

    const subject = composeSubject({
      slug: "add-stub",
      title: "Filled in later",
    });

    return renameTo("add-stub", subject).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(stackOf(repo.workingDir)).toEqual([
            "add-first: First",
            subject,
          ]);
        })
      ),
      Effect.provide(makeLayer(repo.workingDir))
    );
  });
});
