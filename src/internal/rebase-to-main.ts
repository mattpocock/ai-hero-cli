import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { InvalidBranchOperationError } from "../cherry-pick.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService, GitServiceConfig } from "../git-service.js";
import { confirmContinue } from "../prompt-utils.js";

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

      yield* confirmContinue(
        `Do you want to checkout ${opts.target}?`
      );

      const checkoutExitCode = yield* git.runCommandWithExitCode(
        "git",
        "checkout",
        opts.target
      );

      if (checkoutExitCode !== 0) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message: `Failed to checkout ${opts.target}`,
          })
        );
      }

      yield* confirmContinue(`Do you want to rebase to main?`);

      const rebaseExitCode = yield* git.runCommandWithExitCode(
        "git",
        "rebase",
        "main"
      );

      if (rebaseExitCode !== 0) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message: `Failed to rebase to main`,
          })
        );
      }

      yield* confirmContinue(
        `Do you want to force push to ${opts.target}?`
      );

      const forcePushExitCode =
        yield* git.runCommandWithExitCode(
          "git",
          "push",
          "origin",
          opts.target,
          "--force-with-lease"
        );

      if (forcePushExitCode !== 0) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message: `Failed to force push to ${opts.target}`,
          })
        );
      }

      yield* confirmContinue(`Do you want to checkout main?`);

      const backToMainExitCode =
        yield* git.runCommandWithExitCode(
          "git",
          "checkout",
          "main"
        );

      if (backToMainExitCode !== 0) {
        return yield* Effect.fail(
          new InvalidBranchOperationError({
            message: `Failed to checkout main`,
          })
        );
      }

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
