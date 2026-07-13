import {
  Args,
  Command as CLICommand,
} from "@effect/cli";
import { Console, Effect, Option } from "effect";
import * as path from "node:path";
import {
  GitService,
  GitServiceConfig,
} from "./git-service.js";
import {
  GhRepoAlreadyExistsError,
  GitHubService,
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
 * Core fork logic, extracted for testability.
 *
 * Turns the student's current course clone into a fresh private GitHub
 * repository they own: resets local history, creates the repo via the
 * GitHub CLI, and pushes the working copy to it as `origin`.
 */
export const runFork = (opts: {
  name: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const github = yield* GitHubService;
    const promptService = yield* PromptService;
    const config = yield* GitServiceConfig;

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
        : yield* promptService.inputRepoName(defaultName)
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

    // 5. Confirm before touching local history (destructive).
    yield* Console.log(
      "\nThis will:\n" +
        "  • replace this folder's git history with a single fresh commit\n" +
        `  • create a new PRIVATE GitHub repo: ${fullName}\n` +
        '  • push your current files to it as "origin"\n'
    );
    yield* promptService.confirmContinue(
      "Continue? Your local git history will be reset.",
      false
    );

    // 6. Fresh history: disconnect from the course repo and re-init.
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

    // 7. Create the private repo and push to it as origin.
    yield* Console.log(
      `Creating private repo ${fullName} and pushing...\n`
    );
    yield* github.createPrivateRepoFromCwd(repoName);

    yield* Console.log(
      `\n✓ Done! Your private repo is ready:\n` +
        `  https://github.com/${fullName}\n\n` +
        "GitHub Issues are enabled by default — your agent can now use it as a backlog."
    );
  });

export const fork = CLICommand.make(
  "fork",
  {
    name: Args.text({ name: "repo-name" }).pipe(Args.optional),
    cwd: cwdOption,
  },
  /* v8 ignore start - CLI error handlers are presentation logic */
  ({ cwd, name }) =>
    runFork({ name }).pipe(
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
    "Turn your course clone into a fresh private GitHub repo you own"
  )
);
