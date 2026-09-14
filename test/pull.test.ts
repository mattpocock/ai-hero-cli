import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import { PromptService } from "../src/prompt-service.js";
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
 * Integration tests for pull command.
 * Uses real GitService with mocked PromptService.
 */
describe("pull on live-run-through branch", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const getBareRepoPath = (workingDir: string) =>
    path.resolve(workingDir, "..", "bare.git");

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

  it.effect(
    "should fail with InvalidBranchOperationError when on live-run-through",
    () =>
      Effect.gen(function* () {
        const repo = createTestRepo()
          .withRemote("upstream")
          .withBranch("live-run-through", [
            commit("01.01 - Lesson", {
              "src/01.ts": "// original",
            }),
          ])
          .build();

        cleanup = repo.cleanup;

        // We're on live-run-through after build (first branch, no working branch)
        const currentBefore = git(
          repo.workingDir,
          "branch",
          "--show-current"
        );
        expect(currentBefore).toBe("live-run-through");

        const mockPromptService =
          fromPartial<PromptService>({});

        const result = yield* runPull({
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
});

describe("pull on main branch", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const getBareRepoPath = (workingDir: string) =>
    path.resolve(workingDir, "..", "bare.git");

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

  it.effect(
    "should merge upstream/main directly into main, in place, without redirecting to a new branch",
    () =>
      Effect.gen(function* () {
        const repo = createTestRepo()
          .withRemote("upstream")
          .withBranch("main", [
            commit("01.01 - Lesson", {
              "src/01.ts": "// original",
            }),
          ])
          .build();

        cleanup = repo.cleanup;

        // Push a new commit to upstream
        pushToUpstream(
          repo.workingDir,
          { "src/01.ts": "// updated" },
          "01.01 - Lesson (solution)"
        );

        const mockPromptService =
          fromPartial<PromptService>({});

        yield* runPull({
          upstream: getBareRepoPath(repo.workingDir),
        }).pipe(
          Effect.provide(
            makeLayer(repo.workingDir, mockPromptService)
          )
        );

        // Still on main - no redirect, no branch prompt
        const currentBranch = git(
          repo.workingDir,
          "branch",
          "--show-current"
        );
        expect(currentBranch).toBe("main");

        // Should have the upstream changes merged in
        const content = fs.readFileSync(
          `${repo.workingDir}/src/01.ts`,
          "utf-8"
        );
        expect(content).toBe("// updated");
      })
  );

  it.effect(
    "should reject unrelated histories when merging into main (no --allow-unrelated-histories)",
    () =>
      Effect.gen(function* () {
        const repo = createTestRepo()
          .withRemote("upstream")
          .withBranch("main", [
            commit("01.01 - Lesson", {
              "src/01.ts": "// original",
            }),
          ])
          .build();

        cleanup = repo.cleanup;

        // Simulate a misconfigured --upstream: local main's history has
        // no common ancestor with upstream's main at all. Previously this
        // never surfaced because pulling on main always redirected onto a
        // fresh branch derived from the same history; now that main is
        // merged into directly, and no longer shares that guaranteed
        // ancestry, this should fail loudly rather than silently
        // two-root-merging.
        git(
          repo.workingDir,
          "checkout",
          "--orphan",
          "unrelated-main"
        );
        git(
          repo.workingDir,
          "commit",
          "--allow-empty",
          "-m",
          "unrelated root"
        );
        git(repo.workingDir, "branch", "-D", "main");
        git(repo.workingDir, "branch", "-m", "main");

        const mockPromptService =
          fromPartial<PromptService>({});

        const result = yield* runPull({
          upstream: getBareRepoPath(repo.workingDir),
        }).pipe(
          Effect.provide(
            makeLayer(repo.workingDir, mockPromptService)
          ),
          Effect.flip
        );

        expect(result._tag).toBe("MergeConflictError");
      })
  );
});
