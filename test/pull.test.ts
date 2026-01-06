import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer } from "effect";
import {
  GitService,
  GitServiceConfig,
} from "../src/git-service.js";
import { runPull } from "../src/pull.js";

/**
 * Tests for the pull command business logic.
 * Per CLAUDE.md: Mock GitService to test command behavior.
 */

describe("pull", () => {
  describe("PRD: User successfully pulls from upstream", () => {
    it.effect(
      "should fetch upstream main and merge into current branch",
      () =>
        Effect.gen(function* () {
          let fetchCalledWith: { remote: string; branch: string } | undefined;
          let mergeCalledWith: string | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: () => Effect.succeed(undefined),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "matt/feature-branch";
            }),
            getUncommittedChanges: Effect.fn("getUncommittedChanges")(
              function* () {
                return {
                  hasUncommittedChanges: false,
                  statusOutput: "",
                };
              }
            ),
            detectUpstreamRemote: Effect.fn("detectUpstreamRemote")(
              function* () {
                return { remoteName: "upstream", url: "git@github.com:mattpocock/repo.git" };
              }
            ),
            fetch: Effect.fn("fetch")(function* (remote: string, branch: string) {
              fetchCalledWith = { remote, branch };
            }),
            merge: Effect.fn("merge")(function* (ref: string) {
              mergeCalledWith = ref;
            }),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          yield* runPull().pipe(Effect.provide(testLayer));

          expect(fetchCalledWith).toEqual({ remote: "upstream", branch: "main" });
          expect(mergeCalledWith).toBe("upstream/main");
        })
    );
  });
});
