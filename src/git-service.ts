import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Data, Effect } from "effect";
import * as path from "node:path";

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

export class GitService extends Effect.Service<GitService>()(
  "GitService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const runCommandWithString = Effect.fn(
        "runCommandWithString"
      )(function* (...commandArgs: [string, ...Array<string>]) {
        const cwd = yield* Config.string("cwd");
        const command = Command.make(...commandArgs).pipe(
          Command.workingDirectory(cwd)
        );
        return (yield* Command.string(command)).trim();
      });

      const runCommandWithExitCode = Effect.fn(
        "runCommandWithExitCode"
      )(function* (...commandArgs: [string, ...Array<string>]) {
        const cwd = yield* Config.string("cwd");
        const command = Command.make(...commandArgs).pipe(
          Command.workingDirectory(cwd)
        );
        return yield* Command.exitCode(command);
      });

      return {
        ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
          function* () {
            const cwd = yield* Config.string("cwd");
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
        ensureBranchConnected: Effect.fn(
          "ensureBranchConnected"
        )(function* (targetBranch: string) {
          const cwd = yield* Config.string("cwd");
          const attachUpstreamCommand = Command.make(
            "git",
            "remote",
            "add",
            "upstream",
            "git@github.com:ai-hero-dev/cohort-002-project.git"
          ).pipe(Command.workingDirectory(cwd));

          // Ignore failures
          yield* Command.exitCode(attachUpstreamCommand);

          const fetchCommand = Command.make(
            "git",
            "fetch",
            "upstream",
            targetBranch
          ).pipe(
            Command.workingDirectory(cwd),
            Command.stdout("inherit"),
            Command.stderr("inherit")
          );

          const fetchExitCode = yield* Command.exitCode(
            fetchCommand
          );
          if (fetchExitCode !== 0) {
            return yield* Effect.fail(
              new FailedToFetchUpstreamError({
                targetBranch,
                message: `Failed to fetch upstream: ${fetchExitCode}`,
              })
            );
          }

          // Delete the target branch locally (to account for )
          yield* runCommandWithExitCode(
            "git",
            "branch",
            "-D",
            targetBranch
          );

          // Track the target branch
          yield* runCommandWithExitCode(
            "git",
            "branch",
            "--track",
            targetBranch,
            `upstream/${targetBranch}`
          );
        }),
        getCurrentBranch: Effect.fn("getCurrentBranch")(
          function* () {
            const cwd = yield* Config.string("cwd");
            const currentBranchCommand = Command.make(
              "git",
              "branch",
              "--show-current"
            ).pipe(Command.workingDirectory(cwd));
            return (yield* Command.string(
              currentBranchCommand
            )).trim();
          }
        ),
        runCommandWithExitCode,
        runCommandWithString,
      };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
