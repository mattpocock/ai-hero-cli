import { Command, FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import * as path from "node:path";
import {
  CherryPickConflictError,
  FailedToCheckoutError,
  FailedToCommitError,
  FailedToCreateBranchError,
  FailedToDeleteBranchError,
  FailedToFetchError,
  FailedToFetchOriginError,
  FailedToFetchUpstreamError,
  FailedToPushError,
  FailedToResetError,
  FailedToTrackBranchError,
  InvalidRefError,
  MergeConflictError,
  NotAGitRepoError,
  RebaseConflictError,
} from "./errors.js";

export class GitServiceConfig extends Context.Tag(
  "GitServiceConfig"
)<GitServiceConfig, { readonly cwd: string }>() {}

export const defaultGitServiceConfigLayer = Layer.succeed(
  GitServiceConfig,
  GitServiceConfig.of({
    cwd: process.cwd(),
  })
);

const mapExitCode = <E>(
  exitCode: number,
  makeError: (exitCode: number) => E
) => {
  if (exitCode !== 0) {
    return Effect.fail(makeError(exitCode));
  }
  return Effect.void;
};

export const makeGitService = Effect.gen(function* () {
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

      const runCommandSilentExitCode = Effect.fn(
        "runCommandSilentExitCode"
      )(function* (...commandArgs: [string, ...Array<string>]) {
        const cwd = config.cwd;
        const command = Command.make(...commandArgs).pipe(
          Command.workingDirectory(cwd)
        );
        return yield* Command.exitCode(command);
      });

      const resetHard = Effect.fn("resetHard")(function* (
        sha: string
      ) {
        const exitCode = yield* runCommandWithExitCode(
          "git",
          "reset",
          "--hard",
          sha
        );

        yield* mapExitCode(
          exitCode,
          (code) =>
            new FailedToResetError({
              sha,
              message: `Failed to reset to ${sha} (exit code: ${code})`,
            })
        );
      });

      const resetHead = Effect.fn("resetHead")(function* () {
        yield* runCommandWithExitCode("git", "reset", "HEAD^");
      });

      const restoreStaged = Effect.fn(
        "restoreStaged"
      )(function* () {
        yield* runCommandWithExitCode(
          "git",
          "restore",
          "--staged",
          "."
        );
      });

      return {
        fetchOrigin: Effect.fn("fetchOrigin")(function* () {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "fetch",
            "origin"
          );

          yield* mapExitCode(
            exitCode,
            (code) =>
              new FailedToFetchOriginError({
                message: `Failed to fetch from origin (exit code: ${code})`,
              })
          );
        }),

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

        getStatusShort: Effect.fn("getStatusShort")(
          function* () {
            return yield* runCommandWithString(
              "git",
              "status",
              "--short"
            );
          }
        ),

        resetHard,
        resetHead,
        restoreStaged,

        applyAsUnstagedChanges: Effect.fn(
          "applyAsUnstagedChanges"
        )(function* (sha: string) {
          yield* resetHard(sha);
          yield* resetHead();
          yield* restoreStaged();
        }),

        stageAll: Effect.fn("stageAll")(function* () {
          yield* runCommandWithExitCode("git", "add", ".");
        }),

        commit: Effect.fn("commit")(function* (message: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "commit",
            "-m",
            message
          );

          yield* mapExitCode(
            exitCode,
            (code) =>
              new FailedToCommitError({
                message: `Failed to commit (exit code: ${code})`,
              })
          );
        }),

        cherryPick: Effect.fn("cherryPick")(function* (
          range: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "cherry-pick",
            range
          );

          yield* mapExitCode(
            exitCode,
            () =>
              new CherryPickConflictError({
                range,
                message: `Cherry-pick conflict on range ${range}`,
              })
          );
        }),

        cherryPickContinue: Effect.fn("cherryPickContinue")(
          function* () {
            const exitCode = yield* runCommandWithExitCode(
              "git",
              "cherry-pick",
              "--continue"
            );

            yield* mapExitCode(
              exitCode,
              () =>
                new CherryPickConflictError({
                  range: "continue",
                  message:
                    "Cherry-pick continue encountered conflicts",
                })
            );
          }
        ),

        cherryPickAbort: Effect.fn("cherryPickAbort")(
          function* () {
            yield* runCommandWithExitCode(
              "git",
              "cherry-pick",
              "--abort"
            );
          }
        ),

        checkout: Effect.fn("checkout")(function* (
          branch: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "checkout",
            branch
          );

          yield* mapExitCode(
            exitCode,
            (code) =>
              new FailedToCheckoutError({
                branch,
                message: `Failed to checkout ${branch} (exit code: ${code})`,
              })
          );
        }),

        pushForceWithLease: Effect.fn("pushForceWithLease")(
          function* (remote: string, branch: string) {
            const exitCode = yield* runCommandWithExitCode(
              "git",
              "push",
              remote,
              branch,
              "--force-with-lease"
            );

            yield* mapExitCode(
              exitCode,
              (code) =>
                new FailedToPushError({
                  remote,
                  branch,
                  message: `Failed to push ${branch} to ${remote} (exit code: ${code})`,
                })
            );
          }
        ),

        checkoutNewBranch: Effect.fn("checkoutNewBranch")(
          function* (branchName: string) {
            const exitCode = yield* runCommandWithExitCode(
              "git",
              "checkout",
              "-b",
              branchName
            );

            yield* mapExitCode(
              exitCode,
              (code) =>
                new FailedToCreateBranchError({
                  branchName,
                  message: `Failed to create branch ${branchName} (exit code: ${code})`,
                })
            );
          }
        ),

        getLogOnelineReverse: Effect.fn("getLogOnelineReverse")(
          function* (range: string) {
            return yield* runCommandWithString(
              "git",
              "log",
              "--oneline",
              "--reverse",
              range
            );
          }
        ),

        getLogOneline: Effect.fn("getLogOneline")(function* (
          branch: string
        ) {
          return yield* runCommandWithString(
            "git",
            "log",
            branch,
            "--oneline"
          );
        }),

        checkoutNewBranchAt: Effect.fn("checkoutNewBranchAt")(
          function* (branchName: string, sha: string) {
            const exitCode = yield* runCommandWithExitCode(
              "git",
              "checkout",
              "-b",
              branchName,
              sha
            );

            yield* mapExitCode(
              exitCode,
              (code) =>
                new FailedToCreateBranchError({
                  branchName,
                  message: `Failed to create branch ${branchName} at ${sha} (exit code: ${code})`,
                })
            );
          }
        ),

        deleteBranch: Effect.fn("deleteBranch")(function* (
          branchName: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "branch",
            "-D",
            branchName
          );

          yield* mapExitCode(
            exitCode,
            (code) =>
              new FailedToDeleteBranchError({
                branchName,
                message: `Failed to delete branch ${branchName} (exit code: ${code})`,
              })
          );
        }),

        fetch: Effect.fn("fetch")(function* (
          remote: string,
          branch: string
        ) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "fetch",
            remote,
            branch
          );

          yield* mapExitCode(
            exitCode,
            (code) =>
              new FailedToFetchError({
                remote,
                branch,
                message: `Failed to fetch ${branch} from ${remote} (exit code: ${code})`,
              })
          );
        }),

        merge: Effect.fn("merge")(function* (ref: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "merge",
            ref,
            "--allow-unrelated-histories"
          );

          yield* mapExitCode(
            exitCode,
            () =>
              new MergeConflictError({
                ref,
                message: `Merge conflicts detected when merging ${ref}`,
              })
          );
        }),

        rebase: Effect.fn("rebase")(function* (onto: string) {
          const exitCode = yield* runCommandWithExitCode(
            "git",
            "rebase",
            onto
          );

          yield* mapExitCode(
            exitCode,
            () =>
              new RebaseConflictError({
                onto,
                message: `Rebase conflicts detected when rebasing onto ${onto}`,
              })
          );
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
        ensureUpstreamBranchConnected: Effect.fn(
          "ensureUpstreamBranchConnected"
        )(function* (opts: { targetBranch: string }) {
          const { targetBranch } = opts;

          const fetchExitCode = yield* runCommandWithExitCode(
            "git",
            "fetch",
            "upstream",
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
              `upstream/${targetBranch}`
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
        setUpstreamRemote: Effect.fn("setUpstreamRemote")(
          function* (url: string) {
            // Try set-url first (works if remote already exists)
            const setUrlExitCode = yield* runCommandWithExitCode(
              "git",
              "remote",
              "set-url",
              "upstream",
              url
            );

            if (setUrlExitCode !== 0) {
              // Remote doesn't exist yet, add it
              yield* runCommandWithExitCode(
                "git",
                "remote",
                "add",
                "upstream",
                url
              );
            }
          }
        ),
        hasRemote: Effect.fn("hasRemote")(function* (
          name: string
        ) {
          const exitCode = yield* runCommandSilentExitCode(
            "git",
            "remote",
            "get-url",
            name
          );
          return exitCode === 0;
        }),
        removeRemote: Effect.fn("removeRemote")(function* (
          name: string
        ) {
          yield* runCommandSilentExitCode(
            "git",
            "remote",
            "remove",
            name
          );
        }),
        hasLocalBranch: Effect.fn("hasLocalBranch")(function* (
          name: string
        ) {
          const exitCode = yield* runCommandSilentExitCode(
            "git",
            "rev-parse",
            "--verify",
            `refs/heads/${name}`
          );
          return exitCode === 0;
        }),
      };
    });

export class GitService extends Effect.Service<GitService>()(
  "GitService",
  {
    effect: makeGitService,
    dependencies: [
      NodeFileSystem.layer,
      defaultGitServiceConfigLayer,
    ],
  }
) {}
