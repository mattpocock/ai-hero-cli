import { Command } from "@effect/platform";
import { Data, Effect } from "effect";
import {
  defaultGitServiceConfigLayer,
  GitServiceConfig,
} from "./git-service.js";

/**
 * Error thrown when the GitHub CLI (`gh`) is not installed / not on PATH.
 */
export class GhNotInstalledError extends Data.TaggedError(
  "GhNotInstalledError"
)<{
  message: string;
}> {}

/**
 * Error thrown when the GitHub CLI is installed but the user is not
 * logged in (`gh auth status` fails).
 */
export class GhNotAuthenticatedError extends Data.TaggedError(
  "GhNotAuthenticatedError"
)<{
  message: string;
}> {}

/**
 * Error thrown when a repo with the requested name already exists on the
 * user's GitHub account.
 */
export class GhRepoAlreadyExistsError extends Data.TaggedError(
  "GhRepoAlreadyExistsError"
)<{
  fullName: string;
  message: string;
}> {}

/**
 * Error thrown when `gh repo create` fails for any other reason.
 */
export class FailedToCreateRepoError extends Data.TaggedError(
  "FailedToCreateRepoError"
)<{
  name: string;
  message: string;
}> {}

/**
 * Error thrown when we can't determine the authenticated GitHub user.
 */
export class FailedToGetGhUserError extends Data.TaggedError(
  "FailedToGetGhUserError"
)<{
  message: string;
}> {}

export const makeGitHubService = Effect.gen(function* () {
  const config = yield* GitServiceConfig;

  const runSilentExitCode = Effect.fn("gh.runSilentExitCode")(
    function* (...commandArgs: [string, ...Array<string>]) {
      const command = Command.make(...commandArgs).pipe(
        Command.workingDirectory(config.cwd)
      );
      return yield* Command.exitCode(command);
    }
  );

  const runInheritExitCode = Effect.fn("gh.runInheritExitCode")(
    function* (...commandArgs: [string, ...Array<string>]) {
      const command = Command.make(...commandArgs).pipe(
        Command.workingDirectory(config.cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );
      return yield* Command.exitCode(command);
    }
  );

  const runString = Effect.fn("gh.runString")(function* (
    ...commandArgs: [string, ...Array<string>]
  ) {
    const command = Command.make(...commandArgs).pipe(
      Command.workingDirectory(config.cwd)
    );
    return (yield* Command.string(command)).trim();
  });

  return {
    /**
     * Verifies the GitHub CLI is installed and on the PATH.
     */
    ensureInstalled: Effect.fn("ensureInstalled")(
      function* () {
        const exitCode = yield* runSilentExitCode(
          "gh",
          "--version"
        ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

        if (exitCode !== 0) {
          return yield* new GhNotInstalledError({
            message:
              "The GitHub CLI (gh) is not installed.\n" +
              "Install it from https://cli.github.com/ and try again.",
          });
        }
      }
    ),

    /**
     * Verifies the user is logged in to the GitHub CLI.
     */
    ensureAuthenticated: Effect.fn("ensureAuthenticated")(
      function* () {
        const exitCode = yield* runSilentExitCode(
          "gh",
          "auth",
          "status"
        ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

        if (exitCode !== 0) {
          return yield* new GhNotAuthenticatedError({
            message:
              "You're not logged in to the GitHub CLI.\n" +
              "Run `gh auth login` and follow the prompts, then try again.",
          });
        }
      }
    ),

    /**
     * Returns the login (username) of the authenticated GitHub user.
     */
    getAuthenticatedUser: Effect.fn("getAuthenticatedUser")(
      function* () {
        return yield* runString(
          "gh",
          "api",
          "user",
          "--jq",
          ".login"
        ).pipe(
          Effect.catchAll(
            (error) =>
              new FailedToGetGhUserError({
                message: `Failed to determine your GitHub username: ${error}`,
              })
          )
        );
      }
    ),

    /**
     * Returns true if `<owner>/<name>` already exists on GitHub.
     */
    repoExists: Effect.fn("repoExists")(function* (
      fullName: string
    ) {
      const exitCode = yield* runSilentExitCode(
        "gh",
        "repo",
        "view",
        fullName
      ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

      return exitCode === 0;
    }),

    /**
     * Creates a private repo named `name` from the current directory,
     * wiring up `origin` and pushing the current branch.
     */
    createPrivateRepoFromCwd: Effect.fn(
      "createPrivateRepoFromCwd"
    )(function* (name: string) {
      const exitCode = yield* runInheritExitCode(
        "gh",
        "repo",
        "create",
        name,
        "--private",
        "--source=.",
        "--remote=origin",
        "--push"
      ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

      if (exitCode !== 0) {
        return yield* new FailedToCreateRepoError({
          name,
          message: `Failed to create the GitHub repository "${name}" (exit code: ${exitCode}).`,
        });
      }
    }),
  };
});

export class GitHubService extends Effect.Service<GitHubService>()(
  "GitHubService",
  {
    effect: makeGitHubService,
    dependencies: [defaultGitServiceConfigLayer],
  }
) {}
