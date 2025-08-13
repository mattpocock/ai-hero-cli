import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Data, Effect, Schema } from "effect";
import * as path from "node:path";

export class InvalidPathError extends Data.TaggedError(
  "InvalidPathError"
)<{
  path: string;
  message: string;
}> {}

export class PathNumberIsNaNError extends Data.TaggedError(
  "PathNumberIsNaNError"
)<{
  path: string;
  numSection: string;
  message: string;
}> {}

export class Lesson {
  readonly num: number;
  readonly name: string;
  readonly sectionName: string;

  constructor(opts: {
    num: number;
    name: string;
    sectionName: string;
  }) {
    this.num = opts.num;
    this.name = opts.name;
    this.sectionName = opts.sectionName;
  }

  absolutePath(root: string) {
    return path.join(root, this.sectionName, this.name);
  }

  relativePathToRoot(root: string) {
    return path.relative(root, this.absolutePath(root));
  }
}

const getNameAndNumberFromPath = (path: string) => {
  const numSection = path.split("-")[0];

  if (typeof numSection === "undefined") {
    return Effect.fail(
      new InvalidPathError({
        path,
        message: `Could not retrieve number from path: ${path}`,
      })
    );
  }

  const num = Number(numSection);

  if (Number.isNaN(num)) {
    return Effect.fail(
      new PathNumberIsNaNError({
        path,
        numSection,
        message: `Could not retrieve number from path: ${path}`,
      })
    );
  }

  const name = path.split("-").slice(1).join("-");

  if (!name) {
    return Effect.fail(
      new InvalidPathError({
        path,
        message: `Could not retrieve name from path: ${path}`,
      })
    );
  }

  return Effect.succeed({
    name,
    num,
  });
};

const parseLesson = Effect.fn("parseLesson")(function* (opts: {
  lessonPath: string;
  sectionPath: string;
}) {
  const { name, num } = yield* getNameAndNumberFromPath(
    opts.lessonPath
  );

  return new Lesson({
    name,
    num,
    sectionName: opts.sectionPath,
  });
});

const parseSection = Effect.fn("parseSection")(function* (
  path: string
) {
  const { name, num } = yield* getNameAndNumberFromPath(path);

  return {
    name,
    num,
    path,
  };
});

const filterMeOut = Symbol("filterMeOut");

export class LessonParserService extends Effect.Service<LessonParserService>()(
  "LessonParserService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const getLessonsFromRepo = (filePath: string) => {
        return Effect.gen(function* () {
          const rawSections = yield* fs.readDirectory(filePath);

          const sections = yield* Effect.all(
            rawSections.map((section) => {
              return Effect.gen(function* () {
                const sectionPath = path.join(filePath, section);

                const stat = yield* fs.stat(sectionPath);

                if (stat.type !== "Directory") {
                  return filterMeOut;
                }

                return yield* parseSection(section);
              });
            })
          ).pipe(
            Effect.map((sections) =>
              sections.filter(
                (section) => section !== filterMeOut
              )
            )
          );

          const lessons: Array<Lesson> = [];

          yield* Effect.forEach(sections, (section) => {
            return Effect.gen(function* () {
              const rawLessons = yield* fs.readDirectory(
                path.join(filePath, section.path)
              );

              for (const lesson of rawLessons) {
                const lessonPath = path.join(
                  filePath,
                  section.path,
                  lesson
                );
                const stat = yield* fs.stat(lessonPath);
                if (stat.type !== "Directory") {
                  continue;
                }

                const parsedLesson = yield* parseLesson({
                  lessonPath: lesson,
                  sectionPath: section.path,
                });

                lessons.push(parsedLesson);
              }
            });
          });

          return lessons;
        });
      };

      return {
        getLessonsFromRepo,
      };
    }),
    dependencies: [NodeFileSystem.layer],
  }
) {}
