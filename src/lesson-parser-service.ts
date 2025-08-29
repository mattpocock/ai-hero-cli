import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Array, Data, Effect, flow } from "effect";
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
  readonly path: string;
  readonly root: string;
  readonly sectionNum: number;
  readonly sectionName: string;
  readonly sectionPath: string;
  constructor(opts: {
    lessonNum: number;
    lessonName: string;
    lessonPath: string;
    sectionNum: number;
    sectionName: string;
    sectionPath: string;
    root: string;
  }) {
    this.num = opts.lessonNum;
    this.name = opts.lessonName;
    this.path = opts.lessonPath;
    this.sectionNum = opts.sectionNum;
    this.sectionName = opts.sectionName;
    this.sectionPath = opts.sectionPath;
    this.root = opts.root;
  }

  isExplainer() {
    return this.subfolders().pipe(
      Effect.map(
        Array.some((subfolder) => {
          return subfolder.includes("explainer");
        })
      )
    );
  }

  absolutePath() {
    return path.resolve(this.root, this.sectionPath, this.path);
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
    const allFilesEffect = this.allFiles();
    const absolutePath = this.absolutePath();

    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const allFiles = yield* allFilesEffect;

      const candidates = allFiles
        .map((folder) => path.relative(absolutePath, folder))
        .filter((folder) => {
          return folder.split(path.sep).length === 1;
        });

      const folders = yield* Effect.all(
        candidates.map((candidateFolder) => {
          return Effect.gen(function* () {
            const stat = yield* fs.stat(
              path.join(absolutePath, candidateFolder)
            );
            return {
              folder: candidateFolder,
              isDirectory: stat.type === "Directory",
            };
          });
        })
      ).pipe(
        Effect.map(
          flow(
            Array.filter(({ isDirectory }) => isDirectory),
            Array.map(({ folder }) => folder)
          )
        )
      );

      return folders;
    });
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

          const { name: sectionName, num: sectionNum } =
            yield* getNameAndNumberFromPath(opts.sectionPath);

          return new Lesson({
            lessonName: name,
            lessonNum: num,
            lessonPath: opts.lessonPath,
            sectionNum,
            sectionName,
            root: path.resolve(opts.root),
            sectionPath: opts.sectionPath,
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
