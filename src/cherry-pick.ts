import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import type { Option } from "effect";
import { Console, Effect } from "effect";
import { selectLessonCommit } from "./commit-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";
import {
  ensureNotOnProtectedBranch,
  InvalidBranchOperationError,
} from "./errors.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import { cwdOption } from "./options.js";
import { PromptService } from "./prompt-service.js";
import { withUpstreamCleanup } from "./upstream-cleanup.js";

/**
 * Core cherry-pick logic, extracted for testability.
 * Takes branch and lessonId as Effect Option.
 */
export const runCherryPick = ({
  branch,
  lessonId,
  upstream,
}: {
  branch: string;
  lessonId: Option.Option<string>;
  upstream: string;
}) =>
  withUpstreamCleanup(
    { upstream, targetBranch: branch },
    Effect.gen(function* () {
      const git = yield* GitService;
      const promptService = yield* PromptService;

      // Validate git repository
      yield* git.ensureIsGitRepo();

      const currentBranch = yield* ensureNotOnProtectedBranch("cherry-pick");

      // Set up upstream remote
      yield* git.setUpstreamRemote(upstream);

      yield* git.ensureUpstreamBranchConnected({
        targetBranch: branch,
      });

      const { commit: targetCommit, lessonId: selectedLessonId } =
        yield* selectLessonCommit({
          branch,
          lessonId,
          promptMessage:
            "Which lesson do you want to cherry-pick? (type to search)",
          excludeCurrentBranch: true,
        });

      // Check if current branch is the target branch
      if (currentBranch === branch) {
        return yield* new InvalidBranchOperationError({
          message: `Cannot cherry-pick when on target branch "${branch}"`,
        });
      }

      // Check if current branch is main
      if (currentBranch === "main") {
        yield* Console.log(
          "You cannot cherry-pick onto the main branch."
        );

        const branchName = yield* promptService.inputBranchName(
          "working"
        );

        yield* git.checkoutNewBranch(branchName);

        yield* Console.log(
          `✓ Created and switched to ${branchName}`
        );
      }

      yield* Console.log(
        `Cherry-picking ${targetCommit.sha} onto current branch...\n`
      );

      yield* git.cherryPick(targetCommit.sha);

      yield* Console.log(
        `\n✓ Successfully cherry-picked lesson ${selectedLessonId}`
      );
    })
  );

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
    upstream: Options.text("upstream").pipe(
      Options.withDescription(
        "Git URL or local path to the upstream exercise repo"
      )
    ),
    cwd: cwdOption,
  },
  /* v8 ignore start - CLI error handlers are presentation logic */
  ({ branch, cwd, lessonId, upstream }) =>
    runCherryPick({ branch, lessonId, upstream }).pipe(
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
        CherryPickConflictError: (error) => {
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
  /* v8 ignore stop */
).pipe(
  CLICommand.withDescription(
    "Cherry-pick a specific lesson commit onto current branch"
  )
);
