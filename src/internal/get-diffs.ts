import { Command as CLICommand, Options } from "@effect/cli";
import { Command, FileSystem } from "@effect/platform";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  LessonParserService,
  type Lesson,
} from "../lesson-parser-service.js";

export class InvalidProjectRepoError extends Data.TaggedError(
  "InvalidProjectRepoError"
)<{
  path: string;
  message: string;
}> {}

export class MissingExerciseFolderError extends Data.TaggedError(
  "MissingExerciseFolderError"
)<{
  exerciseId: string;
  folderType: "explainer" | "solution";
  path: string;
}> {}

export class DiffGenerationError extends Data.TaggedError(
  "DiffGenerationError"
)<{
  commit: string;
  message: string;
  cause?: unknown;
}> {}

export class DirtyWorkingTreeError extends Data.TaggedError(
  "DirtyWorkingTreeError"
)<{
  path: string;
  message: string;
}> {}

export class NoExerciseFoundError extends Data.TaggedError(
  "NoExerciseFoundError"
)<{
  exerciseId: string;
  commitSha: string;
}> {}

export const getDiffs = CLICommand.make(
  "get-diffs",
  {
    projectRepo: Options.text("project-repo").pipe(
      Options.withDescription(
        "The path to the project repository"
      )
    ),
    branch: Options.text("branch").pipe(
      Options.withDescription("Branch to get diffs from")
    ),
    root: Options.text("root").pipe(
      Options.withDescription(
        "The root directory of the exercises"
      ),
      Options.withDefault(path.join(process.cwd(), "exercises"))
    ),
  },
  ({ branch, projectRepo, root }) =>
    Effect.gen(function* () {
      yield* Console.log("Starting get-diffs command...");

      // Validate project repo exists
      if (!existsSync(projectRepo)) {
        return yield* Effect.fail(
          new InvalidProjectRepoError({
            path: projectRepo,
            message: `Project repo does not exist at path: ${projectRepo}`,
          })
        );
      }

      // Validate project repo is a git repository
      const gitDirPath = path.join(projectRepo, ".git");
      if (!existsSync(gitDirPath)) {
        return yield* Effect.fail(
          new InvalidProjectRepoError({
            path: projectRepo,
            message: `Project repo is not a git repository: ${projectRepo}`,
          })
        );
      }

      // Fetch latest from origin
      yield* Console.log("Fetching latest from origin...");
      const gitFetchCommand = Command.make(
        "git",
        "fetch",
        "origin"
      ).pipe(Command.workingDirectory(projectRepo));

      const fetchExitCode = yield* Command.exitCode(
        gitFetchCommand
      ).pipe(Effect.catchAll(() => Effect.succeed(1)));

      if (fetchExitCode !== 0) {
        return yield* Effect.fail(
          new InvalidProjectRepoError({
            path: projectRepo,
            message: `Failed to fetch from origin`,
          })
        );
      }

      yield* Console.log(`✓ Fetched latest from origin`);
      yield* Console.log(
        `✓ Validated project repo: ${projectRepo}`
      );
      yield* Console.log(`✓ Exercises root: ${root}`);

      // Phase 2: Retrieve commit history
      yield* Console.log("\nRetrieving commit history...");

      const gitLogCommand = Command.make(
        "git",
        "log",
        "--oneline",
        "--reverse", // Chronological order (oldest first)
        branch
      ).pipe(Command.workingDirectory(projectRepo));

      const commitHistory = yield* Command.string(gitLogCommand);

      // Parse commits: format is "SHA message"
      type ParsedCommit = {
        sha: string;
        message: string;
        exerciseId: string | null;
      };

      const commits: Array<ParsedCommit> = commitHistory
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, ...messageParts] = line.split(" ");
          const message = messageParts.join(" ");

          // Extract exercise ID with flexible matching
          // Match patterns: 02.02, 2.2, 02-02, 2-2
          const exerciseMatch = message.match(/^(\d+)[.-](\d+)/);
          const exerciseId = exerciseMatch
            ? `${exerciseMatch[1].padStart(
                2,
                "0"
              )}.${exerciseMatch[2].padStart(2, "0")}`
            : null;

          return {
            sha: sha!,
            message,
            exerciseId,
          };
        });

      yield* Console.dir(commits, { depth: Infinity });

      const commitsWithExercise = commits.filter(
        (commit) => commit.exerciseId !== null
      );

      yield* Console.log(
        `✓ Found ${commits.length} total commits`
      );
      yield* Console.log(
        `✓ Found ${commitsWithExercise.length} commits matching exercise format`
      );

      // Phase 3: Match commits to exercises
      yield* Console.log("\nMatching commits to exercises...");

      const lessonParser = yield* LessonParserService;
      const lessons = yield* lessonParser.getLessonsFromRepo(
        root
      );

      // Create exercise ID map for quick lookup
      // Format: "02.02" -> Lesson object
      const exerciseMap = new Map<string, Lesson>();
      for (const lesson of lessons) {
        const id = lesson.path.split("-")[0]!;

        exerciseMap.set(id, lesson);
      }

      // Group commits by exercise
      type ExerciseCommits = {
        lesson: Lesson;
        commits: Array<ParsedCommit>;
      };

      const exerciseCommitsMap = new Map<
        string,
        ExerciseCommits
      >();

      for (const commit of commitsWithExercise) {
        const exerciseId = commit.exerciseId!;
        const lesson = exerciseMap.get(exerciseId);

        if (!lesson) {
          return yield* Effect.fail(
            new NoExerciseFoundError({
              exerciseId,
              commitSha: commit.sha,
            })
          );
        }

        if (!exerciseCommitsMap.has(exerciseId)) {
          exerciseCommitsMap.set(exerciseId, {
            lesson,
            commits: [],
          });
        }

        exerciseCommitsMap.get(exerciseId)!.commits.push(commit);
      }

      yield* Console.log(
        `✓ Matched commits to ${exerciseCommitsMap.size} exercises`
      );

      // Phase 4: Generate and save diffs
      yield* Console.log("\nGenerating and saving diffs...");

      const fs = yield* FileSystem.FileSystem;
      let processedCount = 0;
      let savedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors: Array<string> = [];

      // Helper to convert description to dash-case
      const toDashCase = (str: string): string => {
        return str
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      };

      for (const [
        exerciseId,
        { commits, lesson },
      ] of exerciseCommitsMap) {
        yield* Console.log(
          `  Processing ${commits.length} commits for ${exerciseId}...`
        );

        for (const commit of commits) {
          processedCount++;

          // Wrap each commit processing in error handling
          const result = yield* Effect.gen(function* () {
            // Get diff using git show
            const gitShowCommand = Command.make(
              "git",
              "show",
              "-W",
              commit.sha,
              "--",
              ".",
              ":!pnpm-lock.yaml",
              ":!package-lock.json",
              ":!yarn.lock",
              ":!*.lock"
            ).pipe(Command.workingDirectory(projectRepo));

            const diff = yield* Command.string(gitShowCommand);

            // Parse commit message: "02.02.01 Description" or "02.02-01 Description"
            // Extract sequence number and description
            const messageMatch = commit.message.match(
              /^\d+[.-]\d+[.-](\d+)\s+(.+)$/
            );

            if (!messageMatch) {
              yield* Console.log(
                `    ⊘ Skipped: Could not parse commit message: ${commit.message}`
              );
              return { status: "skipped" as const };
            }

            const [, sequenceStr, description] = messageMatch;
            const sequence = sequenceStr!.padStart(2, "0");

            // Determine target folder (explainer or solution)
            // Check if description starts with common solution indicators
            const isSolution =
              /^(solution|fix|complete|final)/i.test(
                description!
              );
            const targetSubFolder = isSolution
              ? "solution"
              : "explainer";

            // Determine target directory
            const targetDir = path.join(
              lesson.absolutePath(),
              targetSubFolder,
              "diffs"
            );

            // Check if target subfolder exists
            const exerciseFolderPath = path.join(
              lesson.absolutePath(),
              targetSubFolder
            );
            const folderExists = yield* fs.exists(
              exerciseFolderPath
            );

            if (!folderExists) {
              return yield* Effect.fail(
                new MissingExerciseFolderError({
                  exerciseId,
                  folderType: targetSubFolder,
                  path: exerciseFolderPath,
                })
              );
            }

            // Create filename
            const filename = `${sequence}-${toDashCase(
              description!
            )}.diff`;

            // Create diffs directory if it doesn't exist
            yield* fs.makeDirectory(targetDir, {
              recursive: true,
            });

            // Write diff file
            const targetPath = path.join(targetDir, filename);
            yield* fs.writeFileString(targetPath, diff);

            yield* Console.log(
              `    ✓ Saved: ${targetSubFolder}/diffs/${filename}`
            );

            return { status: "saved" as const };
          }).pipe(
            Effect.catchTags({
              MissingExerciseFolderError: (error) =>
                Effect.gen(function* () {
                  yield* Console.log(
                    `    ✗ Error: Missing ${error.folderType} folder at ${error.path}`
                  );
                  errors.push(
                    `${exerciseId}: Missing ${error.folderType} folder`
                  );
                  return { status: "error" as const };
                }),
            }),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Console.log(
                  `    ✗ Error processing commit ${commit.sha}: ${error}`
                );
                errors.push(
                  `${exerciseId} (${commit.sha}): ${error}`
                );
                return { status: "error" as const };
              })
            )
          );

          if (result.status === "saved") {
            savedCount++;
          } else if (result.status === "skipped") {
            skippedCount++;
          } else if (result.status === "error") {
            errorCount++;
          }
        }
      }

      // Phase 5: Summary
      yield* Console.log("\n" + "=".repeat(50));
      yield* Console.log("Summary:");
      yield* Console.log(
        `  Total commits processed: ${processedCount}`
      );
      yield* Console.log(`  Diffs saved: ${savedCount}`);
      yield* Console.log(`  Commits skipped: ${skippedCount}`);
      yield* Console.log(`  Errors: ${errorCount}`);
      yield* Console.log(
        `  Exercises affected: ${exerciseCommitsMap.size}`
      );

      if (errors.length > 0) {
        yield* Console.log("\nErrors encountered:");
        for (const error of errors) {
          yield* Console.log(`  - ${error}`);
        }
      }

      yield* Console.log("=".repeat(50));
    }).pipe(
      Effect.catchTags({
        InvalidProjectRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        NoExerciseFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: No exercise found for ${error.exerciseId} (commit: ${error.commitSha})`
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
    "Get commit diffs from a project repo and save to exercise folders"
  )
);
