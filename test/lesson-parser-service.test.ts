import { describe, expect, it } from "@effect/vitest";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import * as path from "path";
import {
  InvalidPathError,
  Lesson,
  LessonParserService,
  PathNumberIsNaNError,
} from "../src/lesson-parser-service.js";

describe("LessonParserService", () => {
  it.effect("should handle an empty directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const tmpDir = yield* fs.makeTempDirectoryScoped();

      const service = yield* LessonParserService;
      const lessons = yield* service.getLessonsFromRepo(tmpDir);

      expect(lessons).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(LessonParserService.Default)
    )
  );

  it.effect(
    "should succeed if the directory is properly formatted",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const tmpDir = yield* fs.makeTempDirectoryScoped();

        yield* fs.makeDirectory(
          path.join(tmpDir, "1-introduction")
        );

        yield* fs.makeDirectory(
          path.join(tmpDir, "1-introduction", "1-introduction")
        );

        yield* fs.makeDirectory(path.join(tmpDir, "2-basics"));
        yield* fs.makeDirectory(
          path.join(tmpDir, "2-basics", "2-agentic-stuff")
        );

        const service = yield* LessonParserService;
        const lessons = yield* service.getLessonsFromRepo(
          tmpDir
        );

        expect(lessons).toEqual([
          new Lesson({
            num: 1,
            name: "introduction",
            sectionName: "1-introduction",
          }),
          new Lesson({
            num: 2,
            name: "agentic-stuff",
            sectionName: "2-basics",
          }),
        ]);
      }).pipe(
        Effect.scoped,
        Effect.provide(NodeFileSystem.layer),
        Effect.provide(LessonParserService.Default)
      )
  );

  it.effect(
    "should fail if a lesson has a number that is not a number",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const tmpDir = yield* fs.makeTempDirectoryScoped();

        yield* fs.makeDirectory(
          path.join(tmpDir, "1-introduction")
        );

        yield* fs.makeDirectory(
          path.join(tmpDir, "1-introduction", "foo-introduction")
        );

        const service = yield* LessonParserService;
        const error = yield* service
          .getLessonsFromRepo(tmpDir)
          .pipe(Effect.flip);

        expect(error).toEqual(
          new PathNumberIsNaNError({
            path: "foo-introduction",
            numSection: "foo",
            message:
              "Could not retrieve number from path: foo-introduction",
          })
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(NodeFileSystem.layer),
        Effect.provide(LessonParserService.Default)
      )
  );

  it.effect("should fail if a lesson has no name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const tmpDir = yield* fs.makeTempDirectoryScoped();

      yield* fs.makeDirectory(
        path.join(tmpDir, "1-introduction")
      );

      yield* fs.makeDirectory(
        path.join(tmpDir, "1-introduction", "1-")
      );

      const service = yield* LessonParserService;
      const error = yield* service
        .getLessonsFromRepo(tmpDir)
        .pipe(Effect.flip);

      expect(error).toEqual(
        new InvalidPathError({
          path: "1-",
          message: "Could not retrieve name from path: 1-",
        })
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(LessonParserService.Default)
    )
  );
});
