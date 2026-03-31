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
import {
  PromptCancelledError,
  PromptService,
} from "../src/prompt-service.js";
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
 * Integration tests for pull command on main branch.
 * Uses real GitService with mocked PromptService.
 */
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
    "should prompt for branch name, create branch, and merge upstream/main",
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

        const mockPromptService = fromPartial<PromptService>({
          inputBranchName: Effect.fn("inputBranchName")(
            function* (_context: "working" | "new") {
              return "my-dev-branch";
            }
          ),
        });

        yield* runPull({
          upstream: getBareRepoPath(repo.workingDir),
        }).pipe(
          Effect.provide(
            makeLayer(repo.workingDir, mockPromptService)
          )
        );

        // Should be on the new branch
        const currentBranch = git(
          repo.workingDir,
          "branch",
          "--show-current"
        );
        expect(currentBranch).toBe("my-dev-branch");

        // Should have the upstream changes merged in
        const content = fs.readFileSync(
          `${repo.workingDir}/src/01.ts`,
          "utf-8"
        );
        expect(content).toBe("// updated");
      })
  );

  it.effect(
    "should stop when user cancels the branch name prompt",
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

        const mockPromptService = fromPartial<PromptService>({
          inputBranchName: Effect.fn("inputBranchName")(
            function* () {
              return yield* new PromptCancelledError();
            }
          ),
        });

        const result = yield* runPull({
          upstream: getBareRepoPath(repo.workingDir),
        }).pipe(
          Effect.provide(
            makeLayer(repo.workingDir, mockPromptService)
          ),
          Effect.flip
        );

        expect(result._tag).toBe("PromptCancelledError");

        // Should still be on main
        const currentBranch = git(
          repo.workingDir,
          "branch",
          "--show-current"
        );
        expect(currentBranch).toBe("main");
      })
  );
});
