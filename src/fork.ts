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

    // 3. The clone's main is what gets published, so it must be on
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

    // 4. Work out the repo name (flag > prompt, defaulting to the
    //    current directory name).
    const defaultName = sanitizeRepoName(
      path.basename(config.cwd)
    );
    const repoName = sanitizeRepoName(
      Option.isSome(opts.name)
        ? opts.name.value
        : yield* promptService.inputRepoName(defaultName, visibility)
    );

    // 5. Guard against clobbering / re-running: fail early if a repo
    //    with this name already exists on the user's account.
    const login = yield* github.getAuthenticatedUser();
    const fullName = `${login}/${repoName}`;

    const exists = yield* github.repoExists(fullName);
    if (exists) {
      return yield* new GhRepoAlreadyExistsError({
        fullName,
        message:
          `A repository named "${fullName}" already exists on your GitHub account.\n` +
          "Choose a different name, or delete the existing repo first:\n" +
          `  gh repo delete ${fullName}`,
      });
    }

    // 6. Confirm before disconnecting from the course repo.
    yield* Console.log(
      "\nThis will:\n" +
        '  • disconnect this folder from the course repo (remove the "origin" remote)\n' +
        `  • create a new ${visibility.toUpperCase()} GitHub repo: ${fullName}\n` +
        '  • push your main branch, with its history, to it as "origin"\n'
    );
    yield* promptService.confirmContinue("Continue?", false);

    // 7. Disconnect from the course repo, so `gh repo create` can add
    //    the new repo as origin. History and branches stay as they are.
    yield* git.removeRemote("origin");

    // 8. Create the repo and push to it as origin. `gh repo create
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
