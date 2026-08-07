import { Data, Effect } from "effect";
import {
  normalizeLessonId,
  splitLessonId,
} from "./commit-utils.js";
import { GitService } from "./git-service.js";
import { PromptService } from "./prompt-service.js";

export interface BranchCommit {
  sha: string;
  /** The untouched commit subject — what we re-author the commit with. */
  message: string;
  /** Lesson id: the token before the first ": ", or null for non-lessons. */
  lessonId: string | null;
  /** The subject with the lesson-id prefix stripped, for display. */
  description: string;
  /** 1-based position in teaching order. Ordering only — never identity. */
  sequence: number;
  /**
   * True when the commit changes no files — a lesson placeholder that carries
   * no content yet. Surfaced in the picker so you can tell, before editing or
   * deleting, whether there is anything in there.
   */
  isEmpty: boolean;
}

export class NoCommitsFoundError extends Data.TaggedError(
  "NoCommitsFoundError"
)<{
  mainBranch: string;
  liveBranch: string;
}> {}

export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  commit: string;
}> {}

/**
 * Gets all commits between mainBranch and liveBranch, in teaching order
 * (oldest first), decomposed with the shared lesson-id parser.
 *
 * `sequence` is retained because the cherry-pick range needs to know how many
 * commits follow the target — it is *not* an identifier. Lessons are named by
 * their slug (see `lessonId`).
 */
export const getCommitsBetweenBranches = (opts: {
  mainBranch: string;
  liveBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const range = `${opts.mainBranch}..${opts.liveBranch}`;

    const commitHistory = yield* git.getLogOnelineReverse(range);

    const subjects = commitHistory
      .trim()
      .split("\n")
      .filter(Boolean);

    if (subjects.length === 0) {
      return yield* Effect.fail(
        new NoCommitsFoundError({
          mainBranch: opts.mainBranch,
          liveBranch: opts.liveBranch,
        })
      );
    }

    // Asked for only once there is something to describe, so an empty stack
    // still costs one git read.
    const emptyShas = new Set(
      yield* git.getEmptyCommitShas(range)
    );

    const commits: Array<BranchCommit> = subjects.map(
      (line, index) => {
        const [sha, ...messageParts] = line.split(" ");
        const message = messageParts.join(" ");
        const { description, lessonId } =
          splitLessonId(message);

        return {
          sha: sha!,
          message,
          lessonId,
          description,
          sequence: index + 1,
          isEmpty: emptyShas.has(sha!),
        };
      }
    );

    return commits;
  });

/**
 * Resolves a user-supplied reference to one of `commits`.
 *
 * A reference is a lesson id — a slug (`add-settings-json`) or a numeric id
 * (`6.6.1`, normalised to `06.06.01`) — or a SHA prefix. Lesson ids are tried
 * first so a slug that happens to look like hex can't be shadowed. Duplicate
 * ids resolve to the latest commit carrying them, matching `reset` and
 * `cherry-pick`.
 */
export const resolveCommitRef = (
  commits: Array<BranchCommit>,
  ref: string
) => {
  const normalized = normalizeLessonId(ref) ?? ref;

  const byLessonId = commits.filter(
    (commit) => commit.lessonId === normalized
  );
  if (byLessonId.length > 0) {
    // Latest wins: commits are oldest -> newest.
    return byLessonId[byLessonId.length - 1]!;
  }

  return commits.find((commit) => commit.sha.startsWith(ref));
};

/**
 * Prompts the user to pick a lesson commit, listed by lesson id in teaching
 * order. Commits with no lesson id are not selectable — they aren't lessons.
 */
/* v8 ignore start - UI prompt wrapper */
export const selectCommit = (opts: {
  commits: Array<BranchCommit>;
  promptMessage: string;
}) =>
  Effect.gen(function* () {
    const promptService = yield* PromptService;

    const lessons = opts.commits.filter(
      (commit) => commit.lessonId !== null
    );

    if (lessons.length === 0) {
      return yield* new CommitNotFoundError({ commit: "any" });
    }

    const selectedId = yield* promptService.selectLessonCommit(
      lessons.map((commit) => ({
        lessonId: commit.lessonId!,
        message: commit.description,
        isEmpty: commit.isEmpty,
      })),
      opts.promptMessage
    );

    const selected = resolveCommitRef(lessons, selectedId);

    // The picker can only return an id we offered, so a miss means the list
    // and the resolver disagree — fail loudly rather than edit a commit the
    // user didn't choose.
    if (!selected) {
      return yield* new CommitNotFoundError({
        commit: selectedId,
      });
    }

    return selected;
  });
/* v8 ignore stop */
