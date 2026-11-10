import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Effect, Option } from "effect";
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

const quoteIfNeeded = (p: string) =>
  /^[\w./@+-]+$/.test(p) ? p : `"${p}"`;

/** The warning `fork` prints when symlinks are checked out as files. */
export const forkSymlinksWarning = (
  symlinkPaths: Array<string>
): string =>
  "\n⚠ Symlinks are disabled for this repo (core.symlinks=false), " +
  "which Windows sets automatically when Developer Mode is off and " +
  "you're not running as Administrator. This course has symlinks:\n" +
  symlinkPaths.map((p) => `    ${p}\n`).join("") +
  "Here they're plain text files, so if you continue they'll be " +
  "published to your new repo as plain files, and the course will " +
  "look broken there.\n" +
  "  Fix: answer no below, turn on Developer Mode (Settings > " +
  "Privacy & security > For developers), or re-run your terminal as " +
  "Administrator, then:\n" +
  "    git config core.symlinks true\n" +
  `    git checkout -- ${symlinkPaths.map(quoteIfNeeded).join(" ")}\n` +
  "  and run fork again.\n";

/**
 * Core fork logic, extracted for testability.
 *
 * Turns the student's current course clone into a fresh GitHub
 * repository they own (public, or private with `--private`): resets
 * local history, creates the repo via the GitHub CLI, and pushes the
 * working copy to it as `origin`.
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

    // 3. Work out the repo name (flag > prompt, defaulting to the
    //    current directory name).
    const defaultName = sanitizeRepoName(
      path.basename(config.cwd)
    );
    const repoName = sanitizeRepoName(
      Option.isSome(opts.name)
        ? opts.name.value
        : yield* promptService.inputRepoName(defaultName, visibility)
    );

    // 4. Guard against clobbering / re-running: fail early if a repo
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

    // 5. With core.symlinks=false (Windows without Developer Mode),
    //    the course's symlinks are checked out as plain text files, and
    //    the fresh commit below would publish them that way. Warn while
    //    the history is still there to restore them from.
    const symlinksDisabled = yield* git.hasSymlinksDisabled();
    if (symlinksDisabled) {
      const symlinkPaths = yield* git.listSymlinkPaths("HEAD");
      if (symlinkPaths.length > 0) {
        yield* Console.log(
          forkSymlinksWarning(symlinkPaths)
        );
      }
    }

    // 6. Confirm before touching local history (destructive).
    yield* Console.log(
      "\nThis will:\n" +
        "  • replace this folder's git history with a single fresh commit\n" +
        `  • create a new ${visibility.toUpperCase()} GitHub repo: ${fullName}\n` +
        '  • push your current files to it as "origin"\n'
    );
    yield* promptService.confirmContinue(
      "Continue? Your local git history will be reset.",
      false
    );

    // 7. Fresh history: disconnect from the course repo and re-init.
    yield* Console.log("Resetting local git history...");
    yield* git.removeGitDirectory();
    yield* git.initRepo();
    // Guarantee a committer identity so the first commit succeeds even if
    // the user has never configured git globally. Falls back to the
    // authenticated GitHub user; existing config is left untouched.
    yield* git.ensureCommitterIdentity({
      name: login,
      email: `${login}@users.noreply.github.com`,
    });
    yield* git.stageAll();
    yield* git.commit("Initial commit");
    yield* git.renameCurrentBranchTo("main");

    // 8. Create the repo and push to it as origin. History is already
    //    reset by now, so if the create fails, say how to finish by hand.
    yield* Console.log(
      `Creating ${visibility} repo ${fullName} and pushing...\n`
    );
    yield* github.createRepoFromCwd(repoName, visibility).pipe(
      Effect.mapError(
        (error) =>
          new FailedToCreateRepoError({
            name: error.name,
            message:
              `${error.message}\n\n` +
              "Your local git history was already reset, but your files are still here, " +
              "committed as a single \"Initial commit\" on main. Fix the problem above " +
              "(gh prints the reason), then finish by hand from this folder:\n" +
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
        FailedToRemoveGitDirError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        FailedToInitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        FailedToCommitError: () => {
          return Effect.gen(function* () {
            yield* Console.error(
              "Error: Nothing to commit — is this folder empty? Run `ai-hero fork` from inside your cloned course folder."
            );
            process.exitCode = 1;
          });
        },
        FailedToRenameBranchError: (error) => {
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
    "Turn your course clone into a fresh GitHub repo you own (public by default, or --private)"
  )
);
