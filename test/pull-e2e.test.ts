import { NodeContext , NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import { runPull } from "../src/pull.js";
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

/**
 * E2E tests for the pull command using real local Git repositories.
 * Uses real GitService with injectable configs. No PromptService needed.
 */
describe("pull (e2e)", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const makeLayer = (workingDir: string) => {
    const deps = Layer.mergeAll(
      NodeFileSystem.layer,
      Layer.succeed(GitServiceConfig, { cwd: workingDir })
    );

    return Layer.mergeAll(
      Layer.effect(GitService, makeGitService).pipe(
        Layer.provide(deps)
      ),
      NodeContext.layer
    );
  };

  /** Get the bare repo path from a working directory */
  const getBareRepoPath = (workingDir: string) =>
    path.resolve(workingDir, "..", "bare.git");

  /** Push a new commit to the bare remote's main branch */
  const pushToUpstream = (
    workingDir: string,
    files: Record<string, string>,
    message: string
  ) => {
    const bareDir = getBareRepoPath(workingDir);
    const tempCloneDir = `${workingDir}/../temp-push`;
    fs.mkdirSync(tempCloneDir);
    git(tempCloneDir, "clone", bareDir, ".");
    git(tempCloneDir, "checkout", "main");
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = `${tempCloneDir}/${filePath}`;
      fs.mkdirSync(
        fullPath.substring(0, fullPath.lastIndexOf("/")),
        { recursive: true }
      );
      fs.writeFileSync(fullPath, content);
    }
    git(tempCloneDir, "add", ".");
    git(tempCloneDir, "commit", "-m", message);
    git(tempCloneDir, "push", "origin", "main");
  };

  describe("successful pull from upstream", () => {
    it.effect(
      "should fetch upstream main and merge into current branch",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Arrays (problem)", {
                "src/01.ts": "// problem",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          // Push a new commit to upstream's main
          pushToUpstream(
            repo.workingDir,
            { "src/01.ts": "// updated solution" },
            "01.01 - Arrays (solution)"
          );

          yield* runPull({
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(Effect.provide(makeLayer(repo.workingDir)));

          // File should have the updated content
          const content = fs.readFileSync(
            `${repo.workingDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// updated solution");

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

  describe("uncommitted changes", () => {
    it.effect(
      "should fail with UncommittedChangesError when working directory is dirty",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Lesson", {
                "src/01.ts": "// original",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          // Create uncommitted changes
          fs.writeFileSync(
            `${repo.workingDir}/src/01.ts`,
            "// modified"
          );

          const result = yield* runPull({
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(makeLayer(repo.workingDir)),
            Effect.flip
          );

          expect(result._tag).toBe("UncommittedChangesError");
        })
    );
  });

  describe("merge conflict", () => {
    it.effect(
      "should fail with MergeConflictError when upstream changes conflict with local",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Arrays (problem)", {
                "src/01.ts": "// original",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          // Make a local commit with conflicting content
          fs.writeFileSync(
            `${repo.workingDir}/src/01.ts`,
            "// local change"
          );
          git(repo.workingDir, "add", ".");
          git(
            repo.workingDir,
            "commit",
            "-m",
            "local conflicting change"
          );

          // Push a conflicting change to upstream's main
          pushToUpstream(
            repo.workingDir,
            { "src/01.ts": "// upstream change" },
            "upstream conflicting change"
          );

          const result = yield* runPull({
            upstream: getBareRepoPath(repo.workingDir),
          }).pipe(
            Effect.provide(makeLayer(repo.workingDir)),
            Effect.flip
          );

          expect(result._tag).toBe("MergeConflictError");
        })
    );
  });

  describe("upstream remote setup", () => {
    it.effect(
      "should create upstream remote temporarily and clean it up after pull",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Lesson", {
                "src/01.ts": "// content",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          const bareRepoPath = getBareRepoPath(repo.workingDir);

          // Remove the existing upstream remote so setUpstreamRemote has to create it
          git(repo.workingDir, "remote", "remove", "upstream");

          // Push a new commit to upstream so the pull has something to merge
          pushToUpstream(
            repo.workingDir,
            { "new-file.ts": "// new" },
            "new file"
          );

          yield* runPull({ upstream: bareRepoPath }).pipe(
            Effect.provide(makeLayer(repo.workingDir))
          );

          // Verify the new file was merged in
          expect(
            fs.existsSync(
              `${repo.workingDir}/new-file.ts`
            )
          ).toBe(true);

          // Verify the remote was cleaned up (it didn't exist before)
          const remotes = git(
            repo.workingDir,
            "remote",
            "-v"
          );
          expect(remotes).not.toContain("upstream");
        })
    );

    it.effect(
      "should update upstream remote URL if it already exists with a different URL",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Lesson", {
                "src/01.ts": "// content",
              }),
            ])
            .withWorkingBranch("my-branch", {
              from: "main",
              atCommit: 0,
            })
            .build();

          cleanup = repo.cleanup;

          const bareRepoPath = getBareRepoPath(repo.workingDir);

          // Set a wrong URL first
          git(
            repo.workingDir,
            "remote",
            "set-url",
            "upstream",
            "/tmp/wrong-url.git"
          );

          // Push a new commit so the pull has something to merge
          pushToUpstream(
            repo.workingDir,
            { "new-file.ts": "// new" },
            "new file"
          );

          yield* runPull({ upstream: bareRepoPath }).pipe(
            Effect.provide(makeLayer(repo.workingDir))
          );

          // Verify pull succeeded (file was merged)
          expect(
            fs.existsSync(
              `${repo.workingDir}/new-file.ts`
            )
          ).toBe(true);

          // Verify remote URL was updated
          const remotes = git(
            repo.workingDir,
            "remote",
            "-v"
          );
          expect(remotes).toContain(bareRepoPath);
        })
    );
  });

  describe("unrelated histories", () => {
    it.effect(
      "should succeed when local repo has unrelated history to upstream",
      () =>
        Effect.gen(function* () {
          // Create an upstream repo with some commits
          const upstreamRepo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Arrays (problem)", {
                "src/01.ts": "// problem",
              }),
              commit("01.01 - Arrays (solution)", {
                "src/01.ts": "// solution",
              }),
            ])
            .build();

          const bareRepoPath = getBareRepoPath(
            upstreamRepo.workingDir
          );

          // Create a completely separate repo (simulating: clone, rm -rf .git, git init)
          const localTmpDir = `${upstreamRepo.workingDir}/../local-unrelated`;
          fs.mkdirSync(localTmpDir);
          git(localTmpDir, "init");
          git(localTmpDir, "config", "user.name", "Test");
          git(
            localTmpDir,
            "config",
            "user.email",
            "test@test.com"
          );
          fs.writeFileSync(
            `${localTmpDir}/README.md`,
            "# My project"
          );
          git(localTmpDir, "add", ".");
          git(localTmpDir, "commit", "-m", "Initial commit");
          git(localTmpDir, "checkout", "-b", "my-branch");

          cleanup = () => {
            upstreamRepo.cleanup();
            fs.rmSync(localTmpDir, {
              recursive: true,
              force: true,
            });
          };

          yield* runPull({
            upstream: bareRepoPath,
          }).pipe(Effect.provide(makeLayer(localTmpDir)));

          // File from upstream should be present
          const content = fs.readFileSync(
            `${localTmpDir}/src/01.ts`,
            "utf-8"
          );
          expect(content).toBe("// solution");

          // Local file should still be present
          const readme = fs.readFileSync(
            `${localTmpDir}/README.md`,
            "utf-8"
          );
          expect(readme).toBe("# My project");

          // Still on my-branch
          const currentBranch = git(
            localTmpDir,
            "branch",
            "--show-current"
          );
          expect(currentBranch).toBe("my-branch");
        })
    );
  });
});
