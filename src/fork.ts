import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Data, Effect, Option } from "effect";
import * as path from "node:path";
import {
  GitService,
  GitServiceConfig,
} from "./git-service.js";
import {
  FailedToCreateRepoError,
  GhRepoAlreadyExistsError,
  GitHubService,
  parseGitHubRemoteUrl,
  type RepoVisibility,
} from "./github-service.js";
import { cwdOption } from "./options.js";
import { PromptService } from "./prompt-service.js";

/**
 * Turns an arbitrary folder name into a valid GitHub repo name:
 * only letters, digits, `.`, `-` and `_` are allowed; everything else
 * becomes a hyphen.
 */
export const sanitizeRepoName = (name: string): string => {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned === "" ? "my-course-repo" : cleaned;
};

/**
 * `fork` can't run yet: the clone isn't in a state whose `main` can be
 * published as-is. Nothing has been changed when this is raised.
 */
export class ForkNotReadyError extends Data.TaggedError(
  "ForkNotReadyError"
)<{
  message: string;
}> {}

/**
 * `fork` has already been run in this folder: its `origin` is a
 * github.com repo the authenticated user owns. Nothing has been changed
 * when this is raised.
 */
export class AlreadyForkedError extends Data.TaggedError(
  "AlreadyForkedError"
)<{
  fullName: string;
  message: string;
}> {}

/**
 * The `OWNER/REPO` that `originUrl` points at, if it's a github.com
 * repo owned by `login` (GitHub logins are case-insensitive). Remotes
 * on other hosts (GitLab, GitHub Enterprise) never match: `gh api user`
 * answers for github.com, so an owner name elsewhere may be someone
 * else.
 */
export const ownForkOf = (
  originUrl: string,
  login: string
): string | null => {
  const repo = parseGitHubRemoteUrl(originUrl);
  const parts = repo?.split("/") ?? [];
  if (parts.length !== 2) {
    return null;
  }
  return parts[0]!.toLowerCase() === login.toLowerCase()
    ? repo
    : null;
};

/**
 * Core fork logic, extracted for testability.
 *
 * Turns the student's current course clone into a GitHub repository
 * they own (public, or private with `--private`), keeping the course's
 * history: disconnects the course remote, creates the repo via the
 * GitHub CLI, and pushes `main` to it as `origin`. Only `main` is
 * pushed; other local branches and tags stay local.
 */
