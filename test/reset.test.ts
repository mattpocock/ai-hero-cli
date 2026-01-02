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
import {
  PromptCancelledError,
  PromptService,
} from "../src/prompt-service.js";
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

  describe("PRD: User resets to solution using --solution flag", () => {
    it.effect(
      "should skip state selection and reset to solution commit when --solution flag is provided",
      () =>
        Effect.gen(function* () {
          let resetHardCalledWith: string | undefined;
          let selectProblemOrSolutionCalled = false;

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
def5678 01.02.02 Setup base structure`;
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
              selectProblemOrSolutionCalled = true;
              return "problem" as const; // Should NOT be called
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: true, // --solution flag provided
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify state selection was skipped
          expect(selectProblemOrSolutionCalled).toBe(false);
          // Verify resetHard was called with solution commit SHA
          expect(resetHardCalledWith).toBe("abc1234");
        })
    );
  });

  describe("PRD: User resets to problem using --problem flag", () => {
    it.effect(
      "should skip state selection and reset to parent commit when --problem flag is provided",
      () =>
        Effect.gen(function* () {
          let resetHardCalledWith: string | undefined;
          let selectProblemOrSolutionCalled = false;

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
def5678 01.02.02 Setup base structure`;
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
              selectProblemOrSolutionCalled = true;
              return "solution" as const; // Should NOT be called
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
            lessonId: Option.some("01.02.03"),
            problem: true, // --problem flag provided
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify state selection was skipped
          expect(selectProblemOrSolutionCalled).toBe(false);
          // Verify resetHard was called with parent commit (problem state)
          expect(resetHardCalledWith).toBe("parent123");
        })
    );
  });

  describe("PRD: User creates new branch from lesson", () => {
    it.effect(
      "should create new branch at target commit when user selects create-branch",
      () =>
        Effect.gen(function* () {
          let checkoutNewBranchAtCalledWith:
            | { branchName: string; sha: string }
            | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "matt/feature-branch";
            }),
            checkoutNewBranchAt: Effect.fn("checkoutNewBranchAt")(function* (
              branchName: string,
              sha: string
            ) {
              checkoutNewBranchAtCalledWith = { branchName, sha };
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "solution" as const;
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              return "create-branch" as const;
            }),
            inputBranchName: Effect.fn("inputBranchName")(function* (
              _context: "working" | "new"
            ) {
              return "matt/lesson-work";
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify checkoutNewBranchAt was called with correct args
          expect(checkoutNewBranchAtCalledWith).toEqual({
            branchName: "matt/lesson-work",
            sha: "abc1234",
          });
        })
    );

    it.effect(
      "should create branch at parent commit when user selects problem state",
      () =>
        Effect.gen(function* () {
          let checkoutNewBranchAtCalledWith:
            | { branchName: string; sha: string }
            | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "matt/feature-branch";
            }),
            getParentCommit: Effect.fn("getParentCommit")(function* (
              _sha: string
            ) {
              return "parent123";
            }),
            checkoutNewBranchAt: Effect.fn("checkoutNewBranchAt")(function* (
              branchName: string,
              sha: string
            ) {
              checkoutNewBranchAtCalledWith = { branchName, sha };
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "problem" as const;
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              return "create-branch" as const;
            }),
            inputBranchName: Effect.fn("inputBranchName")(function* (
              _context: "working" | "new"
            ) {
              return "matt/lesson-work";
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify checkoutNewBranchAt was called with parent commit (problem state)
          expect(checkoutNewBranchAtCalledWith).toEqual({
            branchName: "matt/lesson-work",
            sha: "parent123",
          });
        })
    );
  });

  describe("PRD: User is forced to create branch when on main", () => {
    it.effect(
      "should skip action selection and force create-branch when on main",
      () =>
        Effect.gen(function* () {
          let checkoutNewBranchAtCalledWith:
            | { branchName: string; sha: string }
            | undefined;
          let selectResetActionCalled = false;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              // User is on main branch
              return "main";
            }),
            checkoutNewBranchAt: Effect.fn("checkoutNewBranchAt")(function* (
              branchName: string,
              sha: string
            ) {
              checkoutNewBranchAtCalledWith = { branchName, sha };
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "solution" as const;
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              selectResetActionCalled = true;
              return "reset-current" as const; // Should NOT be called
            }),
            inputBranchName: Effect.fn("inputBranchName")(function* (
              _context: "working" | "new"
            ) {
              return "matt/lesson-work";
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify selectResetAction was NOT called (skipped)
          expect(selectResetActionCalled).toBe(false);
          // Verify checkoutNewBranchAt was called with correct args
          expect(checkoutNewBranchAtCalledWith).toEqual({
            branchName: "matt/lesson-work",
            sha: "abc1234",
          });
        })
    );

    it.effect(
      "should create branch at parent commit when on main and problem state selected",
      () =>
        Effect.gen(function* () {
          let checkoutNewBranchAtCalledWith:
            | { branchName: string; sha: string }
            | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "main";
            }),
            getParentCommit: Effect.fn("getParentCommit")(function* (
              _sha: string
            ) {
              return "parent123";
            }),
            checkoutNewBranchAt: Effect.fn("checkoutNewBranchAt")(function* (
              branchName: string,
              sha: string
            ) {
              checkoutNewBranchAtCalledWith = { branchName, sha };
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "problem" as const;
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(function* (
              _context: "working" | "new"
            ) {
              return "matt/problem-work";
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify checkoutNewBranchAt was called with parent commit (problem state)
          expect(checkoutNewBranchAtCalledWith).toEqual({
            branchName: "matt/problem-work",
            sha: "parent123",
          });
        })
    );
  });

  describe("PRD: User is warned about uncommitted changes", () => {
    it.effect(
      "should warn about uncommitted changes and proceed when user confirms",
      () =>
        Effect.gen(function* () {
          let resetHardCalledWith: string | undefined;
          let confirmResetWithUncommittedChangesCalled = false;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "matt/feature-branch";
            }),
            getUncommittedChanges: Effect.fn("getUncommittedChanges")(
              function* () {
                return {
                  hasUncommittedChanges: true,
                  statusOutput: " M src/index.ts\n?? new-file.ts",
                };
              }
            ),
            resetHard: Effect.fn("resetHard")(function* (sha: string) {
              resetHardCalledWith = sha;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "solution" as const;
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              return "reset-current" as const;
            }),
            confirmResetWithUncommittedChanges: Effect.fn(
              "confirmResetWithUncommittedChanges"
            )(function* () {
              confirmResetWithUncommittedChangesCalled = true;
              // User confirms YES to proceed
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify confirmation prompt was called
          expect(confirmResetWithUncommittedChangesCalled).toBe(true);
          // Verify reset still proceeded after confirmation
          expect(resetHardCalledWith).toBe("abc1234");
        })
    );

    it.effect(
      "should cancel reset when user declines confirmation",
      () =>
        Effect.gen(function* () {
          let resetHardCalled = false;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "matt/feature-branch";
            }),
            getUncommittedChanges: Effect.fn("getUncommittedChanges")(
              function* () {
                return {
                  hasUncommittedChanges: true,
                  statusOutput: " M src/index.ts",
                };
              }
            ),
            resetHard: Effect.fn("resetHard")(function* (_sha: string) {
              resetHardCalled = true;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "solution" as const;
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              return "reset-current" as const;
            }),
            confirmResetWithUncommittedChanges: Effect.fn(
              "confirmResetWithUncommittedChanges"
            )(function* () {
              // User declines - throw PromptCancelledError
              return yield* Effect.fail(new PromptCancelledError());
            }),
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

          // Verify reset was cancelled
          expect(result).toBeInstanceOf(PromptCancelledError);
          expect(resetHardCalled).toBe(false);
        })
    );

    it.effect(
      "should not prompt for confirmation when no uncommitted changes",
      () =>
        Effect.gen(function* () {
          let confirmResetWithUncommittedChangesCalled = false;
          let resetHardCalledWith: string | undefined;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature`;
            }),
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
            resetHard: Effect.fn("resetHard")(function* (sha: string) {
              resetHardCalledWith = sha;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                return "solution" as const;
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              return "reset-current" as const;
            }),
            confirmResetWithUncommittedChanges: Effect.fn(
              "confirmResetWithUncommittedChanges"
            )(function* () {
              confirmResetWithUncommittedChangesCalled = true;
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(Effect.provide(testLayer));

          // Verify confirmation prompt was NOT called
          expect(confirmResetWithUncommittedChangesCalled).toBe(false);
          // Verify reset proceeded
          expect(resetHardCalledWith).toBe("abc1234");
        })
    );
  });

  describe("PRD: User runs reset in demo mode", () => {
    it.effect(
      "should skip prompts, reset to solution, then undo commit and unstage changes",
      () =>
        Effect.gen(function* () {
          let resetHardCalledWith: string | undefined;
          let resetHeadCalled = false;
          let restoreStagedCalled = false;
          let selectProblemOrSolutionCalled = false;
          let selectResetActionCalled = false;
          let getUncommittedChangesCalled = false;

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(function* () {}),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `abc1234 01.02.03 Add new feature
def5678 01.02.02 Setup base structure`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(function* () {
              return "matt/feature-branch";
            }),
            getUncommittedChanges: Effect.fn("getUncommittedChanges")(
              function* () {
                getUncommittedChangesCalled = true;
                return {
                  hasUncommittedChanges: true,
                  statusOutput: " M src/index.ts",
                };
              }
            ),
            resetHard: Effect.fn("resetHard")(function* (sha: string) {
              resetHardCalledWith = sha;
            }),
            resetHead: Effect.fn("resetHead")(function* () {
              resetHeadCalled = true;
            }),
            restoreStaged: Effect.fn("restoreStaged")(function* () {
              restoreStagedCalled = true;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(function* (
              _commits: Array<{ lessonId: string; message: string }>,
              _promptMessage: string
            ) {
              return "01.02.03";
            }),
            selectProblemOrSolution: Effect.fn("selectProblemOrSolution")(
              function* () {
                selectProblemOrSolutionCalled = true;
                return "problem" as const; // Should NOT be called
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(function* (
              _branch: string
            ) {
              selectResetActionCalled = true;
              return "create-branch" as const; // Should NOT be called
            }),
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
            lessonId: Option.some("01.02.03"),
            problem: false,
            solution: false,
            demo: true, // Demo mode enabled
          }).pipe(Effect.provide(testLayer));

          // Verify prompts were skipped
          expect(selectProblemOrSolutionCalled).toBe(false);
          expect(selectResetActionCalled).toBe(false);
          // Verify uncommitted changes check was skipped
          expect(getUncommittedChangesCalled).toBe(false);
          // Verify reset to solution commit
          expect(resetHardCalledWith).toBe("abc1234");
          // Verify demo mode operations: undo commit and unstage
          expect(resetHeadCalled).toBe(true);
          expect(restoreStagedCalled).toBe(true);
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
