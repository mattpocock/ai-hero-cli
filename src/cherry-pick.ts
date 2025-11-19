import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { selectLessonCommit } from "./commit-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
  message: string;
}> {}

export class InvalidBranchOperationError extends Data.TaggedError(
  "InvalidBranchOperationError"
)<{
  message: string;
}> {}

export const cherryPick = CLICommand.make(
  "cherry-pick",
  {
    lessonId: Args.text({ name: "lesson-id" }).pipe(
      Args.optional
    ),
    branch: Options.text("branch").pipe(
      Options.withDescription(
        "Branch to search for the lesson commit"
      ),
      Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
    ),
  },
  ({ branch, lessonId }) =>
    Effect.gen(function* () {
      const cwd = process.cwd();

      // Validate git repository
      const gitDirPath = path.join(cwd, ".git");
      if (!existsSync(gitDirPath)) {
        return yield* Effect.fail(
          new NotAGitRepoError({
            path: cwd,
            message: `Current directory is not a git repository: ${cwd}`,
          })
        );
      }

      const gitFetchCommand = Command.make(
        "git",
        "fetch",
        "origin"
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const fetchExitCode = yield* Command.exitCode(
        gitFetchCommand
      );

      if (fetchExitCode !== 0) {
        yield* Console.error("Failed to fetch branch");
        process.exitCode = 1;
        return;
      }

      const {
        commit: targetCommit,
        lessonId: selectedLessonId,
      } = yield* selectLessonCommit({
        cwd,
        branch,
        lessonId,
        promptMessage:
          "Which lesson do you want to cherry-pick? (type to search)",
        excludeCurrentBranch: true,
      });

      // Get current branch name and validate
      const currentBranchCommand = Command.make(
        "git",
        "branch",
        "--show-current"
      ).pipe(Command.workingDirectory(cwd));

      const currentBranch = (yield* Command.string(
        currentBranchCommand
      )).trim();

      // Check if current branch is the target branch
      if (currentBranch === branch) {
        return yield* new InvalidBranchOperationError({
          message: `Cannot cherry-pick when on target branch "${branch}"`,
        });
      }

      // Check if current branch is main
      if (currentBranch === "main") {
        return yield* new InvalidBranchOperationError({
          message: `Cannot cherry-pick when on "main" branch`,
        });
      }

      yield* Console.log(
        `Cherry-picking ${targetCommit.sha} onto current branch...\n`
      );

      // Execute git cherry-pick with inherited stdio
      const cherryPickCommand = Command.make(
        "git",
        "cherry-pick",
        targetCommit.sha
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit"),
        Command.stdin("inherit")
      );

      const exitCode = yield* Command.exitCode(
        cherryPickCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (exitCode !== 0) {
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `\n✓ Successfully cherry-picked lesson ${selectedLessonId}`
      );
    }).pipe(
      Effect.catchTags({
        NotAGitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        CommitNotFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: No commit found for lesson ${error.lessonId} on branch ${error.branch}`
            );
            process.exitCode = 1;
          });
        },
        InvalidBranchOperationError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        PromptCancelledError: () => {
          process.exitCode = 0;
          return Effect.succeed(void 0);
        },
      }),
      Effect.catchAll((error) => {
        return Effect.gen(function* () {
          yield* Console.error(`Unexpected error: ${error}`);
          process.exitCode = 1;
        });
      })
    )
).pipe(
  CLICommand.withDescription(
    "Cherry-pick a specific lesson commit onto current branch"
  )
);
