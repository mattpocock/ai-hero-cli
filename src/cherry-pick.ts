import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { selectLessonCommit } from "./commit-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";

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
    cwd: cwdOption,
  },
  ({ branch, cwd, lessonId }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const config = yield* GitServiceConfig;

      // Validate git repository
      yield* git.ensureIsGitRepo();

      yield* git.ensureUpstreamBranchConnected({
        targetBranch: branch,
      });

      const {
        commit: targetCommit,
        lessonId: selectedLessonId,
      } = yield* selectLessonCommit({
        cwd: config.cwd,
        branch,
        lessonId,
        promptMessage:
          "Which lesson do you want to cherry-pick? (type to search)",
        excludeCurrentBranch: true,
      });

      // Get current branch name and validate
      const currentBranch = yield* git.getCurrentBranch();

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
      const cherryPickExitCode =
        yield* git.runCommandWithExitCode(
          "git",
          "cherry-pick",
          targetCommit.sha
        );

      if (cherryPickExitCode !== 0) {
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `\n✓ Successfully cherry-picked lesson ${selectedLessonId}`
      );
    }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd,
        })
      ),
      Effect.catchTags({
        NotAGitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        NoUpstreamFoundError: (error) => {
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
