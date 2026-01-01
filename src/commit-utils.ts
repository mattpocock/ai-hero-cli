import { Console, Data, Effect, Option } from "effect";
import prompt from "prompts";
import { GitService, NoParentCommitError } from "./git-service.js";
import { runPrompt } from "./prompt-utils.js";

export { NoParentCommitError };

export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  lessonId: string;
  branch: string;
}> {}

type ParsedCommit = {
  /** Short commit SHA */
  sha: string;
  /** Commit message with lesson ID prefix removed (e.g., "Add new feature" from "01.01.01 Add new feature") */
  message: string;
  /** Normalized lesson ID (e.g., "01.01.01") extracted from commit message, or null if no lesson ID found */
  lessonId: string | null;
};

const parseCommits = (
  commitHistory: string
): Array<ParsedCommit> => {
  return commitHistory
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ...messageParts] = line.split(" ");
      const fullMessage = messageParts.join(" ");

      // Extract lesson ID - match pattern like 01.01.01, 1.1.1, etc.
      const lessonMatch = fullMessage.match(
        /^(\d+)[.-](\d+)[.-](\d+)\s*/
      );
      const extractedLessonId = lessonMatch
        ? `${lessonMatch[1]!.padStart(
            2,
            "0"
          )}.${lessonMatch[2]!.padStart(
            2,
            "0"
          )}.${lessonMatch[3]!.padStart(2, "0")}`
        : null;

      // Remove lesson ID prefix from message
      const message = lessonMatch
        ? fullMessage.slice(lessonMatch[0].length).trim()
        : fullMessage;

      return {
        sha: sha!,
        message,
        lessonId: extractedLessonId,
      };
    });
};

export const selectLessonCommit = ({
  branch,
  excludeCurrentBranch,
  lessonId,
  promptMessage,
}: {
  branch: string;
  lessonId: Option.Option<string>;
  promptMessage: string;
  excludeCurrentBranch: boolean;
}) =>
  Effect.gen(function* () {
    const gitService = yield* GitService;

    // Search commit history for lesson ID
    let commits: Array<ParsedCommit>;

    if (excludeCurrentBranch) {
      // Get commits from current branch to extract lesson IDs
      const currentBranchHistory = yield* gitService.getLogOneline("HEAD");
      const currentBranchCommits = parseCommits(currentBranchHistory);

      // Extract lesson IDs from current branch (only commits with lesson IDs)
      const currentLessonIds = new Set(
        currentBranchCommits
          .filter((c) => c.lessonId !== null)
          .map((c) => c.lessonId!)
      );

      // Get commits from target branch
      const targetBranchHistory = yield* gitService.getLogOneline(branch);
      const allTargetCommits = parseCommits(targetBranchHistory);

      // Filter out commits with lesson IDs that exist on current branch
      commits = allTargetCommits.filter(
        (c) => !c.lessonId || !currentLessonIds.has(c.lessonId)
      );
    } else {
      const commitHistory = yield* gitService.getLogOneline(branch);

      commits = parseCommits(commitHistory);
    }

    // Get selected lesson ID
    let selectedLessonId: string;

    if (Option.isSome(lessonId)) {
      selectedLessonId = lessonId.value;
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

      // Sort commits by lesson ID ascending
      const sortedCommits = commitsWithLessonIds.sort((a, b) => {
        return a.lessonId!.localeCompare(b.lessonId!);
      });

      // Prompt user to select a commit
      const { lesson } = yield* runPrompt<{
        lesson: string;
      }>(() =>
        prompt([
          {
            type: "autocomplete",
            name: "lesson",
            message: promptMessage,
            choices: sortedCommits.map((commit) => ({
              title: commit.lessonId!,
              value: commit.lessonId!,
              description: commit.message,
            })),
            suggest: async (input, choices) => {
              return choices.filter((choice) => {
                const searchText = `${choice.title} ${choice.description}`;
                return searchText
                  .toLowerCase()
                  .includes(input.toLowerCase());
              });
            },
          },
        ])
      );

      selectedLessonId = lesson;
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

    // If multiple commits found, choose the latest one (last in the list)
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

/**
 * Get the parent commit of a given commit SHA.
 * Throws NoParentCommitError if the commit has no parent.
 */
export const getParentCommit = ({ commitSha }: { commitSha: string }) =>
  Effect.gen(function* () {
    const gitService = yield* GitService;
    return yield* gitService.getParentCommit(commitSha);
  });
