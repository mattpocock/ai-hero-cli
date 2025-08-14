import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Data, Effect } from "effect";
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

  constructor(opts: {
    num: number;
    name: string;
    path: string;
    sectionName: string;
    root: string;
  }) {
    this.num = opts.num;
    this.name = opts.name;
    this.path = opts.path;
    this.sectionName = opts.sectionName;
    this.root = opts.root;
  }

  absolutePath() {
    return path.resolve(this.root, this.sectionName, this.path);
  }

  allFiles() {
    const absolutePath = this.absolutePath();
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const files = yield* fs.readDirectory(absolutePath, {
        recursive: true,
      });

      return files.map((file) => path.join(absolutePath, file));
    });
  }

  subfolders() {
    const absolutePath = this.absolutePath();
    return this.allFiles().pipe(
      Effect.map((files) =>
        files
          .map((file) => path.relative(absolutePath, file))
          .filter((file) => {
            return file.split(path.sep).length === 1;
          })
      )
    );
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

          return new Lesson({
            name,
            num,
            sectionName: opts.sectionPath,
            root: opts.root,
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
