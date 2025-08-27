import { Command as CLICommand } from "@effect/cli";
import { Console, Effect, Cache, Duration } from "effect";
import type { Lesson } from "../lesson-parser-service.js";
import { LessonParserService } from "../lesson-parser-service.js";
import { cwdOption, rootOption } from "../options.js";
import { styleText } from "util";
import * as path from "path";
import { FileSystem } from "@effect/platform";

export const rename = CLICommand.make(
  "rename",
  {
    root: rootOption,
  },
  Effect.fn("rename")(
    function* ({ root }) {
      const lessonParser = yield* LessonParserService;
      const fs = yield* FileSystem.FileSystem;

      const lessons = yield* lessonParser.getLessonsFromRepo(
        root
      );

      const sections = new Set<string>();

      for (const lesson of lessons) {
        sections.add(lesson.sectionPath);
      }

      const sectionsAsArray = Array.from(sections).sort((a, b) =>
        a.localeCompare(b)
      );

      let totalLessonsRenamed = 0;

      for (const section of sectionsAsArray) {
        const lessonsInSection = lessons
          .filter((lesson) => lesson.sectionPath === section)
          .sort((a, b) => a.num - b.num);

        const fullSectionPath = path.resolve(root, section);

        yield* Effect.forEach(
          lessonsInSection,
          (lesson, index) => {
            return Effect.gen(function* () {
              const newLessonNum = (index + 1)
                .toString()
                .padStart(2, "0");

              const sectionNum = lesson.sectionNum
                .toString()
                .padStart(2, "0");

              const newLessonDirname = `${sectionNum}.${newLessonNum}-${lesson.name}`;

              const newLessonPath = path.join(
                fullSectionPath,
                newLessonDirname
              );

              if (newLessonPath === lesson.absolutePath()) {
                return;
              }

              yield* fs.rename(
                lesson.absolutePath(),
                newLessonPath
              );

              totalLessonsRenamed++;
            });
          }
        );
      }

      yield* Console.log(
        `Renamed ${totalLessonsRenamed} lessons`
      );
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
    "Rename all the lessons in the repository to use proper 01-09 numbering"
  )
);
