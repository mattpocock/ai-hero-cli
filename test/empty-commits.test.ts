import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { loadCommits } from "../src/internal/stack/session.js";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";
import { makeLayer } from "./helpers/make-layer.js";

/**
 * A placeholder lesson — a commit with a message and no content — must be
 * visible as such before you edit or delete it. Tested against a real repo,
 * because the emptiness comes from git, not from the subject line.
 */
describe("empty lesson commits", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it.effect(
    "should mark commits that carry no content as empty",
    () =>
      Effect.gen(function* () {
        const repo = createTestRepo()
          .withRemote("origin")
          .withBranch("main", [
            commit("base", { "base.txt": "base" }),
          ])
          .withBranch("live-run-through", [
            commit("add-first: First", { "a.txt": "first" }),
            commit("add-second: Placeholder", {}),
            commit("add-third: Third", { "c.txt": "third" }),
          ])
          .build();
        cleanup = repo.cleanup;

        const commits = yield* loadCommits({
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(makeLayer(repo.workingDir)));

        expect(
          commits.map((entry) => [
            entry.lessonId,
            entry.isEmpty,
          ])
        ).toEqual([
          ["add-first", false],
          ["add-second", true],
          ["add-third", false],
        ]);
      })
  );
});
