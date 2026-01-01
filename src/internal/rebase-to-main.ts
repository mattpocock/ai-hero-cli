import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { InvalidBranchOperationError } from "../cherry-pick.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import {
  FailedToCheckoutError,
  FailedToPushError,
  GitService,
  GitServiceConfig,
  RebaseConflictError,
} from "../git-service.js";
import { PromptService } from "../prompt-service.js";

export const rebaseToMain = CLICommand.make(
  "rebase-to-main",
  {
    cwd: Options.text("cwd").pipe(
      Options.withDescription(
        "The directory to run the rebase-to-main command in"
      ),
      Options.withDefault(process.cwd())
    ),
    target: Options.text("target").pipe(
      Options.withDescription("The target branch to rebase to"),
      Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
    ),
  },
  (opts) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const promptService = yield* PromptService;

      yield* git.ensureIsGitRepo();

      const currentBranch = yield* git.getCurrentBranch();

      if (currentBranch !== "main") {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message: `Cannot rebase to main when not on main branch`,
          })
        );
      }

      const { hasUncommittedChanges } =
        yield* git.getUncommittedChanges();

      if (hasUncommittedChanges) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message: `Cannot rebase to main when there are uncommitted changes`,
          })
        );
      }

      yield* promptService.confirmContinue(
        `Do you want to checkout ${opts.target}?`
      );

      yield* git.checkout(opts.target).pipe(
        Effect.mapError(
          (e) =>
            new InvalidBranchOperationError({
              message:
                e instanceof FailedToCheckoutError
                  ? e.message
                  : `Failed to checkout ${opts.target}`,
            })
        )
      );

      yield* promptService.confirmContinue(`Do you want to rebase to main?`);

      yield* git.rebase("main").pipe(
        Effect.mapError(
          (e) =>
            new InvalidBranchOperationError({
              message:
                e instanceof RebaseConflictError
                  ? e.message
                  : `Failed to rebase to main`,
            })
        )
      );

      yield* promptService.confirmContinue(
        `Do you want to force push to ${opts.target}?`
      );

      yield* git.pushForceWithLease("origin", opts.target).pipe(
        Effect.mapError(
          (e) =>
            new InvalidBranchOperationError({
              message:
                e instanceof FailedToPushError
                  ? e.message
                  : `Failed to force push to ${opts.target}`,
            })
        )
      );

      yield* promptService.confirmContinue(`Do you want to checkout main?`);

      yield* git.checkout("main").pipe(
        Effect.mapError(
          (e) =>
            new InvalidBranchOperationError({
              message:
                e instanceof FailedToCheckoutError
                  ? e.message
                  : `Failed to checkout main`,
            })
        )
      );

      yield* Console.log(
        `✓ Successfully rebased ${opts.target} to main and force pushed`
      );
    }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd: opts.cwd,
        })
      )
    )
);
