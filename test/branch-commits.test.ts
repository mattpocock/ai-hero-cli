import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer } from "effect";
import {
  getCommitsBetweenBranches,
  NoCommitsFoundError,
} from "../src/branch-commits.js";
import { GitService } from "../src/git-service.js";

/**
 * Tests for branch-commits utility functions.
 * Per CLAUDE.md: Mock GitService to test commit retrieval behavior.
 *
 * These utilities support internal commands like edit-commit and diffs-to-repo.
 */

describe("branch-commits", () => {
  describe("getCommitsBetweenBranches", () => {
    it.effect(
      "should return commits between branches with sequence numbers",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            getLogOnelineReverse: Effect.fn("getLogOnelineReverse")(
              function* (range: string) {
                expect(range).toBe("main..live-run-through");
                return "abc123 01.01 First lesson\ndef456 01.02 Second lesson\nghi789 02.01 Third lesson";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            NodeContext.layer
          );

          const commits = yield* getCommitsBetweenBranches({
            mainBranch: "main",
            liveBranch: "live-run-through",
          }).pipe(Effect.provide(testLayer));

          expect(commits).toEqual([
            { sha: "abc123", message: "01.01 First lesson", sequence: 1 },
            { sha: "def456", message: "01.02 Second lesson", sequence: 2 },
            { sha: "ghi789", message: "02.01 Third lesson", sequence: 3 },
          ]);
        })
    );

    it.effect(
      "should fail with NoCommitsFoundError when no commits exist between branches",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            getLogOnelineReverse: Effect.fn("getLogOnelineReverse")(
              function* () {
                // Empty output means no commits between branches
                return "";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            NodeContext.layer
          );

          const error = yield* getCommitsBetweenBranches({
            mainBranch: "main",
            liveBranch: "live-run-through",
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(error).toBeInstanceOf(NoCommitsFoundError);
          if (error instanceof NoCommitsFoundError) {
            expect(error.mainBranch).toBe("main");
            expect(error.liveBranch).toBe("live-run-through");
          }
        })
    );
  });
});
