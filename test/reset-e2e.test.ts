import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runReset } from "../src/reset.js";
import {
  PromptCancelledError,
  PromptService,
} from "../src/prompt-service.js";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  })
    .toString()
    .trim();

const configureGitUser = (cwd: string) => {
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@test.com");
};

/** Get the bare repo path from a working directory */
const getBareRepoPath = (workingDir: string) =>
  path.resolve(workingDir, "..", "bare.git");

/**
 * E2E tests for the reset command using real local Git repositories.
 * Uses real GitService with injectable configs. PromptService is mocked.
 */
describe("reset (e2e)", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const makeLayer = (
    workingDir: string,
    promptService: PromptService
  ) => {
    const deps = Layer.mergeAll(
      NodeFileSystem.layer,
      Layer.succeed(GitServiceConfig, { cwd: workingDir })
    );

    return Layer.mergeAll(
      Layer.effect(GitService, makeGitService).pipe(
        Layer.provide(deps)
      ),
      Layer.succeed(PromptService, promptService),
      NodeContext.layer
    );
  };

  describe("not a git repo", () => {
    it.effect(
      "should fail with NotAGitRepoError when not in a git repository",
      () =>
        Effect.gen(function* () {
          const tmpDir = fs.mkdtempSync("/tmp/not-git-");
          cleanup = () =>
            fs.rmSync(tmpDir, { recursive: true, force: true });

          const mockPromptService =
            fromPartial<PromptService>({});

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: "/tmp/dummy-upstream",
          }).pipe(
            Effect.provide(
              makeLayer(tmpDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe("NotAGitRepoError");
        })
    );
  });

  describe("non-existent lesson", () => {
    it.effect(
      "should fail with CommitNotFoundError for non-existent lesson",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          const mockPromptService =
            fromPartial<PromptService>({});

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("99.99.99"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe("CommitNotFoundError");
        })
    );
  });

  describe("interactive reset", () => {
    it.effect(
      "should reset directly to the selected commit",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays intro",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// arrays solution",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file contents match the selected commit directly
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// arrays solution");

          // Still on my-branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("my-branch");
        })
    );
  });

  describe("reset with specific lesson ID", () => {
    it.effect(
      "should reset to the exact commit for the given lesson ID",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays intro",
              }),
              commit("01.01.02 Arrays continued", {
                "src/01.ts": "// arrays continued",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.01.01"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// arrays intro");
        })
    );
  });

  describe("create new branch from lesson", () => {
    it.effect(
      "should create new branch at the selected commit",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays intro",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// arrays solution",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "create-branch" as const;
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "matt/lesson-work";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Should be on new branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("matt/lesson-work");

          // File contents should match selected commit
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// arrays solution");
        })
    );
  });

  describe("forced branch creation when on main", () => {
    it.effect(
      "should force create-branch when on main (skip selectResetAction)",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution",
              }),
            ])
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // We're on main after build
          const currentBefore = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBefore).toBe("main");

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "matt/lesson-work";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Should now be on the new branch
          const currentAfter = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentAfter).toBe("matt/lesson-work");

          // File should match selected commit
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");
        })
    );
  });

  describe("uncommitted changes warning", () => {
    it.effect(
      "should warn and proceed when user confirms with real dirty working tree",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// original",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // Create real dirty working tree
          fs.writeFileSync(
            `${repo.workingDir}/src/01.ts`,
            "// uncommitted changes"
          );

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
            confirmResetWithUncommittedChanges: Effect.fn(
              "confirmResetWithUncommittedChanges"
            )(function* () {
              // User confirms YES
            }),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify reset proceeded - file matches solution
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");
        })
    );

    it.effect(
      "should cancel reset when user declines with real dirty working tree",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// original",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // Create real dirty working tree
          fs.writeFileSync(
            `${repo.workingDir}/src/01.ts`,
            "// uncommitted changes"
          );

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
            confirmResetWithUncommittedChanges: Effect.fn(
              "confirmResetWithUncommittedChanges"
            )(function* () {
              return yield* Effect.fail(
                new PromptCancelledError()
              );
            }),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result).toBeInstanceOf(PromptCancelledError);

          // File should still have uncommitted changes (reset didn't happen)
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// uncommitted changes");
        })
    );
  });

  describe("demo mode", () => {
    it.effect(
      "should apply changes as unstaged (files modified but not staged)",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// problem",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: true,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file has solution content
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");

          // Verify changes are unstaged (modified but not in index)
          const status = git(
            repo.workingDir,
            "status",
            "--porcelain"
          );
          // Should show modified files as unstaged
          expect(status).toContain("src/01.ts");
          // Files should NOT be staged (no "A " or "M " prefix with space after)
          const lines = status.split("\n").filter(Boolean);
          for (const line of lines) {
            // First char is index status, second is working tree status
            // Unstaged changes have ' M' (space then M)
            expect(line[0]).not.toBe("A");
          }
        })
    );
  });

  describe("prompt cancellation", () => {
    it.effect(
      "should propagate PromptCancelledError when user cancels lesson selection",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return yield* Effect.fail(
                  new PromptCancelledError()
                );
              }
            ),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result).toBeInstanceOf(PromptCancelledError);
        })
    );
  });

  describe("lesson ID normalization", () => {
    it.effect(
      "should normalize 1.1.1 to 01.01.01 and find matching commit",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays intro",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("1.1.1"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// arrays intro");
        })
    );

    it.effect(
      "should normalize lesson ID with dashes (1-2-3) to 01.02.03",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.02.03 Objects intro", {
                "src/02.ts": "// objects",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("1-2-3"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/02.ts`,
            "utf-8"
          );
          expect(content).toBe("// objects");
        })
    );
  });

  describe("reset when already on target branch", () => {
    it.effect(
      "should fail when on target branch and ensureUpstreamBranchConnected cannot track",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .build();

          cleanup = repo.cleanup;

          // We're on live-run-through after build
          git(
            repo.workingDir,
            "checkout",
            "live-run-through"
          );

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.01";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          // ensureUpstreamBranchConnected can't delete the current branch
          expect(result._tag).toBe("FailedToTrackBranchError");
        })
    );
  });

  describe("branch creation failure (already exists)", () => {
    it.effect(
      "should fail with FailedToCreateBranchError when branch already exists",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // Create a branch that will conflict
          git(
            repo.workingDir,
            "branch",
            "existing-branch"
          );

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.01";
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "existing-branch";
              }
            ),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe(
            "FailedToCreateBranchError"
          );
        })
    );
  });

  describe("custom --branch option", () => {
    it.effect(
      "should reset from a custom source branch",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01.01 Main lesson", {
                "src/main.ts": "// main",
              }),
            ])
            .withBranch("custom-lessons", [
              commit("02.01.01 Custom lesson", {
                "src/custom.ts": "// custom content",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "02.01.01";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "custom-lessons",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file from custom branch exists
          const content = fs.readFileSync(
            `${repo.workingDir}/src/custom.ts`,
            "utf-8"
          );
          expect(content).toBe("// custom content");

          // Still on my-branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("my-branch");
        })
    );

    it.effect(
      "should reset to specific lesson from custom branch by ID",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01.01 Main lesson", {
                "src/main.ts": "// main",
              }),
            ])
            .withBranch("custom-lessons", [
              commit("03.01.01 First custom", {
                "src/first.ts": "// first",
              }),
              commit("03.01.02 Second custom", {
                "src/second.ts": "// second",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "custom-lessons",
            lessonId: Option.some("03.01.02"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/second.ts`,
            "utf-8"
          );
          expect(content).toBe("// second");
        })
    );
  });

  describe("invalid lesson ID format fallback", () => {
    it.effect(
      "should search using raw input when lesson ID does not match expected format",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.02.03 Some lesson", {
                "src/01.ts": "// content",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          const mockPromptService =
            fromPartial<PromptService>({});

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("invalid-id"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe("CommitNotFoundError");
        })
    );
  });

  describe("reset to main", () => {
    it.effect(
      "should reset current branch to upstream/main when lessonId is 'main'",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base setup",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("main"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file contents match upstream/main
          const content = fs.readFileSync(
            `${repo.workingDir}/src/base.ts`,
            "utf-8"
          );
          expect(content).toBe("// base setup");

          // Still on my-branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("my-branch");
        })
    );

    it.effect(
      "should fail with InvalidBranchOperationError when on main branch",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base setup",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .build();

          cleanup = repo.cleanup;

          // We're on main after build (no working branch specified)
          const currentBefore = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBefore).toBe("main");

          const mockPromptService =
            fromPartial<PromptService>({});

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("main"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe(
            "InvalidBranchOperationError"
          );
        })
    );

    it.effect(
      "should reset to upstream/main when 'main' is selected interactively",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base setup",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "main";
              }
            ),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file contents match upstream/main
          const content = fs.readFileSync(
            `${repo.workingDir}/src/base.ts`,
            "utf-8"
          );
          expect(content).toBe("// base setup");

          // Still on my-branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("my-branch");
        })
    );

    it.effect(
      "should apply upstream/main as unstaged changes in demo mode",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base setup",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService =
            fromPartial<PromptService>({});

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("main"),
            demo: true,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file has main content
          const content = fs.readFileSync(
            `${repo.workingDir}/src/base.ts`,
            "utf-8"
          );
          expect(content).toBe("// base setup");

          // Verify changes are unstaged
          const status = git(
            repo.workingDir,
            "status",
            "--porcelain"
          );
          // May show as "?? src/" (untracked dir) or individual files
          expect(status).toContain("src/");
        })
    );

    it.effect(
      "should create new branch at upstream/main when create-branch is selected",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("00.00.01 Base setup", {
                "src/base.ts": "// base setup",
              }),
            ])
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "create-branch" as const;
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "fresh-start";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("main"),
            demo: false,
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Should be on new branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("fresh-start");

          // File contents should match upstream/main
          const content = fs.readFileSync(
            `${repo.workingDir}/src/base.ts`,
            "utf-8"
          );
          expect(content).toBe("// base setup");
        })
    );
  });
});
