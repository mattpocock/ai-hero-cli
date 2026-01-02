import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import {
  InvalidBranchOperationError,
  runCherryPick,
} from "../src/cherry-pick.js";
import { PromptCancelledError } from "../src/prompt-service.js";
import {
  CommitNotFoundError,
  selectLessonCommit,
} from "../src/commit-utils.js";
import {
  CherryPickConflictError,
  FailedToCreateBranchError,
  GitService,
  GitServiceConfig,
  NoUpstreamFoundError,
  NotAGitRepoError,
} from "../src/git-service.js";
import { PromptService } from "../src/prompt-service.js";

/**
 * Tests for the cherry-pick command business logic.
 * Per CLAUDE.md: Mock GitService and PromptService to test command behavior.
 *
 * These tests verify PRD scenarios for cherry-pick command.
 */

describe("cherry-pick", () => {
  describe("PRD: User interactively selects and cherry-picks a lesson", () => {
    it.effect(
      "should select lesson from autocomplete and return commit info",
      () =>
        Effect.gen(function* () {
          // Arrange: Mock git log with lesson commits
          const mockGitService = fromPartial<GitService>({
            getLogOneline: Effect.fn("getLogOneline")(function* (
              branch: string
            ) {
              if (branch === "HEAD") {
                // Current branch has no lesson commits
                return "abc1234 Initial commit";
              }
              // Target branch has lesson commits
              return `def5678 01.02.03 Add new feature
ghi9012 01.02.02 Setup project
jkl3456 01.02.01 Initial setup`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                _commits: Array<{
                  lessonId: string;
                  message: string;
                }>,
                _promptMessage: string
              ) {
                // User selects lesson 01.02.03
                return "01.02.03";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/dir",
            }),
            NodeContext.layer
          );

          // Act
          const result = yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.none(),
            promptMessage:
              "Which lesson do you want to cherry-pick? (type to search)",
            excludeCurrentBranch: true,
          }).pipe(Effect.provide(testLayer));

          // Assert
          expect(result.lessonId).toBe("01.02.03");
          expect(result.commit.sha).toBe("def5678");
          expect(result.commit.message).toBe("Add new feature");
        })
    );
  });

  describe("PRD: User cherry-picks a specific lesson by ID", () => {
    it.effect(
      "should find commit matching lesson ID when provided directly",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `def5678 01.02.03 Add new feature
ghi9012 01.02.02 Setup project`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            // Should NOT be called when lessonId is provided
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                throw new Error(
                  "selectLessonCommit should not be called"
                );
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/dir",
            }),
            NodeContext.layer
          );

          // Act - provide lesson ID directly
          const result = yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.some("01.02.03"),
            promptMessage: "Select lesson",
            excludeCurrentBranch: false,
          }).pipe(Effect.provide(testLayer));

          // Assert
          expect(result.lessonId).toBe("01.02.03");
          expect(result.commit.sha).toBe("def5678");
        })
    );
  });

  describe("PRD: Already-applied lessons are excluded from selection", () => {
    it.effect(
      "should filter out lessons already on current branch",
      () =>
        Effect.gen(function* () {
          let capturedCommits: Array<{
            lessonId: string;
            message: string;
          }> = [];

          const mockGitService = fromPartial<GitService>({
            getLogOneline: Effect.fn("getLogOneline")(function* (
              branch: string
            ) {
              if (branch === "HEAD") {
                // Current branch already has 01.02.01
                return `xyz7890 01.02.01 Initial setup`;
              }
              // Target branch has all lessons
              return `def5678 01.02.03 Add new feature
ghi9012 01.02.02 Setup project
jkl3456 01.02.01 Initial setup`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                commits: Array<{
                  lessonId: string;
                  message: string;
                }>,
                _promptMessage: string
              ) {
                capturedCommits = commits;
                return "01.02.02";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/dir",
            }),
            NodeContext.layer
          );

          // Act
          yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.none(),
            promptMessage: "Select lesson",
            excludeCurrentBranch: true,
          }).pipe(Effect.provide(testLayer));

          // Assert: 01.02.01 should be excluded
          const lessonIds = capturedCommits.map(
            (c) => c.lessonId
          );
          expect(lessonIds).not.toContain("01.02.01");
          expect(lessonIds).toContain("01.02.02");
          expect(lessonIds).toContain("01.02.03");
        })
    );
  });

  describe("PRD: Multiple commits with same lesson ID uses latest", () => {
    it.effect(
      "should select the latest commit when multiple have same lesson ID",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              // Two commits with same lesson ID - first is older, second is newer
              return `older123 01.01.01 First version
newer456 01.01.01 Updated version`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.01";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/dir",
            }),
            NodeContext.layer
          );

          // Act
          const result = yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.none(),
            promptMessage: "Select lesson",
            excludeCurrentBranch: false,
          }).pipe(Effect.provide(testLayer));

          // Assert: Should get the latest (last in list) commit
          expect(result.commit.sha).toBe("newer456");
          expect(result.commit.message).toBe("Updated version");
        })
    );
  });

  describe("PRD: User requests non-existent lesson", () => {
    it.effect(
      "should fail with CommitNotFoundError for non-existent lesson",
      () =>
        Effect.gen(function* () {
          const mockGitService = fromPartial<GitService>({
            getLogOneline: Effect.fn("getLogOneline")(function* (
              _branch: string
            ) {
              return `def5678 01.02.03 Add new feature`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>(
            {}
          );

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/dir",
            }),
            NodeContext.layer
          );

          // Act & Assert
          const result = yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.some("99.99.99"),
            promptMessage: "Select lesson",
            excludeCurrentBranch: false,
          }).pipe(
            Effect.provide(testLayer),
            Effect.flip // Convert success to failure and vice versa
          );

          expect(result).toBeInstanceOf(CommitNotFoundError);
          if (result instanceof CommitNotFoundError) {
            expect(result.lessonId).toBe("99.99.99");
            expect(result.branch).toBe("live-run-through");
          }
        })
    );
  });

  describe("PRD: User is prompted to create branch when on main", () => {
    it.effect(
      "should prompt for new branch when current branch is main",
      () =>
        Effect.gen(function* () {
          let checkoutNewBranchCalled = false;
          let createdBranchName = "";
          let cherryPickCalled = false;
          let cherryPickSha = "";

          const mockGitService = fromPartial<GitService>({
            ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
              function* () {}
            ),
            ensureUpstreamBranchConnected: Effect.fn(
              "ensureUpstreamBranchConnected"
            )(function* (_opts: { targetBranch: string }) {}),
            getLogOneline: Effect.fn("getLogOneline")(function* (
              branch: string
            ) {
              if (branch === "HEAD") {
                return "abc1234 Initial commit";
              }
              return `def5678 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                return "main";
              }
            ),
            checkoutNewBranch: Effect.fn("checkoutNewBranch")(
              function* (branchName: string) {
                checkoutNewBranchCalled = true;
                createdBranchName = branchName;
              }
            ),
            cherryPick: Effect.fn("cherryPick")(function* (
              sha: string
            ) {
              cherryPickCalled = true;
              cherryPickSha = sha;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.02.03";
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* (_context: "working" | "new") {
                return "matt/feature-work";
              }
            ),
          });

          const testLayer = Layer.mergeAll(
            Layer.succeed(GitService, mockGitService),
            Layer.succeed(PromptService, mockPromptService),
            Layer.succeed(GitServiceConfig, {
              cwd: "/test/dir",
            }),
            NodeContext.layer
          );

          yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
          }).pipe(Effect.provide(testLayer));

          // Assert: branch was created
          expect(checkoutNewBranchCalled).toBe(true);
          expect(createdBranchName).toBe("matt/feature-work");

          // Assert: cherry-pick was called
          expect(cherryPickCalled).toBe(true);
          expect(cherryPickSha).toBe("def5678");
        })
    );
  });

  describe("PRD: User runs cherry-pick outside git repo", () => {
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

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
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

  describe("PRD: User runs cherry-pick without valid upstream", () => {
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

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
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

  describe("PRD: User attempts cherry-pick from same branch", () => {
    it.effect(
      "should fail with InvalidBranchOperationError when on target branch",
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
              branch: string
            ) {
              if (branch === "HEAD") {
                // Current branch has no lesson commits yet
                return "abc1234 Initial commit";
              }
              // Target branch has lesson commits
              return `def5678 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                // User is on the same branch they're trying to cherry-pick from
                return "live-run-through";
              }
            ),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
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

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(InvalidBranchOperationError);
          if (result instanceof InvalidBranchOperationError) {
            expect(result.message).toContain(
              'Cannot cherry-pick when on target branch "live-run-through"'
            );
          }
        })
    );
  });

  describe("PRD: Cherry-pick results in merge conflict", () => {
    it.effect(
      "should fail with CherryPickConflictError when git encounters merge conflict",
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
              branch: string
            ) {
              if (branch === "HEAD") {
                return "abc1234 Initial commit";
              }
              return `def5678 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                return "matt/feature-work";
              }
            ),
            cherryPick: Effect.fn("cherryPick")(function* (
              sha: string
            ) {
              return yield* Effect.fail(
                new CherryPickConflictError({
                  range: sha,
                  message: `Cherry-pick conflict on range ${sha}`,
                })
              );
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
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

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(CherryPickConflictError);
          if (result instanceof CherryPickConflictError) {
            expect(result.range).toBe("def5678");
            expect(result.message).toContain("Cherry-pick conflict");
          }
        })
    );
  });

  describe("PRD: User cancels lesson selection", () => {
    it.effect(
      "should propagate PromptCancelledError when user presses Ctrl+C during lesson selection",
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
              branch: string
            ) {
              if (branch === "HEAD") {
                return "abc1234 Initial commit";
              }
              return `def5678 01.02.03 Add new feature`;
            }),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                // User presses Ctrl+C during prompt
                return yield* Effect.fail(new PromptCancelledError());
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

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
          }).pipe(Effect.provide(testLayer), Effect.flip);

          // Verify PromptCancelledError is propagated
          expect(result).toBeInstanceOf(PromptCancelledError);
        })
    );
  });

  describe("PRD: Branch creation fails during main protection flow", () => {
    it.effect(
      "should fail with FailedToCreateBranchError when branch already exists",
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
              branch: string
            ) {
              if (branch === "HEAD") {
                return "abc1234 Initial commit";
              }
              return `def5678 01.02.03 Add new feature`;
            }),
            getCurrentBranch: Effect.fn("getCurrentBranch")(
              function* () {
                return "main";
              }
            ),
            checkoutNewBranch: Effect.fn("checkoutNewBranch")(
              function* (branchName: string) {
                // Branch already exists, git checkout -b fails
                return yield* Effect.fail(
                  new FailedToCreateBranchError({
                    branchName,
                    message: `Failed to create branch ${branchName} (exit code: 128)`,
                  })
                );
              }
            ),
          });

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.02.03";
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* (_context: "working" | "new") {
                return "existing-branch";
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

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
          }).pipe(Effect.provide(testLayer), Effect.flip);

          expect(result).toBeInstanceOf(FailedToCreateBranchError);
          if (result instanceof FailedToCreateBranchError) {
            expect(result.branchName).toBe("existing-branch");
            expect(result.message).toContain(
              "Failed to create branch existing-branch"
            );
            expect(result.message).toContain("exit code");
          }
        })
    );
  });
});
