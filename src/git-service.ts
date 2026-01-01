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

/**
 * Error thrown when cherry-pick encounters a conflict.
 * Conflicts occur when changes in the cherry-picked commit overlap with
 * changes in the current branch that cannot be automatically merged.
 */
export class CherryPickConflictError extends Data.TaggedError(
  "CherryPickConflictError"
)<{
  range: string;
  message: string;
}> {}

/**
 * Error thrown when git checkout fails.
 * Common causes: uncommitted changes that would be overwritten,
 * branch doesn't exist, or path conflicts.
 */
export class FailedToCheckoutError extends Data.TaggedError(
  "FailedToCheckoutError"
)<{
  branch: string;
  message: string;
}> {}

/**
 * Error thrown when git push fails.
 * Common causes: remote rejected push (force-with-lease safety),
 * network issues, or authentication problems.
 */
export class FailedToPushError extends Data.TaggedError("FailedToPushError")<{
  remote: string;
  branch: string;
  message: string;
}> {}

/**
 * Error thrown when git fetch fails.
 * Common causes: network issues, authentication problems,
 * or the remote/branch doesn't exist.
 */
export class FailedToFetchError extends Data.TaggedError("FailedToFetchError")<{
  remote: string;
  branch: string;
  message: string;
}> {}

/**
 * Error thrown when git merge encounters conflicts.
 * Conflicts occur when changes in the merged ref overlap with
 * changes in the current branch that cannot be automatically resolved.
 */
export class MergeConflictError extends Data.TaggedError("MergeConflictError")<{
  ref: string;
  message: string;
}> {}

/**
 * Error thrown when git rebase encounters conflicts.
 * Rebasing replays commits on top of a new base, and conflicts occur
 * when changes in the replayed commits overlap with the new base.
 * Unlike merge, rebase rewrites history - all rebased commits get new SHAs.
 */
export class RebaseConflictError extends Data.TaggedError("RebaseConflictError")<{
  onto: string;
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

