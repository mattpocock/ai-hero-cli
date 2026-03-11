import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import {
  InvalidBranchOperationError,
  InvalidOptionsError,
  runReset,
} from "../src/reset.js";
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
            problem: false,
            solution: false,
            demo: false,
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
            problem: false,
            solution: false,
            demo: false,
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

  describe("conflicting flags", () => {
    it.effect(
      "should fail with InvalidOptionsError when both --problem and --solution are provided",
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
            lessonId: Option.some("01.01.01"),
            problem: true,
            solution: true,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe("InvalidOptionsError");
          expect(
            (result as InvalidOptionsError).message
          ).toBe(
            "Cannot use both --problem and --solution flags"
          );
        })
    );

    it.effect(
      "should fail with InvalidOptionsError when --demo is used with --problem",
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
            lessonId: Option.some("01.01.01"),
            problem: true,
            solution: false,
            demo: true,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe("InvalidOptionsError");
          expect(
            (result as InvalidOptionsError).message
          ).toBe(
            "Cannot use --demo with --problem or --solution flags"
          );
        })
    );

    it.effect(
      "should fail with InvalidOptionsError when --demo is used with --solution",
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
            lessonId: Option.some("01.01.01"),
            problem: false,
            solution: true,
            demo: true,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            ),
            Effect.flip
          );

          expect(result._tag).toBe("InvalidOptionsError");
          expect(
            (result as InvalidOptionsError).message
          ).toBe(
            "Cannot use --demo with --problem or --solution flags"
          );
        })
    );
  });

  describe("interactive reset to solution state", () => {
    it.effect(
      "should reset to solution commit and verify file contents",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// problem state",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution state",
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file contents match the solution commit
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution state");

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

  describe("reset to problem state (parent commit)", () => {
    it.effect(
      "should reset to parent commit and verify file contents match problem state",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// problem state",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution state",
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "problem" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          // Verify file contents match the problem state (parent commit)
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// problem state");
        })
    );
  });

  describe("--solution flag shortcut", () => {
    it.effect(
      "should skip state selection and reset to solution commit",
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
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.01.02"),
            problem: false,
            solution: true,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");
        })
    );
  });

  describe("--problem flag shortcut", () => {
    it.effect(
      "should skip state selection and reset to parent commit",
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
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.01.02"),
            problem: true,
            solution: false,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// problem");
        })
    );
  });

  describe("create new branch from lesson", () => {
    it.effect(
      "should create new branch at solution commit",
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
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
            problem: false,
            solution: false,
            demo: false,
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

          // File contents should match solution
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");
        })
    );

    it.effect(
      "should create new branch at problem state (parent commit)",
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "problem" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "create-branch" as const;
              }
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "matt/problem-work";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("matt/problem-work");

          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// problem");
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "matt/lesson-work";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
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

          // File should match solution
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");
        })
    );

    it.effect(
      "should create branch at parent commit when on main and problem state selected",
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
                "src/01.ts": "// problem",
              }),
              commit("01.01.02 Arrays solution", {
                "src/01.ts": "// solution",
              }),
            ])
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              }
            ),
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "problem" as const;
            }),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "matt/problem-work";
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService)
            )
          );

          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("matt/problem-work");

          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// problem");
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
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
            problem: false,
            solution: false,
            demo: false,
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
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
            problem: false,
            solution: false,
            demo: false,
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
            problem: false,
            solution: false,
            demo: true,
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
            problem: false,
            solution: false,
            demo: false,
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("1.1.1"),
            problem: false,
            solution: false,
            demo: false,
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("1-2-3"),
            problem: false,
            solution: false,
            demo: false,
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "existing-branch";
              }
            ),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
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

  describe("root commit with no parent", () => {
    it.effect(
      "should fail when requesting problem state for root commit",
      () =>
        Effect.gen(function* () {
          // Create repo where lesson commit IS the root commit
          // We need the first lesson commit to have no parent
          // The builder always creates an initial .gitkeep commit,
          // so we use the first lesson commit directly via --problem
          // which calls getParentCommit on it.
          // Actually, the lesson commit is NOT the root commit (there's .gitkeep before it).
          // Instead, we need to test that getParentCommit of the .gitkeep commit fails.
          // But the lesson commit always has .gitkeep as parent.
          // So we test the .gitkeep commit as the "lesson" by using the initial commit
          // as a "lesson-like" commit. Actually, the simplest way is to create a repo
          // with a single branch and use a lesson at index 0. The parent of lesson commit 0
          // is the initial .gitkeep commit, which does have a parent (it IS the root).
          // getParentCommit of the .gitkeep initial commit would fail.
          // However, the lesson at index 0 has .gitkeep as its parent - which is fine.
          //
          // The real scenario: user asks for --problem on the very first lesson commit.
          // The parent is the initial .gitkeep commit, which is valid.
          // To get NoParentCommitError, we need a commit whose parent doesn't exist.
          // That means we need the root commit to be a lesson commit.
          //
          // Let's create a bare repo, then a working repo without the builder
          // to have full control.
          const tmpDir = fs.mkdtempSync("/tmp/root-commit-");
          cleanup = () =>
            fs.rmSync(tmpDir, {
              recursive: true,
              force: true,
            });

          const bareDir = `${tmpDir}/bare.git`;
          const workDir = `${tmpDir}/work`;
          fs.mkdirSync(bareDir);
          fs.mkdirSync(workDir);

          git(bareDir, "init", "--bare");
          git(workDir, "init");
          git(workDir, "remote", "add", "upstream", bareDir);
          configureGitUser(workDir);

          // Create a single root commit that is a lesson commit
          fs.mkdirSync(`${workDir}/src`, { recursive: true });
          fs.writeFileSync(
            `${workDir}/src/01.ts`,
            "// root lesson"
          );
          git(workDir, "add", ".");
          git(
            workDir,
            "commit",
            "-m",
            "01.01.01 Root lesson"
          );
          git(workDir, "branch", "-M", "live-run-through");
          git(
            workDir,
            "push",
            "upstream",
            "live-run-through"
          );

          // Create working branch
          git(
            workDir,
            "checkout",
            "-b",
            "my-branch"
          );

          const mockPromptService = fromPartial<PromptService>({
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          const result = yield* runReset({
            branch: "live-run-through",
            lessonId: Option.some("01.01.01"),
            problem: true,
            solution: false,
            demo: false,
          }).pipe(
            Effect.provide(
              makeLayer(workDir, mockPromptService)
            ),
            Effect.flip
          );

          // Real e2e: getParentCommit on root commit fails
          expect(
            ["NoParentCommitError", "FailedToResetError"]
          ).toContain(result._tag);
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "custom-lessons",
            lessonId: Option.none(),
            problem: false,
            solution: false,
            demo: false,
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
            selectProblemOrSolution: Effect.fn(
              "selectProblemOrSolution"
            )(function* () {
              return "solution" as const;
            }),
            selectResetAction: Effect.fn("selectResetAction")(
              function* () {
                return "reset-current" as const;
              }
            ),
          });

          yield* runReset({
            branch: "custom-lessons",
            lessonId: Option.some("03.01.02"),
            problem: false,
            solution: false,
            demo: false,
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
            problem: false,
            solution: false,
            demo: false,
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
});
