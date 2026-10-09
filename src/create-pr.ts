import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Data, Effect, Option } from "effect";
import {
  selectLessonCommit,
  splitLessonId,
} from "./commit-utils.js";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";
import {
  ensureNotOnProtectedBranch,
  InvalidBranchOperationError,
} from "./errors.js";
import { GitService, GitServiceConfig } from "./git-service.js";
import {
  GitHubService,
  NotAGitHubRemoteError,
  parseGitHubRemoteUrl,
} from "./github-service.js";
import { cwdOption } from "./options.js";
import { PromptService } from "./prompt-service.js";
import { withUpstreamCleanup } from "./upstream-cleanup.js";

/** The remote the student's PR is opened against. */
const ORIGIN = "origin";

/** The CLI-owned branch that carries the lesson's diff. */
export const prBranchName = (lessonId: string) =>
  `pr/${lessonId}`;

/** The CLI-owned branch the PR targets: the lesson commit's parent. */
export const prBaseBranchName = (lessonId: string) =>
  `pr-base/${lessonId}`;

export class DirtyWorkingTreeError extends Data.TaggedError(
  "DirtyWorkingTreeError"
)<{
  statusOutput: string;
  message: string;
}> {}

export class LessonHasNoParentError extends Data.TaggedError(
  "LessonHasNoParentError"
)<{
  lessonId: string;
  message: string;
}> {}

/**
 * Turns a lesson commit's message into the PR commit's message: the
 * `<lessonId>: ` prefix comes off the subject, the body is kept.
 *
 * The prefix is stripped repeatedly so the result can never carry the
 * lesson id — the CLI's lesson lookup must not mistake the PR commit for
 * the lesson. A subject that is nothing but the prefix falls back to the
 * bare lesson id, which has no ": " and so parses as a non-lesson.
 *
 * Also returns the title and body `gh pr create --fill` would derive
 * from the resulting single-commit branch: its subject and its body.
 * They're passed to gh explicitly rather than via `--fill`, which depends
 * on local remote-tracking refs (see createDraftPullRequest).
 */
export const toPrCommitMessage = (
  lessonId: string,
  fullMessage: string
): { message: string; title: string; body: string } => {
  const [rawSubject = "", ...rest] = fullMessage
    .trim()
    .split("\n");

  let subject = rawSubject.trim();
  for (;;) {
    const split = splitLessonId(subject);
    if (split.lessonId !== lessonId) break;
    subject = split.description;
  }
  // A trailing bare prefix ("add-x:") has no ": " left to split on.
  if (subject === "" || subject === `${lessonId}:`) {
    subject = lessonId;
  }

  const body = rest.join("\n").trim();

  return {
    message: body === "" ? subject : `${subject}\n\n${body}`,
    title: subject,
    body,
  };
};

/**
 * Core create-pr logic, extracted for testability.
 *
 * Opens (or refreshes) a draft PR on the student's `origin` whose diff is
 * exactly one lesson commit: `pr-base/<lesson>` sits at the lesson's
 * parent, `pr/<lesson>` carries the lesson's tree as a single commit on
 * top of it.
 */
