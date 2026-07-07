import { Console, Data, Effect, Option } from "effect";
import { GitService } from "./git-service.js";
import { PromptService } from "./prompt-service.js";

/**
 * Normalizes a numeric lesson ID to the standard format (e.g., "1.1.1" -> "01.01.01").
 * Handles input formats like "1.1.1", "01.1.01", "1-1-1", etc.
 *
 * Returns null for anything that is not a numeric section.lesson.step id — so
 * a slug passes straight through the caller untouched. Kept as a pass-through
 * so numeric ids stay ergonomic while repos migrate to slugs.
 */
export const normalizeLessonId = (lessonId: string): string | null => {
  // Match pattern like 1.1.1, 01.01.01, 1-1-1, etc.
  const match = lessonId.match(/^(\d+)[.-](\d+)[.-](\d+)$/);
  if (!match) {
    return null;
  }
  return `${match[1]!.padStart(2, "0")}.${match[2]!.padStart(2, "0")}.${match[3]!.padStart(2, "0")}`;
};

export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  lessonId: string;
  branch: string;
}> {}

type ParsedCommit = {
  /** Short commit SHA */
  sha: string;
  /** Commit message with the lesson-id prefix removed (e.g., "Add new feature" from "add-feature: Add new feature") */
  message: string;
  /** Lesson id — everything before the first ": " — or null when the commit has no such prefix */
  lessonId: string | null;
};

/** The parse boundary: everything before the first ": " is the lesson id. */
const LESSON_ID_BOUNDARY = ": ";

/**
 * Parses `git log --oneline` output into commits, extracting each lesson id as
 * the token before the first ": ". A slug (`add-settings-json`), a numeric id
 * (`06.06.01`), and a conventional-commit type (`fix`) are all just "the token
 * before the colon" — there is no format-specific logic here. Commits with no
 * ": " (a bare `initial`, a `WIP foo`) get a null id and are treated as
 * non-lessons. Fencing out base/conventional commits is the range's job (see
 * getCandidateCommits), not this function's.
 */
export const parseCommits = (
  commitHistory: string
): Array<ParsedCommit> => {
  return commitHistory
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ...messageParts] = line.split(" ");
      const fullMessage = messageParts.join(" ");

      const boundaryIndex = fullMessage.indexOf(
        LESSON_ID_BOUNDARY
      );

      // boundaryIndex > 0 so the id is non-empty (a leading ": " is not an id).
      const lessonId =
        boundaryIndex > 0
          ? fullMessage.slice(0, boundaryIndex)
          : null;

      const message =
        boundaryIndex > 0
          ? fullMessage
              .slice(boundaryIndex + LESSON_ID_BOUNDARY.length)
              .trim()
          : fullMessage;

      return {
        sha: sha!,
        message,
        lessonId,
      };
    });
};

/**
 * Builds the lesson-commit candidate set for `branch`, in teaching order
 * (oldest -> newest).
 *
 * Lessons are exactly the commits in `upstream/main..branch` — the lesson
 * stack. Scoping to that range structurally excludes every base commit
 * (including conventional-commit-shaped ones like `chore: ...` that live on
 * main) regardless of message shape, so no denylist or slug-shape heuristic is
 * needed.
 *
 * When there is no `upstream/main` to anchor on, we fall back to the branch's
 * full history: the base `initial` commit has no ": " and drops out as a
 * non-lesson anyway.
 *
 * Precondition: the `upstream` remote is live. Callers (`reset`, `cherry-pick`)
 * set it up under `withUpstreamCleanup` before calling `selectLessonCommit`,
 * which owns the remote's lifecycle — this function only reads through it. The
 * `upstream/main` fetch lands the commit objects permanently; the resolved SHA
 * outlives the ephemeral remote once the caller tears it down.
 */
const getCandidateCommits = (branch: string) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const hasUpstreamMain = yield* git
      .fetch("upstream", "main")
      .pipe(
        Effect.as(true),
        Effect.catchTag("FailedToFetchError", () =>
          Effect.succeed(false)
        )
      );

    const range = hasUpstreamMain
      ? `upstream/main..${branch}`
      : branch;

    const history = yield* git.getLogOnelineReverse(range);

    return parseCommits(history);
  });

export const selectLessonCommit = ({
  branch,
  excludeCurrentBranch,
  extraChoices,
  lessonId,
  promptMessage,
}: {
  branch: string;
  lessonId: Option.Option<string>;
  promptMessage: string;
  excludeCurrentBranch: boolean;
  extraChoices?: Array<{ lessonId: string; message: string }>;
}) =>
  Effect.gen(function* () {
    const gitService = yield* GitService;
    const promptService = yield* PromptService;

    // Candidate lessons, scoped to the lesson stack, in teaching order.
    let commits: Array<ParsedCommit> =
      yield* getCandidateCommits(branch);

    if (excludeCurrentBranch) {
      // Extract lesson ids already applied on the current branch and drop them
      // from the candidate set. Scanning HEAD's full history is fine — a stray
      // non-lesson prefix there simply matches no candidate.
      const currentBranchHistory =
        yield* gitService.getLogOneline("HEAD");
      const currentBranchCommits = parseCommits(
        currentBranchHistory
      );

      const currentLessonIds = new Set(
        currentBranchCommits
          .filter((c) => c.lessonId !== null)
          .map((c) => c.lessonId!)
      );

      commits = commits.filter(
        (c) => !c.lessonId || !currentLessonIds.has(c.lessonId)
      );
    }

    // Get selected lesson ID
    let selectedLessonId: string;

    if (Option.isSome(lessonId)) {
      // Normalize numeric input (e.g. "1.1.1" -> "01.01.01"); slugs pass through.
      const normalized = normalizeLessonId(lessonId.value);
      selectedLessonId = normalized ?? lessonId.value;
      yield* Console.log(
        `Searching for lesson ${selectedLessonId} on branch ${branch}...`
      );
    } else {
      // Filter to only commits with lesson IDs
      const commitsWithLessonIds = commits.filter(
        (commit) => commit.lessonId !== null
      );

      if (commitsWithLessonIds.length === 0) {
        return yield* Effect.fail(
          new CommitNotFoundError({
            lessonId: "any",
            branch,
          })
        );
      }

      // Teaching order is commit order (oldest -> newest), carried by the stack
      // itself — no sort. Slugs deliberately carry no ordinal.
      const choices = [
        ...(extraChoices ?? []),
        ...commitsWithLessonIds.map((commit) => ({
          lessonId: commit.lessonId!,
          message: commit.message,
        })),
      ];

      // Prompt user to select a commit
      selectedLessonId = yield* promptService.selectLessonCommit(
        choices,
        promptMessage
      );
    }

    // Check if an extra choice was selected (not a real commit)
    const isExtraChoice = extraChoices?.some(
      (c) => c.lessonId === selectedLessonId
    );
    if (isExtraChoice) {
      return {
        commit: { sha: "", message: "", lessonId: null },
        lessonId: selectedLessonId,
      };
    }

    const matchingCommits = commits.filter(
      (commit) => commit.lessonId === selectedLessonId
    );

    if (matchingCommits.length === 0) {
      return yield* new CommitNotFoundError({
        lessonId: selectedLessonId,
        branch,
      });
    }

    // Latest wins: candidates are oldest -> newest, so the last match is the
    // newest commit carrying this id (duplicate slugs are a maintainer trap).
    const targetCommit =
      matchingCommits[matchingCommits.length - 1]!;

    yield* Console.log(
      `Found commit: ${targetCommit.sha} ${targetCommit.message}`
    );

    return {
      commit: targetCommit,
      lessonId: selectedLessonId,
    };
  });
