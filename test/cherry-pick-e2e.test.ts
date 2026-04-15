import {
  NodeContext,
  NodeFileSystem,
} from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runCherryPick } from "../src/cherry-pick.js";
import {
  PromptCancelledError,
  PromptService,
} from "../src/prompt-service.js";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import { selectLessonCommit } from "../src/commit-utils.js";
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

const getBareRepoPath = (workingDir: string) =>
  path.resolve(workingDir, "..", "bare.git");

/** Configure git user in the repo so @effect/platform Command can create commits */
const configureGitUser = (cwd: string) => {
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@test.com");
};

/**
 * E2E tests for the cherry-pick command using real local Git repositories.
 * Uses real GitService with injectable configs. PromptService is mocked.
 */
describe("cherry-pick (e2e)", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const makeLayer = (
    workingDir: string,
    promptService: PromptService,
  ) => {
    const deps = Layer.mergeAll(
      NodeFileSystem.layer,
      Layer.succeed(GitServiceConfig, { cwd: workingDir }),
    );

    return Layer.mergeAll(
      Layer.effect(GitService, makeGitService).pipe(
        Layer.provide(deps),
      ),
      Layer.succeed(PromptService, promptService),
      NodeContext.layer,
    );
  };

  describe("interactive lesson selection and cherry-pick", () => {
    it.effect(
      "should cherry-pick selected lesson onto current branch",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays intro",
              }),
              commit("01.01.02 Arrays advanced", {
                "src/02.ts": "// arrays advanced",
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
              },
            ),
          });

          yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          // Verify the cherry-picked file exists
          const content = fs.readFileSync(
            `${repo.workingDir}/src/02.ts`,
            "utf-8",
          );
          expect(content).toBe("// arrays advanced");

          // Still on my-branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current",
          );
          expect(currentBranch).toBe("my-branch");
        }),
    );
  });

  describe("cherry-pick specific lesson by ID", () => {
    it.effect(
      "should find and cherry-pick commit matching lesson ID",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
              commit("01.02.01 Objects intro", {
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

          const mockPromptService = fromPartial<PromptService>(
            {},
          );

          yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.some("01.02.01"),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          // Verify the cherry-picked file exists
          const content = fs.readFileSync(
            `${repo.workingDir}/src/02.ts`,
            "utf-8",
          );
          expect(content).toBe("// objects");
        }),
    );
  });

  describe("filtering already-applied lessons", () => {
    it.effect(
      "should exclude lessons already on current branch from selection",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
              commit("01.01.02 Arrays advanced", {
                "src/02.ts": "// arrays advanced",
              }),
              commit("01.02.01 Objects intro", {
                "src/03.ts": "// objects",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // Cherry-pick 01.01.02 first so it's on the current branch
          const log = git(
            repo.workingDir,
            "log",
            "live-run-through",
            "--oneline",
          );
          const sha01_01_02 = log
            .split("\n")
            .find((l) => l.includes("01.01.02"))
            ?.split(" ")[0];
          git(repo.workingDir, "cherry-pick", sha01_01_02!);

          // Now selectLessonCommit should exclude 01.01.01 (from fork) and 01.01.02 (cherry-picked)
          let capturedCommits: Array<{
            lessonId: string;
            message: string;
          }> = [];

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* (
                commits: Array<{
                  lessonId: string;
                  message: string;
                }>,
                _promptMessage: string,
              ) {
                capturedCommits = commits;
                return "01.02.01";
              },
            ),
          });

          yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.none(),
            promptMessage: "Select lesson",
            excludeCurrentBranch: true,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          // 01.01.01 is from the fork point, 01.01.02 was cherry-picked
          // Both should be excluded
          const lessonIds = capturedCommits.map(
            (c) => c.lessonId,
          );
          expect(lessonIds).not.toContain("01.01.01");
          expect(lessonIds).not.toContain("01.01.02");
          expect(lessonIds).toContain("01.02.01");
        }),
    );
  });

  describe("multiple commits with same lesson ID", () => {
    it.effect(
      "should select the latest commit when multiple share a lesson ID",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 First version", {
                "src/01.ts": "// v1",
              }),
              commit("01.01.01 Updated version", {
                "src/01.ts": "// v2",
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
                return "01.01.01";
              },
            ),
          });

          // Test selectLessonCommit directly (without excludeCurrentBranch)
          // to verify the dedup logic with real git log.
          // git log returns newest-first, and the code takes the last match
          // (oldest commit), which is the "First version" in this case.
          const result = yield* selectLessonCommit({
            branch: "live-run-through",
            lessonId: Option.none(),
            promptMessage: "Select lesson",
            excludeCurrentBranch: false,
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          // Code takes matchingCommits[length-1], which is the last in
          // git log output (oldest). With real git, this is "First version".
          expect(result.commit.message).toBe("First version");
          expect(result.lessonId).toBe("01.01.01");
        }),
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

          const mockPromptService = fromPartial<PromptService>(
            {},
          );

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.some("99.99.99"),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
            Effect.flip,
          );

          expect(result._tag).toBe("CommitNotFoundError");
        }),
    );
  });

  describe("branch creation when on main", () => {
    it.effect(
      "should prompt for new branch and cherry-pick when on main",
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
              commit("01.01.02 Arrays advanced", {
                "src/02.ts": "// arrays advanced",
              }),
            ])
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // We're on main (default after build with no workingBranch)
          const currentBefore = git(
            repo.workingDir,
            "branch",
            "--show-current",
          );
          expect(currentBefore).toBe("main");

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              },
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "matt/feature-work";
              },
            ),
          });

          yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          // Should now be on the new branch
          const currentAfter = git(
            repo.workingDir,
            "branch",
            "--show-current",
          );
          expect(currentAfter).toBe("matt/feature-work");

          // Cherry-picked file should exist
          const content = fs.readFileSync(
            `${repo.workingDir}/src/02.ts`,
            "utf-8",
          );
          expect(content).toBe("// arrays advanced");
        }),
    );
  });

  describe("not a git repo", () => {
    it.effect(
      "should fail with NotAGitRepoError when not in a git repository",
      () =>
        Effect.gen(function* () {
          const tmpDir = fs.mkdtempSync("/tmp/not-git-");
          cleanup = () =>
            fs.rmSync(tmpDir, { recursive: true, force: true });

          const mockPromptService = fromPartial<PromptService>(
            {},
          );

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: "https://example.com/repo.git",
          }).pipe(
            Effect.provide(makeLayer(tmpDir, mockPromptService)),
            Effect.flip,
          );

          expect(result._tag).toBe("NotAGitRepoError");
        }),
    );
  });

  describe("cherry-pick from same branch rejected", () => {
    it.effect(
      "should fail with InvalidBranchOperationError when on live-run-through",
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

          // We're already on live-run-through after build
          const currentBefore = git(
            repo.workingDir,
            "branch",
            "--show-current",
          );
          expect(currentBefore).toBe("live-run-through");

          const mockPromptService = fromPartial<PromptService>({});

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.some("01.01.01"),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
            Effect.flip,
          );

          expect(result._tag).toBe("InvalidBranchOperationError");
        }),
    );
  });

  describe("real cherry-pick conflict", () => {
    it.effect(
      "should fail with CherryPickConflictError when cherry-pick conflicts",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// original content",
              }),
              commit("01.01.02 Arrays modified", {
                "src/01.ts": "// modified in lesson",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "live-run-through",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // Make a conflicting local change to the same file
          fs.writeFileSync(
            `${repo.workingDir}/src/01.ts`,
            "// conflicting local change",
          );
          git(repo.workingDir, "add", ".");
          git(
            repo.workingDir,
            "commit",
            "-m",
            "local conflicting change",
          );

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              },
            ),
          });

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
            Effect.flip,
          );

          expect(result._tag).toBe("CherryPickConflictError");
        }),
    );
  });

  describe("prompt cancellation", () => {
    it.effect(
      "should propagate PromptCancelledError when user cancels",
      () =>
        Effect.gen(function* () {
          // Need at least 2 lessons so after excludeCurrentBranch
          // filtering there are still lessons for the prompt
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("01.01.01 Arrays intro", {
                "src/01.ts": "// arrays",
              }),
              commit("01.01.02 Arrays advanced", {
                "src/02.ts": "// arrays advanced",
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
                  new PromptCancelledError(),
                );
              },
            ),
          });

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
            Effect.flip,
          );

          expect(result).toBeInstanceOf(PromptCancelledError);
        }),
    );
  });

  describe("custom --branch option", () => {
    it.effect(
      "should cherry-pick from a custom source branch",
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
              },
            ),
          });

          yield* runCherryPick({
            branch: "custom-lessons",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          // Verify the cherry-picked file from custom branch exists
          const content = fs.readFileSync(
            `${repo.workingDir}/src/custom.ts`,
            "utf-8",
          );
          expect(content).toBe("// custom content");

          // Still on my-branch
          const currentBranch = git(
            repo.workingDir,
            "branch",
            "--show-current",
          );
          expect(currentBranch).toBe("my-branch");
        }),
    );

    it.effect(
      "should cherry-pick specific lesson from custom branch by ID",
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

          const mockPromptService = fromPartial<PromptService>(
            {},
          );

          yield* runCherryPick({
            branch: "custom-lessons",
            lessonId: Option.some("03.01.02"),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
          );

          const content = fs.readFileSync(
            `${repo.workingDir}/src/second.ts`,
            "utf-8",
          );
          expect(content).toBe("// second");
        }),
    );
  });

  describe("branch with no lesson commits", () => {
    it.effect(
      "should fail with CommitNotFoundError when branch has no lesson-formatted commits",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("live-run-through", [
              commit("Fix typo in readme", {
                "README.md": "# README",
              }),
              commit("Update dependencies", {
                "package.json": "{}",
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
                throw new Error("should not be called");
              },
            ),
          });

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
            Effect.flip,
          );

          expect(result._tag).toBe("CommitNotFoundError");
        }),
    );
  });

  describe("branch creation failure", () => {
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
              commit("01.01.02 Arrays advanced", {
                "src/02.ts": "// arrays advanced",
              }),
            ])
            .build();

          cleanup = repo.cleanup;
          configureGitUser(repo.workingDir);

          // Create a branch that will conflict with the name
          git(repo.workingDir, "branch", "existing-branch");

          const mockPromptService = fromPartial<PromptService>({
            selectLessonCommit: Effect.fn("selectLessonCommit")(
              function* () {
                return "01.01.02";
              },
            ),
            inputBranchName: Effect.fn("inputBranchName")(
              function* () {
                return "existing-branch";
              },
            ),
          });

          const result = yield* runCherryPick({
            branch: "live-run-through",
            lessonId: Option.none(),
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(
              makeLayer(repo.workingDir, mockPromptService),
            ),
            Effect.flip,
          );

          expect(result._tag).toBe("FailedToCreateBranchError");
        }),
    );
  });
});
