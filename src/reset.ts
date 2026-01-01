import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Data, Effect } from "effect";
import prompt from "prompts";
import {
  getParentCommit,
  selectLessonCommit,
} from "./commit-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";
import { runPrompt } from "./prompt-utils.js";

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

export const reset = CLICommand.make(
  "reset",
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
    problem: Options.boolean("problem").pipe(
      Options.withAlias("p"),
      Options.withDescription(
        "Reset to problem state (start the exercise)"
      )
    ),
    solution: Options.boolean("solution").pipe(
      Options.withAlias("s"),
      Options.withDescription(
        "Reset to solution state (final code)"
      )
    ),
    demo: Options.boolean("demo").pipe(Options.withAlias("d")),
    cwd: cwdOption,
  },
  ({
    branch,
    cwd,
    demo,
    lessonId,
    problem,
    solution,
  }) =>
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
          "Which lesson do you want to reset to? (type to search)",
        excludeCurrentBranch: false,
      });

      // Determine which commit to use based on problem/solution state
      let commitToUse = targetCommit.sha;
      let stateDescription = "final code";

      // Check for conflicting flags
      if (problem && solution) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message:
              "Cannot use both --problem and --solution flags",
          })
        );
      }

      if (demo && (problem || solution)) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message:
              "Cannot use --demo with --problem or --solution flags",
          })
        );
      }

      // If neither flag is provided, prompt user (unless demo mode)
      if (!problem && !solution && !demo) {
        const { state } = yield* runPrompt<{
          state: "problem" | "solution";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "state",
              message: "Start the exercise or view final code?",
              choices: [
                {
                  title: "Start the exercise",
                  value: "problem",
                  description:
                    "Reset to problem state (commit before solution)",
                },
                {
                  title: "Final code",
                  value: "solution",
                  description:
                    "Reset to solution state (completed exercise)",
                },
              ],
            },
          ])
        );

        if (state === "problem") {
          commitToUse = yield* getParentCommit({
            commitSha: targetCommit.sha,
            cwd: config.cwd,
          });
          stateDescription = "problem state";
        }
      } else if (problem) {
        commitToUse = yield* getParentCommit({
          commitSha: targetCommit.sha,
          cwd: config.cwd,
        });
        stateDescription = "problem state";
      }
      // If solution flag is set, commitToUse stays as targetCommit.sha

      const currentBranch = yield* git.getCurrentBranch();

      // Prompt for action (skip in demo mode)
      let action: "reset-current" | "create-branch";
      if (currentBranch === "main") {
        yield* Console.log(
          "You cannot reset the main branch. Creating a new branch..."
        );
        action = "create-branch";
      } else if (demo) {
        action = "reset-current";
      } else {
        const result = yield* runPrompt<{
          action: "reset-current" | "create-branch";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "action",
              message: "How would you like to proceed?",
              choices: [
                {
                  title: `Reset current branch (${currentBranch})`,
                  value: "reset-current",
                },
                {
                  title: "Create new branch from commit",
                  value: "create-branch",
                },
              ],
            },
          ])
        );
        action = result.action;
      }

      if (action === "reset-current") {
        // Check if current branch is the target branch
        if (currentBranch === branch) {
          return yield* new InvalidBranchOperationError({
            message: `Cannot reset current branch when on target branch "${branch}"`,
          });
        }
      }

      if (action === "create-branch") {
        const { branchName } = yield* runPrompt<{
          branchName: string;
        }>(() =>
          prompt([
            {
              type: "text",
              name: "branchName",
              message: "Enter new branch name:",
            },
          ])
        );

        yield* Console.log(
          `Creating branch ${branchName} from ${commitToUse} (${stateDescription})...`
        );

        yield* git.checkoutNewBranchAt(branchName, commitToUse);

        yield* Console.log(
          `✓ Created and checked out branch: ${branchName}`
        );
        return;
      }

      // Reset current branch - check for unstaged changes (skip in demo mode)
      if (!demo) {
        const { hasUncommittedChanges, statusOutput } =
          yield* git.getUncommittedChanges();

        if (hasUncommittedChanges) {
          yield* Console.log(
            "\nWarning: You have uncommitted changes:"
          );
          yield* Console.log(statusOutput);

          const { confirm } = yield* runPrompt<{
            confirm: boolean;
          }>(() =>
            prompt([
              {
                type: "confirm",
                name: "confirm",
                message:
                  "This will lose all uncommitted work. Continue?",
                initial: false,
              },
            ])
          );

          if (!confirm) {
            yield* Console.log("Reset cancelled");
            return;
          }
        }
      }

      // Reset to target commit
      yield* Console.log(
        `Resetting to ${commitToUse} (${stateDescription})...`
      );

      yield* git.resetHard(commitToUse);

      // Demo mode: undo commit and unstage changes
      if (demo) {
        yield* Console.log(
          "Undoing commit and unstaging changes..."
        );

        yield* git.resetHead();
        yield* git.restoreStaged();

        yield* Console.log(
          `✓ Demo mode: Reset to lesson ${selectedLessonId} with unstaged changes`
        );
      } else {
        yield* Console.log(
          `✓ Reset to lesson ${selectedLessonId} (${stateDescription})`
        );
      }
    }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd,
        })
      ),
      Effect.catchTags({
        NoParentCommitError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: Commit ${error.commitSha} has no parent commit. Repository may be in an invalid state.`
            );
            process.exitCode = 1;
          });
        },
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
        PromptCancelledError: () => {
          process.exitCode = 0;
          return Effect.succeed(void 0);
        },
        InvalidBranchOperationError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        FailedToCreateBranchError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        FailedToResetError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
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
  CLICommand.withDescription("Reset to a specific lesson commit")
);