export const runFork = (opts: {
  name: Option.Option<string>;
  private: boolean;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const github = yield* GitHubService;
    const promptService = yield* PromptService;
    const config = yield* GitServiceConfig;
    const visibility: RepoVisibility = opts.private
      ? "private"
      : "public";

    // 1. GitHub CLI must be installed and authenticated.
    yield* github.ensureInstalled();
    yield* github.ensureAuthenticated();

    // 2. Must be run from inside the student's clone.
    yield* git.ensureIsGitRepo();

    // 3. Refuse to fork a folder that's already forked: its origin is
    //    the student's own repo, not the course's, so going on would
    //    mean removing the remote for their own work. Checked before the
    //    readiness checks, since none of their fixes would help here.
    //    No origin (a create that failed after the course remote was
    //    removed) or someone else's origin (the course org) goes on.
    const login = yield* github.getAuthenticatedUser();
    const originUrl = yield* git.getRemoteUrl("origin");
    const ownRepo = Option.isSome(originUrl)
      ? ownForkOf(originUrl.value, login)
      : null;
    if (ownRepo !== null) {
      return yield* new AlreadyForkedError({
        fullName: ownRepo,
        message:
          `This folder is already forked to ${ownRepo}:\n` +
          `  https://github.com/${ownRepo}\n` +
          "Its \"origin\" remote is your own repo, so there's nothing to fork. " +
          "Nothing was changed.\n" +
          "Keep working here, and publish your commits with:\n" +
          "  git push",
      });
    }

    // 4. The clone's main is what gets published, so it must be on
    //    main, with every tracked change committed, and its whole
    //    history present. Refuse (changing nothing) otherwise.
    const currentBranch = yield* git.getCurrentBranch();
    if (currentBranch !== "main") {
      return yield* new ForkNotReadyError({
        message:
          (currentBranch === ""
            ? "You're not on a branch. "
            : `You're on "${currentBranch}". `) +
          "fork publishes your main branch, so switch to it first:\n" +
          "  git checkout main\n" +
          "then run fork again.",
      });
    }

    const trackedChanges = yield* git.getTrackedChanges();
    if (trackedChanges !== "") {
      return yield* new ForkNotReadyError({
        message:
          "You have uncommitted changes:\n" +
          trackedChanges
            .split("\n")
            .map((line) => `  ${line}\n`)
            .join("") +
          "fork publishes your commits, not these changes. Commit them " +
          "(git commit -am \"<message>\") or discard them " +
          "(git restore .), then run fork again.",
      });
    }

    if (yield* git.isShallowRepository()) {
      return yield* new ForkNotReadyError({
        message:
          "This is a shallow clone (made with --depth), so part of the " +
          "course history is missing and can't be pushed to a new repo. " +
          "Fetch the rest first:\n" +
          "  git fetch --unshallow\n" +
          "then run fork again.",
      });
    }

    // 5. Work out the repo name (flag > prompt, defaulting to the
    //    current directory name).
    const defaultName = sanitizeRepoName(
      path.basename(config.cwd)
    );
    const repoName = sanitizeRepoName(
      Option.isSome(opts.name)
        ? opts.name.value
        : yield* promptService.inputRepoName(defaultName, visibility)
    );

    // 6. Guard against clobbering: fail early if a repo with this name
    //    already exists on the user's account. It isn't this folder's
    //    (step 3 caught that), so it may well be their work from another
    //    folder: suggest another name, never deleting it.
    const fullName = `${login}/${repoName}`;

    const exists = yield* github.repoExists(fullName);
    if (exists) {
      return yield* new GhRepoAlreadyExistsError({
        fullName,
        message:
          `A repository named "${fullName}" already exists on your GitHub account.\n` +
          "It isn't this folder's repo, so leave it be: run fork again " +
          "with a different name.",
      });
    }

    // 7. Confirm before disconnecting from the course repo.
    yield* Console.log(
      "\nThis will:\n" +
        '  • disconnect this folder from the course repo (remove the "origin" remote)\n' +
        `  • create a new ${visibility.toUpperCase()} GitHub repo: ${fullName}\n` +
        '  • push your main branch, with its history, to it as "origin"\n'
    );
    yield* promptService.confirmContinue("Continue?", false);

    // 8. Disconnect from the course repo, so `gh repo create` can add
    //    the new repo as origin. History and branches stay as they are.
    yield* git.removeRemote("origin");

    // 9. Create the repo and push to it as origin. `gh repo create
    //    --push` pushes only the current branch (main). The course remote
    //    is already gone by now, so if the create fails, say how to
    //    finish by hand.
    yield* Console.log(
      `Creating ${visibility} repo ${fullName} and pushing main...\n`
    );
    yield* github.createRepoFromCwd(repoName, visibility).pipe(
      Effect.mapError(
        (error) =>
          new FailedToCreateRepoError({
            name: error.name,
            message:
              `${error.message}\n\n` +
              "Your files and git history are untouched, but this folder is no longer " +
              "connected to the course repo. Fix the problem above (gh prints the reason), " +
              "then finish by hand from this folder:\n" +
              `  gh repo create ${repoName} --${visibility} --source=. --remote=origin --push`,
          })
      )
    );

    yield* Console.log(
      `\n✓ Done! Your ${visibility} repo is ready:\n` +
        `  https://github.com/${fullName}\n\n` +
        "GitHub Issues are enabled by default — your agent can now use it as a backlog."
    );
  });

export const fork = CLICommand.make(
  "fork",
  {
    name: Args.text({ name: "repo-name" }).pipe(Args.optional),
    private: Options.boolean("private").pipe(
      Options.withDescription(
        "Create a private repo instead of a public one. The course's GitHub Actions are free only on public repos; private repos use your account's Actions minutes"
      )
    ),
    cwd: cwdOption,
  },
  /* v8 ignore start - CLI error handlers are presentation logic */
  ({ cwd, name, private: isPrivate }) =>
    runFork({ name, private: isPrivate }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({ cwd })
      ),
      Effect.catchTags({
        GhNotInstalledError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        GhNotAuthenticatedError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        FailedToGetGhUserError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        AlreadyForkedError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        GhRepoAlreadyExistsError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        FailedToCreateRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        NotAGitRepoError: () => {
          return Effect.gen(function* () {
            yield* Console.error(
              "Error: This doesn't look like your course repo. Run `ai-hero fork` from inside your cloned course folder."
            );
            process.exitCode = 1;
          });
        },
        ForkNotReadyError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        PromptCancelledError: () => {
          return Effect.gen(function* () {
            yield* Console.log("\nCancelled. Nothing was changed.");
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
  CLICommand.withDescription(
    "Turn your course clone into a GitHub repo you own, keeping the course history (public by default, or --private)"
  )
);
