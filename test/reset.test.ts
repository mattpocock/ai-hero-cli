import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import {
  GitService,
  GitServiceConfig,
  NotAGitRepoError,
} from "../src/git-service.js";
import { PromptService } from "../src/prompt-service.js";
import { runReset } from "../src/reset.js";

/**
 * Tests for the reset command business logic.
 * Per CLAUDE.md: Mock GitService and PromptService to test command behavior.
 *
 * These tests verify PRD scenarios for reset command.
 */

describe("reset", () => {
  describe("PRD: User runs reset outside git repo", () => {
    it.effect(
      "should fail with NotAGitRepoError when not in a git repository",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {
                return yield* Effect.fail(
                  new NotAGitRepoError({
                    path: "/not/a/repo",
                    message:
                      "Current directory is not a git repository: /not/a/repo",
                  })
                );
              }
            ),
          });

          const mockPromptService = fromPartial<PromptService>({});

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/not/a/repo",
            }),
            NodeContext.layer
          );

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(NotAGitRepoError);
          if (result instanceof NotAGitRepoError) {
            expect(result.path).toBe("/not/a/repo");
            expect(result.message).toContain(
              "not a git repository"
            );
          }
        })
    );
  });
});
