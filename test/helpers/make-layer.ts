import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../../src/git-service.js";

/** A real GitService pointed at a temp repo. */
export const makeLayer = (workingDir: string) => {
  const deps = Layer.mergeAll(
    NodeFileSystem.layer,
    Layer.succeed(GitServiceConfig, { cwd: workingDir })
  );

  return Layer.mergeAll(
    Layer.effect(GitService, makeGitService).pipe(
      Layer.provide(deps)
    ),
    NodeFileSystem.layer,
    Layer.succeed(GitServiceConfig, { cwd: workingDir }),
    NodeContext.layer
  );
};

export const git = (cwd: string, ...args: Array<string>) =>
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

export const bareDirOf = (workingDir: string) =>
  path.resolve(workingDir, "..", "bare.git");

/** The lesson stack's subjects, in teaching order. */
export const stackOf = (
  workingDir: string,
  branch = "live-run-through"
) =>
  git(
    workingDir,
    "log",
    "--format=%s",
    "--reverse",
    `main..${branch}`
  )
    .split("\n")
    .filter(Boolean);