        /**
         * Cherry-picks a range of commits onto the current branch.
         * The range is specified as "from..to" where commits after "from"
         * up to and including "to" are applied.
         *
         * @param range - The commit range to cherry-pick (e.g., "abc123..def456")
         * @returns Effect that succeeds when cherry-pick completes
         * @throws CherryPickConflictError if conflicts occur during cherry-pick
         */
        cherryPick: Effect.fn("cherryPick")(function* (range: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "cherry-pick",
            range
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new CherryPickConflictError({
                range,
                message: `Cherry-pick conflict on range ${range}`,
              })
            );
          }
        }),

        /**
         * Continues a cherry-pick after conflicts have been resolved.
         * Call this after manually resolving conflicts and staging the changes.
         *
         * @returns Effect that succeeds when cherry-pick continues, or fails if more conflicts
         * @throws CherryPickConflictError if additional conflicts occur
         */
        cherryPickContinue: Effect.fn("cherryPickContinue")(function* () {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "cherry-pick",
            "--continue"
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new CherryPickConflictError({
                range: "continue",
                message: "Cherry-pick continue encountered conflicts",
              })
            );
          }
        }),

        /**
         * Aborts an in-progress cherry-pick operation.
         * This restores the branch to its state before the cherry-pick started.
         *
         * @returns Effect that succeeds when abort completes
         */
        cherryPickAbort: Effect.fn("cherryPickAbort")(function* () {
          yield* runCommandWithExitCode("git", "cherry-pick", "--abort");
        }),

        /**
         * Switches to an existing branch.
         * The working directory must be clean or have changes that don't
         * conflict with the target branch.
         *
         * @param branch - The branch name to switch to
         * @returns Effect that succeeds when checkout completes
         * @throws FailedToCheckoutError if checkout fails (branch not found, conflicts)
         */
        checkout: Effect.fn("checkout")(function* (branch: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "checkout",
            branch
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToCheckoutError({
                branch,
                message: `Failed to checkout ${branch} (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Force pushes a branch to a remote using --force-with-lease.
         * This is safer than --force because it will fail if the remote has
         * commits that aren't in your local branch, preventing accidental
         * overwrites of others' work.
         *
         * @param remote - The remote name (e.g., "origin")
         * @param branch - The branch to push
         * @returns Effect that succeeds when push completes
         * @throws FailedToPushError if push fails (rejected, network, auth issues)
         */
        pushForceWithLease: Effect.fn("pushForceWithLease")(function* (
          remote: string,
          branch: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "push",
            remote,
            branch,
            "--force-with-lease"
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToPushError({
                remote,
                branch,
                message: `Failed to push ${branch} to ${remote} (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Creates and switches to a new branch (git checkout -b).
         * The branch is created at the current HEAD position.
         *
         * @param branchName - The name of the new branch to create
         * @returns Effect that succeeds when branch is created and checked out
         * @throws FailedToCreateBranchError if branch creation fails (e.g., branch already exists)
         */
        checkoutNewBranch: Effect.fn("checkoutNewBranch")(function* (
          branchName: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "checkout",
            "-b",
            branchName
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToCreateBranchError({
                branchName,
                message: `Failed to create branch ${branchName} (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Gets commit log in oneline format, reversed (oldest first).
         * Uses `git log --oneline --reverse` with a range specifier.
         * Each line contains: <short-sha> <commit-message>
         *
         * @param range - The commit range (e.g., "main..feature" or "HEAD~5..HEAD")
         * @returns The commit log output as a string
         */
        getLogOnelineReverse: Effect.fn("getLogOnelineReverse")(function* (
          range: string
        ) {
          return yield* runCommandWithString(
            "git",
            "log",
            "--oneline",
            "--reverse",
            range
          );
        }),

        /**
         * Creates and switches to a new branch at a specific commit (git checkout -b <name> <sha>).
         * Unlike checkoutNewBranch which creates at HEAD, this creates the branch
         * at an arbitrary commit position.
         *
         * @param branchName - The name of the new branch to create
         * @param sha - The commit SHA where the branch should be created
         * @returns Effect that succeeds when branch is created and checked out
         * @throws FailedToCreateBranchError if branch creation fails (e.g., branch already exists)
         */
        checkoutNewBranchAt: Effect.fn("checkoutNewBranchAt")(function* (
          branchName: string,
          sha: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "checkout",
            "-b",
            branchName,
            sha
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToCreateBranchError({
                branchName,
                message: `Failed to create branch ${branchName} at ${sha} (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Fetches a specific branch from a remote.
         * Updates the remote-tracking branch (e.g., origin/main) without
         * modifying local branches or the working directory.
         *
         * @param remote - The remote name (e.g., "origin", "upstream")
         * @param branch - The branch to fetch (e.g., "main")
         * @returns Effect that succeeds when fetch completes
         * @throws FailedToFetchError if fetch fails (network, auth, or remote/branch not found)
         */
        fetch: Effect.fn("fetch")(function* (remote: string, branch: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "fetch",
            remote,
            branch
          );

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new FailedToFetchError({
                remote,
                branch,
                message: `Failed to fetch ${branch} from ${remote} (exit code: ${exitCode})`,
              })
            );
          }
        }),

        /**
         * Merges a ref into the current branch.
         * This creates a merge commit if necessary, or performs a fast-forward
         * merge if the current branch is directly behind the target ref.
         *
         * @param ref - The ref to merge (e.g., "origin/main", a branch name, or SHA)
         * @returns Effect that succeeds when merge completes
         * @throws MergeConflictError if conflicts occur during merge
         */
        merge: Effect.fn("merge")(function* (ref: string) {
          const exitCode = yield* runCommandWithExitCode("git", "merge", ref);

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new MergeConflictError({
                ref,
                message: `Merge conflicts detected when merging ${ref}`,
              })
            );
          }
        }),

        /**
         * Rebases the current branch onto another branch.
         * This replays all commits from the current branch on top of the target branch.
         * WARNING: Rebase rewrites commit history - all rebased commits get new SHAs.
         * Never rebase commits that have been pushed to a shared remote unless you
         * coordinate with all collaborators.
         *
         * @param onto - The branch to rebase onto (e.g., "main", "origin/main")
         * @returns Effect that succeeds when rebase completes
         * @throws RebaseConflictError if conflicts occur during rebase
         */
        rebase: Effect.fn("rebase")(function* (onto: string) {
          const exitCode = yield* runCommandWithExitCode("git", "rebase", onto);

          if (exitCode !== 0) {
            return yield* Effect.fail(
              new RebaseConflictError({
                onto,
                message: `Rebase conflicts detected when rebasing onto ${onto}`,
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
