import { Command } from "@effect/platform";
import { Console, Data, Effect, Option } from "effect";
import prompt from "prompts";
import { runPrompt } from "./prompt-utils.js";

export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  lessonId: string;
  branch: string;
}> {}

export class NoParentCommitError extends Data.TaggedError(
  "NoParentCommitError"
)<{
  commitSha: string;
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
  cwd,
  excludeCurrentBranch,
  lessonId,
  promptMessage,
}: {
  cwd: string;
  branch: string;
  lessonId: Option.Option<string>;
  promptMessage: string;
  excludeCurrentBranch: boolean;
}) =>
  Effect.gen(function* () {
    // Search commit history for lesson ID
    const gitLogArgs = excludeCurrentBranch
      ? ["log", branch, "--not", "HEAD", "--oneline"]
      : ["log", branch, "--oneline"];

    const gitLogCommand = Command.make(
      "git",
      ...gitLogArgs
    ).pipe(Command.workingDirectory(cwd));

    const commitHistory = yield* Command.string(gitLogCommand);

    const commits = parseCommits(commitHistory);

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
export const getParentCommit = ({
  commitSha,
  cwd,
}: {
  commitSha: string;
  cwd: string;
}) =>
  Effect.gen(function* () {
    const gitRevParseCommand = Command.make(
      "git",
      "rev-parse",
      `${commitSha}^`
    ).pipe(Command.workingDirectory(cwd));

    const parentSha = yield* Command.string(
      gitRevParseCommand
    ).pipe(
      Effect.mapError(() => new NoParentCommitError({ commitSha }))
    );

    return parentSha.trim();
  });
