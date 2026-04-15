import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { selectLessonCommit } from "./commit-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";
import {
  ensureNotOnProtectedBranch,
  InvalidBranchOperationError,
} from "./errors.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";
import { PromptService } from "./prompt-service.js";

/**
 * Core reset logic, extracted for testability.
 * Takes options as Effect Option types.
 */
export const runReset = ({
  branch,
  demo,
  lessonId,
  upstream,
}: {
  branch: string;
  lessonId: Option.Option<string>;
  demo: boolean;
  upstream: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const promptService = yield* PromptService;

    // Validate git repository
    yield* git.ensureIsGitRepo();

    const currentBranch = yield* ensureNotOnProtectedBranch("reset");

    // Set up upstream remote
    yield* git.setUpstreamRemote(upstream);

    yield* git.ensureUpstreamBranchConnected({
      targetBranch: branch,
    });

    // Determine if this is a "reset to main" operation
    const isExplicitMain =
      Option.isSome(lessonId) && lessonId.value === "main";

    let commitToUse: string;
    let selectedLessonId: string;

    if (isExplicitMain) {
      yield* git.fetch("upstream", "main");
      commitToUse = yield* git.revParse("upstream/main");
      selectedLessonId = "main";
    } else {
      const result = yield* selectLessonCommit({
        branch,
        lessonId,
        promptMessage:
          "Which lesson do you want to reset to? (type to search)",
        excludeCurrentBranch: false,
        extraChoices: [
          { lessonId: "main", message: "Reset to the starting point" },
        ],
      });

      if (result.lessonId === "main") {
        yield* git.fetch("upstream", "main");
        commitToUse = yield* git.revParse("upstream/main");
        selectedLessonId = "main";
      } else {
        commitToUse = result.commit.sha;
        selectedLessonId = result.lessonId;
      }
    }

    const isResetToMain = selectedLessonId === "main";

    // Cannot reset to main while on main
    if (isResetToMain && currentBranch === "main") {
      return yield* new InvalidBranchOperationError({
        message:
          "Cannot reset to main while on the main branch. Create a new branch first.",
      });
    }

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
      action = yield* promptService.selectResetAction(
        currentBranch
      );
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
      const branchName = yield* promptService.inputBranchName(
        "new"
      );

      yield* Console.log(
        `Creating branch ${branchName} from ${selectedLessonId}...`
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

        yield* promptService.confirmResetWithUncommittedChanges();
      }
    }

    // Reset to target commit
    yield* Console.log(
      `Resetting to ${selectedLessonId}...`
    );

    if (demo) {
      yield* git.applyAsUnstagedChanges(commitToUse);

      yield* Console.log(
        `✓ Demo mode: Reset to ${selectedLessonId} with unstaged changes`
      );
    } else {
      yield* git.resetHard(commitToUse);

      yield* Console.log(
        `✓ Reset to ${selectedLessonId}`
      );
    }
  });

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
    demo: Options.boolean("demo").pipe(Options.withAlias("d")),
    upstream: Options.text("upstream").pipe(
      Options.withDescription(
        "Git URL or local path to the upstream exercise repo"
      )
    ),
    cwd: cwdOption,
  },
  /* v8 ignore start - CLI error handlers are presentation logic */
  ({ branch, cwd, demo, lessonId, upstream }) =>
    runReset({ branch, lessonId, demo, upstream }).pipe(
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
  /* v8 ignore stop */
).pipe(
  CLICommand.withDescription("Reset to a specific lesson commit")
);
