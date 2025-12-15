import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Context, Data, Effect, Layer } from "effect";
import * as path from "node:path";

const VALID_UPSTREAM_PATTERNS = [
  "mattpocock",
  "ai-hero-dev",
  "total-typescript",
];

export class GitServiceConfig extends Context.Tag(
  "GitServiceConfig"
)<GitServiceConfig, { readonly cwd: string }>() {}

export const defaultGitServiceConfigLayer = Layer.succeed(
  GitServiceConfig,
  GitServiceConfig.of({
    cwd: process.cwd(),
  })
);

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
  message: string;
}> {}

export class FailedToFetchUpstreamError extends Data.TaggedError(
  "FailedToFetchUpstreamError"
)<{
  targetBranch: string;
  message: string;
}> {}

export class FailedToCreateBranchError extends Data.TaggedError(
  "FailedToCreateBranchError"
)<{
  branchName: string;
  message: string;
}> {}

export class NoUpstreamFoundError extends Data.TaggedError(
  "NoUpstreamFoundError"
)<{
  message: string;
}> {}

export class FailedToDeleteBranchError extends Data.TaggedError(
  "FailedToDeleteBranchError"
)<{
  branchName: string;
  message: string;
}> {}

export class FailedToTrackBranchError extends Data.TaggedError(
  "FailedToTrackBranchError"
)<{
  branchName: string;
  message: string;
}> {}

export class GitService extends Effect.Service<GitService>()(
  "GitService",
  {
    effect: Effect.gen(function* () {
      const config = yield* GitServiceConfig;
      const fs = yield* FileSystem.FileSystem;

      const runCommandWithString = Effect.fn(
        "runCommandWithString"
      )(function* (...commandArgs: [string, ...Array<string>]) {
        const cwd = config.cwd;
        const command = Command.make(...commandArgs).pipe(
          Command.workingDirectory(cwd)
        );
        return (yield* Command.string(command)).trim();
      });

      const runCommandWithExitCode = Effect.fn(
        "runCommandWithExitCode"
      )(function* (...commandArgs: [string, ...Array<string>]) {
        const cwd = config.cwd;
        const command = Command.make(...commandArgs).pipe(
          Command.workingDirectory(cwd),
          Command.stdout("inherit"),
          Command.stderr("inherit")
        );
        return yield* Command.exitCode(command);
      });

      const detectUpstreamRemote = Effect.fn(
        "detectUpstreamRemote"
      )(function* () {
        const remotes = yield* runCommandWithString(
          "git",
          "remote",
          "-v"
        );

        for (const line of remotes.split("\n")) {
          const match = line.match(/^(\S+)\s+(\S+)/);
          if (match) {
            const remoteName = match[1].trim();
            const url = match[2].trim();
            if (
              VALID_UPSTREAM_PATTERNS.some((pattern) =>
                url.includes(pattern)
              )
            ) {
              return { remoteName, url };
            }
          }
        }

        return yield* Effect.fail(
          new NoUpstreamFoundError({
            message: `No valid upstream remote found.
Looking for repos from usernames: ${VALID_UPSTREAM_PATTERNS.join(
              ", "
            )}

Add upstream remote:
  git remote add upstream https://github.com/<username>/<repo>.git`,
          })
        );
      });

      return {
        ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
          function* () {
            const cwd = config.cwd;
            const gitDirPath = path.join(cwd, ".git");
            const exists = yield* fs.exists(gitDirPath);
            if (!exists) {
              return yield* new NotAGitRepoError({
                path: cwd,
                message: `Current directory is not a git repository: ${cwd}`,
              });
            }
          }
        ),
        getUncommittedChanges: Effect.fn(
          "getUncommittedChanges"
        )(function* () {
          const statusOutput = yield* runCommandWithString(
            "git",
            "status",
            "--porcelain"
          );
          return {
            hasUncommittedChanges: statusOutput !== "",
            statusOutput,
          };
        }),
        /**
         * This command needs to be run in every user-facing command that
         * interacts with a branch. It ensures that the branch is connected
         * to the upstream repository and that the local branch is tracking
         * the upstream branch.
         *
         * This is to handle the case where the user has a fork of the
         * upstream repository.
         */
        ensureUpstreamBranchConnected: Effect.fn(
          "ensureUpstreamBranchConnected"
        )(function* (opts: { targetBranch: string }) {
          const { targetBranch } = opts;

          const { remoteName } = yield* detectUpstreamRemote();

          const fetchExitCode = yield* runCommandWithExitCode(
            "git",
            "fetch",
            remoteName,
            targetBranch
          );

          if (fetchExitCode !== 0) {
            return yield* Effect.fail(
              new FailedToFetchUpstreamError({
                targetBranch,
                message: `Failed to fetch upstream: ${fetchExitCode}`,
              })
            );
          }

          // Delete the target branch locally (to account for changes on the upstream)
          yield* runCommandWithExitCode(
            "git",
            "branch",
            "-D",
            targetBranch
          );
          // Track the target branch
          const trackBranchExitCode =
            yield* runCommandWithExitCode(
              "git",
              "branch",
              "--track",
              targetBranch,
              `${remoteName}/${targetBranch}`
            );

          if (trackBranchExitCode !== 0) {
            return yield* Effect.fail(
              new FailedToTrackBranchError({
                branchName: targetBranch,
                message: `Failed to track branch.`,
              })
            );
          }
        }),
        getCurrentBranch: Effect.fn("getCurrentBranch")(
          function* () {
            const currentBranch = (yield* runCommandWithString(
              "git",
              "branch",
              "--show-current"
            )).trim();

            return currentBranch;
          }
        ),
        runCommandWithExitCode,
        runCommandWithString,
      };
    }),
    dependencies: [
      NodeContext.layer,
      defaultGitServiceConfigLayer,
    ],
  }
) {}
