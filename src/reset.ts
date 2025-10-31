import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import prompt from "prompts";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
  message: string;
}> {}

export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  lessonId: string;
  branch: string;
}> {}

export class PromptCancelledError extends Data.TaggedError(
  "PromptCancelledError"
) {}

const runPrompt = <T>(promptFn: () => Promise<T>) => {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => promptFn());

    if (!result) {
      return yield* new PromptCancelledError();
    }

    return result;
  });
};

export const reset = CLICommand.make(
  "reset",
  {
    lessonId: Args.text({ name: "lesson-id" }),
    branch: Options.text("branch").pipe(
      Options.withDescription(
        "Branch to search for the lesson commit"
      )
    ),
  },
  ({ branch, lessonId }) =>
    Effect.gen(function* () {
      const cwd = process.cwd();

      // Validate git repository
      const gitDirPath = path.join(cwd, ".git");
      if (!existsSync(gitDirPath)) {
        return yield* Effect.fail(
          new NotAGitRepoError({
            path: cwd,
            message: `Current directory is not a git repository: ${cwd}`,
          })
        );
      }

      yield* Console.log(
        `Searching for lesson ${lessonId} on branch ${branch}...`
      );

      // Search commit history for lesson ID
      const gitLogCommand = Command.make(
        "git",
        "log",
        branch,
        "--oneline",
        "--all"
      ).pipe(Command.workingDirectory(cwd));

      const commitHistory = yield* Command.string(gitLogCommand);

      // Parse commits to find matching lesson ID
      type ParsedCommit = {
        sha: string;
        message: string;
        lessonId: string | null;
      };

      const commits: Array<ParsedCommit> = commitHistory
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, ...messageParts] = line.split(" ");
          const message = messageParts.join(" ");

          // Extract lesson ID - match pattern like 01.01.01, 1.1.1, etc.
          const lessonMatch = message.match(
            /^(\d+)[.-](\d+)[.-](\d+) /
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

          return {
            sha: sha!,
            message,
            lessonId: extractedLessonId,
          };
        });

      const matchingCommits = commits.filter(
        (commit) => commit.lessonId === lessonId
      );

      if (matchingCommits.length === 0) {
        return yield* new CommitNotFoundError({
          lessonId,
          branch,
        });
      }

      // If multiple commits found, choose the latest one (last in the list)
      const targetCommit = matchingCommits[matchingCommits.length - 1]!;

      yield* Console.log(
        `Found commit: ${targetCommit.sha} ${targetCommit.message}`
      );

      // Prompt for action
      const { action } = yield* runPrompt<{
        action: "reset-current" | "create-branch";
      }>(() =>
        prompt([
          {
            type: "select",
            name: "action",
            message: "How would you like to proceed?",
            choices: [
              {
                title: "Reset current branch",
                value: "reset-current",
              },
              {
                title: "Create new branch from commit",
                value: "create-branch",
              },
            ],
          },
        ])
      );

      if (action === "create-branch") {
        const { branchName } = yield* runPrompt<{
          branchName: string;
        }>(() =>
          prompt([
            {
              type: "text",
              name: "branchName",
              message: "Enter new branch name:",
            },
          ])
        );

        yield* Console.log(
          `Creating branch ${branchName} from ${targetCommit.sha}...`
        );

        const createBranchCommand = Command.make(
          "git",
          "checkout",
          "-b",
          branchName,
          targetCommit.sha
        ).pipe(Command.workingDirectory(cwd));

        const exitCode = yield* Command.exitCode(
          createBranchCommand
        ).pipe(Effect.catchAll(() => Effect.succeed(1)));

        if (exitCode !== 0) {
          yield* Console.error("Failed to create branch");
          process.exitCode = 1;
          return;
        }

        yield* Console.log(
          `✓ Created and checked out branch: ${branchName}`
        );
        return;
      }

      // Reset current branch - check for unstaged changes
      const gitStatusCommand = Command.make(
        "git",
        "status",
        "--porcelain"
      ).pipe(Command.workingDirectory(cwd));

      const statusOutput = yield* Command.string(
        gitStatusCommand
      );

      if (statusOutput.trim() !== "") {
        yield* Console.log(
          "\nWarning: You have uncommitted changes:"
        );
        yield* Console.log(statusOutput);

        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
          prompt([
            {
              type: "confirm",
              name: "confirm",
              message:
                "This will lose all uncommitted work. Continue?",
              initial: false,
            },
          ])
        );

        if (!confirm) {
          yield* Console.log("Reset cancelled");
          return;
        }
      }

      // Reset to target commit
      yield* Console.log(`Resetting to ${targetCommit.sha}...`);

      const resetCommand = Command.make(
        "git",
        "reset",
        "--hard",
        targetCommit.sha
      ).pipe(Command.workingDirectory(cwd));

      const exitCode = yield* Command.exitCode(
        resetCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (exitCode !== 0) {
        yield* Console.error("Failed to reset");
        process.exitCode = 1;
        return;
      }

      yield* Console.log(`✓ Reset to lesson ${lessonId}`);
    }).pipe(
      Effect.catchTags({
        NotAGitRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        CommitNotFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: No commit found for lesson ${error.lessonId} on branch ${error.branch}`
            );
            process.exitCode = 1;
          });
        },
        PromptCancelledError: () => {
          return Effect.gen(function* () {
            yield* Console.log("Operation cancelled");
            process.exitCode = 0;
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
).pipe(
  CLICommand.withDescription("Reset to a specific lesson commit")
);
