import { NodeContext } from "@effect/platform-node";
import { NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import {
  GitService,
  GitServiceConfig,
  UpstreamPatternsConfig,
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
      Layer.succeed(GitServiceConfig, { cwd: workingDir }),
      Layer.succeed(UpstreamPatternsConfig, {
        patterns: ["bare.git"],
      })
    );

    return Layer.mergeAll(
      Layer.effect(GitService, makeGitService).pipe(
        Layer.provide(deps)
      ),
      NodeContext.layer
    );
  };

  /** Push a new commit to the bare remote's main branch */
  const pushToUpstream = (
    workingDir: string,
    files: Record<string, string>,
    message: string
  ) => {
    const bareDir = `${workingDir}/../bare.git`;
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

          yield* runPull().pipe(
            Effect.provide(makeLayer(repo.workingDir))
          );

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

          const result = yield* runPull().pipe(
            Effect.provide(makeLayer(repo.workingDir)),
            Effect.flip
          );

          expect(result._tag).toBe("UncommittedChangesError");
        })
    );
  });

  describe("on main branch", () => {
    it.effect(
      "should fail with InvalidBranchOperationError when current branch is main",
      () =>
        Effect.gen(function* () {
          const repo = createTestRepo()
            .withRemote("upstream")
            .withBranch("main", [
              commit("01.01 - Lesson", {
                "src/01.ts": "// content",
              }),
            ])
            .build();

          cleanup = repo.cleanup;

          const result = yield* runPull().pipe(
            Effect.provide(makeLayer(repo.workingDir)),
            Effect.flip
          );

          expect(result._tag).toBe("InvalidBranchOperationError");
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

          const result = yield* runPull().pipe(
            Effect.provide(makeLayer(repo.workingDir)),
            Effect.flip
          );

          expect(result._tag).toBe("MergeConflictError");
        })
    );
  });

  describe("upstream detection", () => {
    it.effect(
      "should detect upstream remote from real git remote -v output",
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

          // Add a second remote that doesn't match patterns
          git(
            repo.workingDir,
            "remote",
            "add",
            "origin",
            "/tmp/nonexistent-repo.git"
          );

          // Push a new commit to upstream so the pull has something to merge
          pushToUpstream(
            repo.workingDir,
            { "new-file.ts": "// new" },
            "new file"
          );

          yield* runPull().pipe(
            Effect.provide(makeLayer(repo.workingDir))
          );

          // Verify the new file was merged in
          expect(
            fs.existsSync(
              `${repo.workingDir}/new-file.ts`
            )
          ).toBe(true);
        })
    );

    it.effect(
      "should fail with NoUpstreamFoundError when no remote matches patterns",
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

          // Use patterns that don't match the bare.git path
          const deps = Layer.mergeAll(
            NodeFileSystem.layer,
            Layer.succeed(GitServiceConfig, {
              cwd: repo.workingDir,
            }),
            Layer.succeed(UpstreamPatternsConfig, {
              patterns: ["github.com/nonexistent"],
            })
          );

          const layer = Layer.mergeAll(
            Layer.effect(GitService, makeGitService).pipe(
              Layer.provide(deps)
            ),
            NodeContext.layer
          );

          const result = yield* runPull().pipe(
            Effect.provide(layer),
            Effect.flip
          );

          expect(result._tag).toBe("NoUpstreamFoundError");
        })
    );
  });
});
