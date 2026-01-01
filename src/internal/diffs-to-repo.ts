import { Command as CLICommand, Options } from "@effect/cli";
import { Command, FileSystem } from "@effect/platform";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../constants.js";
import { GitService, GitServiceConfig } from "../git-service.js";

export class InvalidProjectRepoError extends Data.TaggedError(
  "InvalidProjectRepoError"
)<{
  path: string;
  message: string;
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

export class NoCommitsFoundError extends Data.TaggedError(
  "NoCommitsFoundError"
)<{
  mainBranch: string;
  liveBranch: string;
}> {}

export const diffsToRepo = CLICommand.make(
  "diffs-to-repo",
  {
    projectRepo: Options.text("project-repo").pipe(
      Options.withDescription(
        "The path to the project repository"
      )
    ),
    liveBranch: Options.text("live-branch").pipe(
      Options.withDescription("Branch to get diffs from"),
      Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
    ),
    mainBranch: Options.text("main-branch").pipe(
      Options.withDescription("The main branch of the project"),
      Options.withDefault("main")
    ),
    targetDir: Options.text("target-dir").pipe(
      Options.withDescription(
        "Directory where lesson folders will be created"
      ),
      Options.withDefault(path.join(process.cwd(), "lessons"))
    ),
  },
  ({ liveBranch, mainBranch, projectRepo, targetDir }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      yield* git.ensureIsGitRepo();

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
      yield* git.fetchOrigin().pipe(
        Effect.catchTag("FailedToFetchOriginError", () =>
          Effect.fail(
            new InvalidProjectRepoError({
              path: projectRepo,
              message: `Failed to fetch from origin`,
            })
          )
        )
      );

      yield* Console.log(`✓ Fetched latest from origin`);
      yield* Console.log(
        `✓ Validated project repo: ${projectRepo}`
      );
      yield* Console.log(`✓ Target directory: ${targetDir}`);

      // Phase 2: Retrieve commit history
      yield* Console.log("\nRetrieving commit history...");

      const commitHistory = yield* git.getLogOnelineReverse(
        `${mainBranch}..${liveBranch}`
      );

      // Parse commits: format is "SHA message"
      type ParsedCommit = {
        sha: string;
        message: string;
        sequence: number; // 1-based sequence
      };

      const commits: Array<ParsedCommit> = commitHistory
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line, index) => {
          const [sha, ...messageParts] = line.split(" ");
          const message = messageParts.join(" ");

          return {
            sha: sha!,
            message,
            sequence: index + 1, // 1-based sequence
          };
        });

      if (commits.length === 0) {
        return yield* Effect.fail(
          new NoCommitsFoundError({ mainBranch, liveBranch })
        );
      }

      yield* Console.dir(commits, { depth: Infinity });
      yield* Console.log(
        `✓ Found ${commits.length} commits to process`
      );

      // Phase 3: Generate and save diffs
      yield* Console.log("\nGenerating and saving diffs...");

      const fs = yield* FileSystem.FileSystem;
      let savedCount = 0;
      let errorCount = 0;
      const errors: Array<string> = [];

      // Helper to convert description to dash-case
      const toDashCase = (str: string): string => {
        return str
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      };

      // Create section directory
      const sectionDir = path.join(
        targetDir,
        "01-first-section"
      );
      yield* fs.makeDirectory(sectionDir, { recursive: true });

      for (const commit of commits) {
        const result = yield* Effect.gen(function* () {
          // Generate diff
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

          // Create lesson folder name
          const lessonNumber = `01.${commit.sequence
            .toString()
            .padStart(2, "0")}`;
          const lessonName = toDashCase(commit.message);
          const lessonFolderName = `${lessonNumber}-${lessonName}`;

          // Create directory structure
          const lessonPath = path.join(
            sectionDir,
            lessonFolderName
          );
          const explainerPath = path.join(
            lessonPath,
            "explainer"
          );

          yield* fs.makeDirectory(explainerPath, {
            recursive: true,
          });

          // Write diff file
          const diffPath = path.join(
            explainerPath,
            "solution.diff"
          );
          yield* fs.writeFileString(diffPath, diff);

          yield* Console.log(
            `  ✓ Created: 01-first-section/${lessonFolderName}/explainer/solution.diff`
          );

          return { status: "saved" as const };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Console.log(
                `  ✗ Error processing commit ${commit.sha}: ${error}`
              );
              errors.push(`${commit.sha}: ${error}`);
              return { status: "error" as const };
            })
          )
        );

        if (result.status === "saved") {
          savedCount++;
        } else if (result.status === "error") {
          errorCount++;
        }
      }

      // Summary
      yield* Console.log("\n" + "=".repeat(50));
      yield* Console.log("Summary:");
      yield* Console.log(
        `  Total commits processed: ${commits.length}`
      );
      yield* Console.log(`  Lessons created: ${savedCount}`);
      yield* Console.log(`  Errors: ${errorCount}`);
      yield* Console.log(`  Target directory: ${targetDir}`);

      if (errors.length > 0) {
        yield* Console.log("\nErrors encountered:");
        for (const error of errors) {
          yield* Console.log(`  - ${error}`);
        }
      }

      yield* Console.log("=".repeat(50));
    }).pipe(
      Effect.provideService(
        GitServiceConfig,
        GitServiceConfig.of({
          cwd: projectRepo,
        })
      ),
      Effect.catchTags({
        InvalidProjectRepoError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          });
        },
        NoCommitsFoundError: (error) => {
          return Effect.gen(function* () {
            yield* Console.error(
              `Error: No commits found on ${error.liveBranch} beyond ${error.mainBranch}`
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
    "Generate sequential lesson folders from commits on live branch"
  )
);
