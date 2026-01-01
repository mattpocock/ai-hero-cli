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

/**
 * Error thrown when git fetch origin fails.
 * This can happen due to network issues, authentication problems,
 * or the remote not being configured.
 */
export class FailedToFetchOriginError extends Data.TaggedError(
  "FailedToFetchOriginError"
)<{
  message: string;
}> {}

/**
 * Error thrown when a git ref cannot be resolved.
 * This typically happens when the ref (branch, tag, or SHA) doesn't exist.
 */
export class InvalidRefError extends Data.TaggedError("InvalidRefError")<{
  ref: string;
  message: string;
}> {}

export class FailedToTrackBranchError extends Data.TaggedError(
  "FailedToTrackBranchError"
)<{
  branchName: string;
  message: string;
}> {}

/**
 * Error thrown when git reset --hard fails.
 * This can happen due to permission issues or filesystem problems.
 */
export class FailedToResetError extends Data.TaggedError(
  "FailedToResetError"
)<{
  sha: string;
  message: string;
}> {}

/**
 * Error thrown when git commit fails.
 * Common causes: nothing to commit, pre-commit hook failure, or git configuration issues.
 */
export class FailedToCommitError extends Data.TaggedError(
  "FailedToCommitError"
)<{
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
        /**
         * Fetches the latest changes from the origin remote.
         * This updates remote-tracking branches (e.g., origin/main) without
         * modifying local branches or the working directory.
         *
         * @returns Effect that succeeds when fetch completes
         * @throws FailedToFetchOriginError if fetch fails (network, auth, or remote issues)
         */
        fetchOrigin: Effect.fn("fetchOrigin")(function* () {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "fetch",
            "origin"
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToFetchOriginError({
                message: `Failed to fetch from origin (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Resolves a git ref (branch name, tag, or partial SHA) to its full SHA.
         * Uses `git rev-parse` which handles all ref types.
         *
         * @param ref - The ref to resolve (e.g., "main", "origin/main", "HEAD", or a SHA)
         * @returns The full SHA of the resolved ref
         * @throws InvalidRefError if the ref cannot be resolved
         */
        revParse: Effect.fn("revParse")(function* (ref: string) {
          const result = yield* runCommandWithString(
            "git",
            "rev-parse",
            ref
          ).pipe(
            Effect.catchAll(() =>
              Effect.fail(
                new InvalidRefError({
                  ref,
                  message: `Failed to resolve ref: ${ref}`,
                })
              )
            )
          );

          return result;
        }),

        /**
         * Counts the number of commits between two refs.
         * Uses `git rev-list --count from..to` which counts commits reachable
         * from `to` but not from `from`.
         *
         * @param from - Starting ref (exclusive)
         * @param to - Ending ref (inclusive)
         * @returns Number of commits in the range
         */
        revListCount: Effect.fn("revListCount")(function* (
          from: string,
          to: string
        ) {
          const countOutput = yield* runCommandWithString(
            "git",
            "rev-list",
            "--count",
            `${from}..${to}`
          );

          return parseInt(countOutput, 10);
        }),

        /**
         * Gets the short status output from git.
         * Uses `git status --short` which outputs one line per file with
         * a two-letter status code (e.g., "M " for modified, "??" for untracked).
         *
         * @returns The short status output as a string
         */
        getStatusShort: Effect.fn("getStatusShort")(function* () {
          return yield* runCommandWithString("git", "status", "--short");
        }),

        /**
         * Performs a hard reset to the specified SHA.
         * WARNING: This discards all uncommitted changes and moves HEAD to the target.
         * Any uncommitted work in the working directory and staging area will be lost.
         *
         * @param sha - The commit SHA to reset to
         * @returns Effect that succeeds when reset completes
         * @throws FailedToResetError if the reset fails
         */
        resetHard: Effect.fn("resetHard")(function* (sha: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "reset",
            "--hard",
            sha
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToResetError({
                sha,
                message: `Failed to reset to ${sha} (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Performs a soft reset of the last commit (git reset HEAD^).
         * This undoes the last commit but keeps all changes in the working directory.
         * The changes from the undone commit become unstaged modifications.
         *
         * @returns Effect that succeeds when reset completes
         */
        resetHead: Effect.fn("resetHead")(function* () {
          yield* runCommandWithExitCode("git", "reset", "HEAD^");
        }),

        /**
         * Unstages all staged files (git restore --staged .).
         * This moves files from the staging area back to unstaged state
         * without discarding any modifications.
         *
         * @returns Effect that succeeds when restore completes
         */
        restoreStaged: Effect.fn("restoreStaged")(function* () {
          yield* runCommandWithExitCode("git", "restore", "--staged", ".");
        }),

        /**
         * Stages all changes in the working directory (git add .).
         * This adds all modified, deleted, and new files to the staging area.
         *
         * @returns Effect that succeeds when staging completes
         */
        stageAll: Effect.fn("stageAll")(function* () {
          yield* runCommandWithExitCode("git", "add", ".");
        }),

        /**
         * Creates a new commit with the specified message.
         * All currently staged changes will be included in the commit.
         *
         * @param message - The commit message
         * @returns Effect that succeeds when commit completes
         * @throws FailedToCommitError if the commit fails (e.g., nothing staged, hook failure)
         */
        commit: Effect.fn("commit")(function* (message: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "commit",
            "-m",
            message
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToCommitError({
                message: `Failed to commit (exit code: ${exitCode})`,
              })
            );
          }
        }),

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
        detectUpstreamRemote,
      };
    }),
    dependencies: [
      NodeContext.layer,
      defaultGitServiceConfigLayer,
    ],
  }
) {}