export const runCreatePr = ({
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
      const github = yield* GitHubService;
      const promptService = yield* PromptService;

      // --- Preflight: nothing below changes anything until it passes ---

      yield* git.ensureIsGitRepo();

      yield* ensureNotOnProtectedBranch("create-pr");

      const { hasUncommittedChanges, statusOutput } =
        yield* git.getUncommittedChanges();

      if (hasUncommittedChanges) {
        return yield* new DirtyWorkingTreeError({
          statusOutput,
          message:
            "You have uncommitted changes. Commit or stash them, then run create-pr again.",
        });
      }

      yield* github.ensureInstalled();
      yield* github.ensureAuthenticated();

      // The PR goes to the student's own repo. Resolve it explicitly
      // rather than letting gh guess: with an `upstream` remote present,
      // gh would pick that as the base repo.
      const originUrl = yield* git.getRemoteUrl(ORIGIN);
      const repo = Option.isSome(originUrl)
        ? parseGitHubRemoteUrl(originUrl.value)
        : null;

      if (repo === null) {
        return yield* new NotAGitHubRemoteError({
          remote: ORIGIN,
          message: Option.isSome(originUrl)
            ? `Your "${ORIGIN}" remote (${originUrl.value}) isn't a GitHub repository. create-pr opens the PR on GitHub, so "${ORIGIN}" needs to point at your GitHub repo.`
            : `This repo has no "${ORIGIN}" remote. create-pr opens the PR on your GitHub repo — run \`ai-hero fork\` first, or add it with \`git remote add ${ORIGIN} <url>\`.`,
        });
      }

      yield* github.ensureRepoAccessible(repo, ORIGIN);

      // --- Resolve the lesson exactly as `reset` does ---

      yield* git.setUpstreamRemote(upstream);

      yield* git.ensureUpstreamBranchConnected({
        targetBranch: branch,
      });

      const { commit, lessonId: selectedLessonId } =
        yield* selectLessonCommit({
          branch,
          lessonId,
          promptMessage:
            "Which lesson do you want to open a PR for? (type to search)",
          excludeCurrentBranch: false,
        });

      const lessonCommit = yield* git.revParse(commit.sha);
      // revParse doesn't fail on a non-zero exit — `rev-parse <root>^`
      // echoes the input back — so check the result is a sha.
      const parentCommit = yield* git
        .revParse(`${lessonCommit}^`)
        .pipe(Effect.orElseSucceed(() => ""));

      if (!/^[0-9a-f]{40,64}$/.test(parentCommit)) {
        return yield* new LessonHasNoParentError({
          lessonId: selectedLessonId,
          message: `Lesson ${selectedLessonId} is the first commit in the repo, so it has no parent to open a PR against.`,
        });
      }

      const prBranch = prBranchName(selectedLessonId);
      const prBaseBranch = prBaseBranchName(selectedLessonId);

      // Lesson ids are "whatever precedes the first ': '", so one can
      // hold characters git refuses in a branch name. Catch that before
      // anything is pushed.
      for (const name of [prBranch, prBaseBranch]) {
        if (!(yield* git.isValidBranchName(name))) {
          return yield* new InvalidBranchOperationError({
            message: `Lesson id "${selectedLessonId}" can't be used in a branch name ("${name}").`,
          });
        }
      }

      // pr/<lesson> is CLI-owned, but it's also a local branch the
      // student may have committed to — ask before replacing it.
      const prBranchExists = yield* git.hasLocalBranch(prBranch);
      if (prBranchExists) {
        yield* promptService.confirmContinue(
          `Branch "${prBranch}" already exists. Replace it with a fresh copy of ${selectedLessonId}? Any commits you made on it will be discarded.`,
          false
        );
      }

      // --- Build the single PR commit ---

      const { body, message, title } = toPrCommitMessage(
        selectedLessonId,
        yield* git.getCommitMessage(lessonCommit)
      );

      // commit-tree needs an identity. Existing config is left alone;
      // a student who never set one gets their GitHub login, as in fork.
      const login = yield* github.getAuthenticatedUser();
      yield* git.ensureCommitterIdentity({
        name: login,
        email: `${login}@users.noreply.github.com`,
      });

      const prCommit = yield* git.commitTree({
        tree: `${lessonCommit}^{tree}`,
        parent: parentCommit,
        message,
      });

      // --- Publish ---

      yield* Console.log(
        `Pushing ${prBaseBranch} (the lesson's starting point) to ${ORIGIN}...`
      );
      yield* git.pushRefForce(
        ORIGIN,
        parentCommit,
        `refs/heads/${prBaseBranch}`
      );

      yield* git.checkoutResetBranchAt(prBranch, prCommit);
      yield* git.setConfig(
        `branch.${prBranch}.gh-merge-base`,
        prBaseBranch
      );

      yield* Console.log(`Pushing ${prBranch} to ${ORIGIN}...`);
      yield* git.pushRefForce(
        ORIGIN,
        `refs/heads/${prBranch}`,
        `refs/heads/${prBranch}`
      );

      const existingPr = yield* github.findOpenPullRequest({
        repo,
        head: prBranch,
      });

      if (Option.isSome(existingPr)) {
        yield* Console.log(
          `Updating existing pull request #${existingPr.value.number}...`
        );
        yield* github.editPullRequest({
          repo,
          number: existingPr.value.number,
          title,
          body,
          base: prBaseBranch,
        });
        yield* github.markPullRequestAsDraft({
          repo,
          number: existingPr.value.number,
        });
      } else {
        yield* github.createDraftPullRequest({
          repo,
          base: prBaseBranch,
          head: prBranch,
          title,
          body,
        });
      }

      const pr = yield* github.findOpenPullRequest({
        repo,
        head: prBranch,
      });
      const prUrl = Option.isSome(pr)
        ? pr.value.url
        : `https://github.com/${repo}/pulls`;

      yield* Console.log(
        `\n✓ Draft PR for ${selectedLessonId}: ${prUrl}\n\n` +
          "Next step: ask your agent to rewrite the PR body, e.g.\n" +
          `  "Read ${prUrl} and rewrite its description to explain the change."`
      );

      return { prUrl, prBranch, prBaseBranch };
    })
  );

const printError = (error: { message: string }) =>
  Effect.gen(function* () {
    yield* Console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });

export const createPr = CLICommand.make(
  "create-pr",
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
    runCreatePr({ branch, lessonId, upstream }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({ cwd })
      ),
      Effect.catchTags({
        DirtyWorkingTreeError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            yield* Console.error(error.statusOutput);
            process.exitCode = 1;
          }),
        CommitNotFoundError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(
              `Error: No commit found for lesson ${error.lessonId} on branch ${error.branch}`
            );
            process.exitCode = 1;
          }),
        PromptCancelledError: () =>
          Effect.gen(function* () {
            yield* Console.log("\nCancelled. Nothing was changed.");
          }),
        NotAGitRepoError: printError,
        InvalidBranchOperationError: printError,
        GhNotInstalledError: printError,
        GhNotAuthenticatedError: printError,
        FailedToGetGhUserError: printError,
        NotAGitHubRemoteError: printError,
        LessonHasNoParentError: printError,
        FailedToFetchUpstreamError: printError,
        FailedToTrackBranchError: printError,
        FailedToCommitError: printError,
        FailedToPushError: printError,
        FailedToCreateBranchError: printError,
        FailedPullRequestCommandError: printError,
      }),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Console.error(`Unexpected error: ${error}`);
          process.exitCode = 1;
        })
      )
    )
  /* v8 ignore stop */
).pipe(
  CLICommand.withDescription(
    "Open a draft PR on your GitHub repo containing only one lesson's diff"
  )
);
