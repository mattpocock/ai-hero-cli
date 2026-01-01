import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import { CommitNotFoundError } from "../src/commit-utils.js";
import {
  GitService,
  GitServiceConfig,
  NoUpstreamFoundError,
  NotAGitRepoError,
} from "../src/git-service.js";
import { PromptService } from "../src/prompt-service.js";
import { InvalidBranchOperationError, runReset } from "../src/reset.js";

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

  describe("PRD: User runs reset without valid upstream", () => {
    it.effect(
      "should fail with NoUpstreamFoundError when no valid upstream remote exists",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {
              return yield* Effect.fail(
                new NoUpstreamFoundError({
                  message: `No valid upstream remote found.
Looking for repos from usernames: mattpocock, ai-hero-dev, total-typescript

Add upstream remote:
  git remote add upstream https://github.com/<username>/<repo>.git`,
                })
              );
            }),
          });

          const mockPromptService = fromPartial<PromptService>({});

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
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

          expect(result).toBeInstanceOf(NoUpstreamFoundError);
          if (result instanceof NoUpstreamFoundError) {
            expect(result.message).toContain(
              "No valid upstream remote found"
            );
            expect(result.message).toContain(
              "git remote add upstream"
            );
          }
        })
    );
  });

  describe("PRD: User requests non-existent lesson", () => {
    it.effect(
      "should fail with CommitNotFoundError for non-existent lesson",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              // Only has lesson 01.02.03
              return `def5678 01.02.03 Add new feature`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({});

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          // Request lesson 99.99.99 which doesn't exist
          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("99.99.99"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(CommitNotFoundError);
          if (result instanceof CommitNotFoundError) {
            expect(result.lessonId).toBe("99.99.99");
            expect(result.branch).toBe("live-run-through");
          }
        })
    );
  });

  describe("PRD: User provides conflicting state flags", () => {
    it.effect(
      "should fail with InvalidBranchOperationError when both --problem and --solution are provided",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{ lessonId: string; message: string }>,
                _promptMessage: string
              ) {
                return "01.02.03";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          // Provide both --problem and --solution flags
          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.02.03"),
            problem: true,
            solution: true,
            demo: false,
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(InvalidBranchOperationError);
          if (result instanceof InvalidBranchOperationError) {
            expect(result.message).toBe(
              "Cannot use both --problem and --solution flags"
            );
          }
        })
    );
  });

  describe("PRD: User uses --demo with state flags", () => {
    it.effect(
      "should fail with InvalidBranchOperationError when --demo is used with --problem",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{ lessonId: string; message: string }>,
                _promptMessage: string
              ) {
                return "01.02.03";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          // Use --demo with --problem flag
          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.02.03"),
            problem: true,
            solution: false,
            demo: true,
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(InvalidBranchOperationError);
          if (result instanceof InvalidBranchOperationError) {
            expect(result.message).toBe(
              "Cannot use --demo with --problem or --solution flags"
            );
          }
        })
    );

    it.effect(
      "should fail with InvalidBranchOperationError when --demo is used with --solution",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{ lessonId: string; message: string }>,
                _promptMessage: string
              ) {
                return "01.02.03";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          // Use --demo with --solution flag
          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: true,
            demo: true,
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(InvalidBranchOperationError);
          if (result instanceof InvalidBranchOperationError) {
            expect(result.message).toBe(
              "Cannot use --demo with --problem or --solution flags"
            );
          }
        })
    );
  });

  describe("PRD: User interactively resets to solution state", () => {
    it.effect(
      "should reset to solution commit when user selects lesson and final code",
      () =>
        Effect.gen(function* () {
          let resetHardCalledWith: string | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure
ghi9012 01.02.01 Initial setup`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                return "matt/feature-branch";
              }
            ),
            getUncommittedChanges: Effect.fn(
              "getUncommittedChanges"
            )(function* () {
              return {
                hasUncommittedChanges: false,
                statusOutput: "",
              };
            }),
            resetHard: Effect.fn("resetHard")(function* (
              sha: string
            ) {
              resetHardCalledWith = sha;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{ lessonId: string; message: string }>,
                _promptMessage: string
              ) {
                return "01.02.03";
              }
            ),
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* (_branch: string) {
                return "reset-current" as const;
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify resetHard was called with the solution commit SHA
          expect(resetHardCalledWith).toBe("abc1234");
        })
    );
  });

  describe("PRD: User resets to problem state (before solution)", () => {
    it.effect(
      "should reset to parent commit when user selects problem state",
      () =>
        Effect.gen(function* () {
          let resetHardCalledWith: string | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure
ghi9012 01.02.01 Initial setup`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                return "matt/feature-branch";
              }
            ),
            getUncommittedChanges: Effect.fn(
              "getUncommittedChanges"
            )(function* () {
              return {
                hasUncommittedChanges: false,
                statusOutput: "",
              };
            }),
            getParentCommit: Effect.fn("getParentCommit")(function* (
              _sha: string
            ) {
              // Parent of abc1234 (solution) is parent123 (problem state)
              return "parent123";
            }),
            resetHard: Effect.fn("resetHard")(function* (
              sha: string
            ) {
              resetHardCalledWith = sha;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{ lessonId: string; message: string }>,
                _promptMessage: string
              ) {
                return "01.02.03";
              }
            ),
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              // User selects "Start the exercise" (problem state)
              return "problem" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* (_branch: string) {
                return "reset-current" as const;
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify resetHard was called with parent commit (problem state)
          expect(resetHardCalledWith).toBe("parent123");
        })
    );
  });

  describe("PRD: User attempts reset when on target branch", () => {
    it.effect(
      "should fail with InvalidBranchOperationError when on target branch and selecting reset-current",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                // User is on the same branch they're trying to reset from
                return "live-run-through";
              }
            ),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{ lessonId: string; message: string }>,
                _promptMessage: string
              ) {
                return "01.02.03";
              }
            ),
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* (_branch: string) {
                return "reset-current" as const;
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/repo",
            }),
            NodeContext.layer
          );

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(InvalidBranchOperationError);
          if (result instanceof InvalidBranchOperationError) {
            expect(result.message).toContain(
              'Cannot reset current branch when on target branch "live-run-through"'
            );
          }
        })
    );
  });
});
