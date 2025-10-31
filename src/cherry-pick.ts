import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";

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

export const cherryPick = CLICommand.make(
  "cherry-pick",
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

      const gitFetchCommand = Command.make(
        "git",
        "fetch",
        "origin"
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const fetchExitCode = yield* Command.exitCode(
        gitFetchCommand
      );

      if (fetchExitCode !== 0) {
        yield* Console.error("Failed to fetch branch");
        process.exitCode = 1;
        return;
      }

      // Search commit history for lesson ID
      const gitLogCommand = Command.make(
        "git",
        "log",
        branch,
        "--oneline"
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
            /^(\d+)[.-](\d+)[.-](\d+)/
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
      const targetCommit =
        matchingCommits[matchingCommits.length - 1]!;

      yield* Console.log(
        `Found commit: ${targetCommit.sha} ${targetCommit.message}`
      );
      yield* Console.log(
        `Cherry-picking ${targetCommit.sha} onto current branch...\n`
      );

      // Execute git cherry-pick with inherited stdio
      const cherryPickCommand = Command.make(
        "git",
        "cherry-pick",
        targetCommit.sha
      ).pipe(
        Command.workingDirectory(cwd),
        Command.stdout("inherit"),
        Command.stderr("inherit"),
        Command.stdin("inherit")
      );

      const exitCode = yield* Command.exitCode(
        cherryPickCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (exitCode !== 0) {
        process.exitCode = 1;
        return;
      }

      yield* Console.log(
        `\n✓ Successfully cherry-picked lesson ${lessonId}`
      );
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
      }),
      Effect.catchAll((error) => {
        return Effect.gen(function* () {
          yield* Console.error(`Unexpected error: ${error}`);
          process.exitCode = 1;
        });
      })
    )
).pipe(
  CLICommand.withDescription(
    "Cherry-pick a specific lesson commit onto current branch"
  )
);
