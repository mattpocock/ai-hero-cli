import { Command as CLICommand } from "@effect/cli";
import { Console, Effect, Cache, Duration } from "effect";
import type { Lesson } from "../lesson-parser-service.js";
import { LessonParserService } from "../lesson-parser-service.js";
import { cwdOption, rootOption } from "../options.js";
import { styleText } from "util";
import * as path from "path";
import { FileSystem } from "@effect/platform";

const createErrorTracker = () => {
  const groupedErrors: {
    [section: string]: {
      [exercise: string]: Array<string>;
    };
  } = {};

  return {
    addError: (lesson: Lesson, error: string) => {
      if (!groupedErrors[lesson.sectionPath]) {
        groupedErrors[lesson.sectionPath] = {};
      }
      if (!groupedErrors[lesson.sectionPath][lesson.path]) {
        groupedErrors[lesson.sectionPath][lesson.path] = [];
      }
      groupedErrors[lesson.sectionPath][lesson.path].push(error);
    },
    log: Effect.gen(function* () {
      for (const [section, exercises] of Object.entries(
        groupedErrors
      )) {
        yield* Console.log(styleText(["bold"], section));

        for (const [exercise, errors] of Object.entries(
          exercises
        )) {
          yield* Console.log(`  ${exercise}`);

          for (const error of errors) {
            yield* Console.log(
              styleText(["red"], `    ${error}`)
            );
          }
        }
      }

      if (Object.keys(groupedErrors).length > 0) {
        process.exitCode = 1;
      }
    }),
  };
};

export const lint = CLICommand.make(
  "lint",
  {
    root: rootOption,
    cwd: cwdOption,
  },
  Effect.fn("lint")(
    function* ({ cwd, root }) {
      const existsCache = yield* Cache.make({
        capacity: 10_000,
        timeToLive: Duration.infinity,
        lookup: (key: string) =>
          Effect.gen(function* () {
            const exists = yield* fs.exists(key);
            return exists;
          }),
      });

      const errorTracker = createErrorTracker();
      const lessonParser = yield* LessonParserService;
      const fs = yield* FileSystem.FileSystem;

      const lessons = yield* lessonParser.getLessonsFromRepo(
        root
      );

      for (const lesson of lessons) {
        const subfolders = yield* lesson.subfolders();

        if (subfolders.length === 0) {
          errorTracker.addError(
            lesson,
            "No subfolders, like problem or solution, found in the exercise."
          );
          continue;
        }

        const folderForReadme = subfolders.find(
          (folder) =>
            folder === "problem" ||
            folder === "explainer" ||
            folder === "explainer.1"
        );

        if (!folderForReadme) {
          errorTracker.addError(
            lesson,
            "No problem, explainer, or explainer.1 folder found in the exercise."
          );
          continue;
        }

        const readmePath = path.join(
          lesson.absolutePath(),
          folderForReadme,
          "readme.md"
        );

        const readmeExists = yield* existsCache.get(readmePath);

        if (!readmeExists) {
          errorTracker.addError(
            lesson,
            "readme.md file not found in the exercise."
          );
        } else {
          const readmeContent = yield* fs.readFileString(
            readmePath
          );

          if (readmeContent.trim().length === 0) {
            errorTracker.addError(
              lesson,
              "readme.md file is empty"
            );
            continue;
          }

          const links =
            readmeContent.match(/\[[^\]]+\]\(\/[^)]+\)/gm) ?? [];

          for (const link of links) {
            const splitResult = link.split("](");
            const url = splitResult[1]?.slice(1, -1);

            if (!url) continue;

            const linkExists = yield* existsCache.get(
              path.join(cwd, url)
            );

            if (!linkExists) {
              errorTracker.addError(
                lesson,
                `Broken link in readme.md: ${url}`
              );
            }
          }
        }

        for (const subfolder of subfolders) {
          const mainFilePath = path.join(
            lesson.absolutePath(),
            subfolder,
            "main.ts"
          );

          const mainFileExists = yield* existsCache.get(
            mainFilePath
          );

          if (!mainFileExists) {
            errorTracker.addError(
              lesson,
              `main.ts file not found in the ${subfolder} folder.`
            );
          }
        }

        const files = yield* lesson.allFiles();

        if (files.some((file) => file.includes(".gitkeep"))) {
          errorTracker.addError(
            lesson,
            ".gitkeep file found in the exercise."
          );
        }
      }

      yield* errorTracker.log;
    },
    Effect.catchTags({
      InvalidPathError: (error) => {
        return Effect.logError(
          `ParseError: [${error.path}] ${error.message}`
        );
      },
      PathNumberIsNaNError: (error) => {
        return Effect.logError(
          `ParseError: [${error.path}] ${error.message}`
        );
      },
    }),
    Effect.catchAll((error) => {
      return Effect.logError(error);
    })
  )
).pipe(
  CLICommand.withDescription(
    "Lint the repository to ensure it is formatted correctly"
  )
);
