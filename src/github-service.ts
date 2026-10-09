import { Command } from "@effect/platform";
import { Data, Effect, Option } from "effect";
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

/**
 * Error thrown when a git remote's URL doesn't point at a GitHub repo
 * that `gh` can see.
 */
export class NotAGitHubRemoteError extends Data.TaggedError(
  "NotAGitHubRemoteError"
)<{
  remote: string;
  message: string;
}> {}

/**
 * Error thrown when a `gh pr` command (list, create, edit, ready) fails.
 */
export class FailedPullRequestCommandError extends Data.TaggedError(
  "FailedPullRequestCommandError"
)<{
  message: string;
}> {}

/**
 * Parses a git remote URL into the `[HOST/]OWNER/REPO` form `gh --repo`
 * accepts. `github.com` is left implicit; any other host is kept so
 * GitHub Enterprise remotes still resolve. Returns null for anything
 * that isn't a host + owner/repo URL (a local path, a bare host).
 */
export const parseGitHubRemoteUrl = (
  url: string
): string | null => {
  const trimmed = url.trim();

  // scp-like: git@github.com:owner/repo.git
  const scpMatch = trimmed.match(
    /^(?:[^@/]+@)?([^:/]{2,}):(?!\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  );
  // URL-like: https://github.com/owner/repo(.git), ssh://git@host/owner/repo
  const urlMatch = trimmed.match(
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  );

  const match = urlMatch ?? scpMatch;
  if (!match) {
    return null;
  }

  const [, host, owner, repo] = match;
  const normalizedHost = host!.toLowerCase();

  return normalizedHost === "github.com" ||
    normalizedHost === "www.github.com"
    ? `${owner}/${repo}`
    : `${normalizedHost}/${owner}/${repo}`;
};

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
    /**
     * Verifies `repo` (`[HOST/]OWNER/REPO`) is a GitHub repository the
     * authenticated user can see.
     */
    ensureRepoAccessible: Effect.fn("ensureRepoAccessible")(
      function* (repo: string, remote: string) {
        const exitCode = yield* runSilentExitCode(
          "gh",
          "repo",
          "view",
          repo,
          "--json",
          "name"
        ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

        if (exitCode !== 0) {
          return yield* new NotAGitHubRemoteError({
            remote,
            message:
              `Your "${remote}" remote points at ${repo}, but the GitHub CLI can't find that repository.\n` +
              "Check you're logged in to the right GitHub account (`gh auth status`).",
          });
        }
      }
    ),

    /**
     * The open PR whose head branch is `head` in `repo`, if there is one.
     */
    findOpenPullRequest: Effect.fn("findOpenPullRequest")(
      function* (opts: { repo: string; head: string }) {
        const output = yield* runString(
          "gh",
          "pr",
          "list",
          "--repo",
          opts.repo,
          "--head",
          opts.head,
          "--state",
          "open",
          "--json",
          "number,url",
          "--limit",
          "1"
        ).pipe(Effect.catchAll(() => Effect.succeed("")));

        const parsed = yield* Effect.try(
          () =>
            JSON.parse(output) as Array<{
              number: number;
              url: string;
            }>
        ).pipe(
          Effect.catchAll(
            () =>
              new FailedPullRequestCommandError({
                message: `Failed to look up open pull requests for ${opts.head} on ${opts.repo}.`,
              })
          )
        );

        const pr = parsed[0];
        return pr ? Option.some(pr) : Option.none();
      }
    ),

    /**
     * `gh pr create --draft --fill`: title and body come from the
     * branch's commits, exactly as GitHub's own --fill would write them.
     */
    createDraftPullRequest: Effect.fn("createDraftPullRequest")(
      function* (opts: {
        repo: string;
        base: string;
        head: string;
      }) {
        const exitCode = yield* runInheritExitCode(
          "gh",
          "pr",
          "create",
          "--repo",
          opts.repo,
          "--draft",
          "--fill",
          "--base",
          opts.base,
          "--head",
          opts.head
        ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

        if (exitCode !== 0) {
          return yield* new FailedPullRequestCommandError({
            message: `Failed to create a pull request for ${opts.head} (exit code: ${exitCode}).`,
          });
        }
      }
    ),

    /** Overwrites an open PR's title, body and base branch. */
    editPullRequest: Effect.fn("editPullRequest")(
      function* (opts: {
        repo: string;
        number: number;
        title: string;
        body: string;
        base: string;
      }) {
        const exitCode = yield* runInheritExitCode(
          "gh",
          "pr",
          "edit",
          String(opts.number),
          "--repo",
          opts.repo,
          "--title",
          opts.title,
          "--body",
          opts.body,
          "--base",
          opts.base
        ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

        if (exitCode !== 0) {
          return yield* new FailedPullRequestCommandError({
            message: `Failed to update pull request #${opts.number} (exit code: ${exitCode}).`,
          });
        }
      }
    ),

    /**
     * Converts a PR back to draft (`gh pr ready --undo`). A PR that is
     * already a draft is left as it is.
     */
    markPullRequestAsDraft: Effect.fn("markPullRequestAsDraft")(
      function* (opts: { repo: string; number: number }) {
        const exitCode = yield* runInheritExitCode(
          "gh",
          "pr",
          "ready",
          String(opts.number),
          "--undo",
          "--repo",
          opts.repo
        ).pipe(Effect.catchAll(() => Effect.succeed(-1)));

        if (exitCode !== 0) {
          return yield* new FailedPullRequestCommandError({
            message: `Failed to convert pull request #${opts.number} to a draft (exit code: ${exitCode}).`,
          });
        }
      }
    ),
  };
});

export class GitHubService extends Effect.Service<GitHubService>()(
  "GitHubService",
  {
    effect: makeGitHubService,
    dependencies: [defaultGitServiceConfigLayer],
  }
) {}
