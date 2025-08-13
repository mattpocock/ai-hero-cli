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
  readonly root: string;
  readonly path: string;
  private readonly files: Array<string>;

  constructor(opts: {
    num: number;
    name: string;
    path: string;
    sectionName: string;
    root: string;
    files?: Array<string>;
  }) {
    this.num = opts.num;
    this.name = opts.name;
    this.path = opts.path;
    this.sectionName = opts.sectionName;
    this.root = opts.root;
    this.files = opts.files ?? [];
  }

  absolutePath() {
    return path.resolve(this.root, this.sectionName, this.path);
  }

  allFiles() {
    return this.files.map((file) =>
      path.resolve(this.absolutePath(), file)
    );
  }

  topLevelFiles() {
    return this.files
      .filter((file) => {
        return file.split(path.sep).length === 1;
      })
      .map((file) => path.resolve(this.absolutePath(), file));
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

      const parseLesson = Effect.fn("parseLesson")(
        function* (opts: {
          lessonPath: string;
          sectionPath: string;
          root: string;
        }) {
          const { name, num } = yield* getNameAndNumberFromPath(
            opts.lessonPath
          );

          const fullLessonPath = path.join(
            opts.root,
            opts.sectionPath,
            opts.lessonPath
          );

          const allFiles = yield* fs.readDirectory(
            fullLessonPath,
            {
              recursive: true,
            }
          );

          return new Lesson({
            name,
            num,
            sectionName: opts.sectionPath,
            root: opts.root,
            files: allFiles,
            path: opts.lessonPath,
          });
        }
      );

      const getLessonsFromRepo = (root: string) => {
        return Effect.gen(function* () {
          const rawSections = yield* fs.readDirectory(root);

          const sections = yield* Effect.all(
            rawSections.map((section) => {
              return Effect.gen(function* () {
                const sectionPath = path.join(root, section);

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
                path.join(root, section.path)
              );

              for (const lesson of rawLessons) {
                const lessonPath = path.join(
                  root,
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
                  root,
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
