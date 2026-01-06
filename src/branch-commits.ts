import { Data, Effect } from "effect";
import { GitService } from "./git-service.js";
import { PromptService } from "./prompt-service.js";

export interface BranchCommit {
  sha: string;
  message: string;
  sequence: number; // 1-based
}

export class NoCommitsFoundError extends Data.TaggedError(
  "NoCommitsFoundError"
)<{
  mainBranch: string;
  liveBranch: string;
}> {}

/**
 * Gets all commits between mainBranch and liveBranch.
 * Returns commits in chronological order (oldest first) with 1-based sequence numbers.
 */
export const getCommitsBetweenBranches = (opts: {
  mainBranch: string;
  liveBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;

    const commitHistory = yield* git.getLogOnelineReverse(
      `${opts.mainBranch}..${opts.liveBranch}`
    );

    const commits: Array<BranchCommit> = commitHistory
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const [sha, ...messageParts] = line.split(" ");
        const message = messageParts.join(" ");

        return {
          sha: sha!,
          message,
          sequence: index + 1,
        };
      });

    if (commits.length === 0) {
      return yield* Effect.fail(
        new NoCommitsFoundError({
          mainBranch: opts.mainBranch,
          liveBranch: opts.liveBranch,
        })
      );
    }

    return commits;
  });

/**
 * Prompts user to select a commit from a list.
 * Displays sequence number and message for each commit.
 */
export const selectCommit = (opts: {
  commits: Array<BranchCommit>;
  promptMessage: string;
}) =>
  Effect.gen(function* () {
    const promptService = yield* PromptService;

    // Format commits for display: "01.01 - message"
    const formattedCommits = opts.commits.map((commit) => ({
      lessonId: commit.sequence.toString().padStart(2, "0"),
      message: commit.message,
    }));

    const selectedId = yield* promptService.selectLessonCommit(
      formattedCommits,
      opts.promptMessage
    );

    // Find the commit by sequence number
    const selectedSequence = parseInt(selectedId, 10);
    const selectedCommit = opts.commits.find(
      (c) => c.sequence === selectedSequence
    );

    if (!selectedCommit) {
      // Fallback to first match if parsing failed
      return opts.commits[0]!;
    }

    return selectedCommit;
  });
