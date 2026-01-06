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
            lessonNum: 1,
            lessonName: "introduction",
            lessonPath: "1-introduction",
            sectionNum: 1,
            sectionName: "introduction",
            sectionPath: "1-introduction",
            root: tmpDir,
          }),
          new Lesson({
            lessonNum: 2,
            lessonName: "agentic-stuff",
            lessonPath: "2-agentic-stuff",
            sectionNum: 2,
            sectionName: "basics",
            sectionPath: "2-basics",
            root: tmpDir,
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

  it.effect(
    "should ignore files mixed with section and lesson directories",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const tmpDir = yield* fs.makeTempDirectoryScoped();

        // Create a valid section with a lesson
        yield* fs.makeDirectory(
          path.join(tmpDir, "1-introduction")
        );
        yield* fs.makeDirectory(
          path.join(tmpDir, "1-introduction", "1-getting-started")
        );

        // Add files at root level (should be ignored, not treated as sections)
        yield* fs.writeFileString(
          path.join(tmpDir, "README.md"),
          "# Course README"
        );

        // Add files inside section (should be ignored, not treated as lessons)
        yield* fs.writeFileString(
          path.join(tmpDir, "1-introduction", "notes.txt"),
          "Section notes"
        );

        const service = yield* LessonParserService;
        const lessons = yield* service.getLessonsFromRepo(tmpDir);

        // Should only find the actual lesson directory, ignoring files
        expect(lessons).toEqual([
          new Lesson({
            lessonNum: 1,
            lessonName: "getting-started",
            lessonPath: "1-getting-started",
            sectionNum: 1,
            sectionName: "introduction",
            sectionPath: "1-introduction",
            root: tmpDir,
          }),
        ]);
      }).pipe(
        Effect.scoped,
        Effect.provide(NodeFileSystem.layer),
        Effect.provide(LessonParserService.Default)
      )
  );

  it.effect(
    "should return subfolders (problem/solution) for navigating lesson states",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const tmpDir = yield* fs.makeTempDirectoryScoped();

        // Create lesson structure with problem/solution subfolders
        yield* fs.makeDirectory(
          path.join(tmpDir, "1-basics", "1-variables", "problem"),
          { recursive: true }
        );
        yield* fs.makeDirectory(
          path.join(tmpDir, "1-basics", "1-variables", "solution"),
          { recursive: true }
        );
        // Add a file inside the lesson (should be filtered out)
        yield* fs.writeFileString(
          path.join(tmpDir, "1-basics", "1-variables", "README.md"),
          "# Variables lesson"
        );

        const service = yield* LessonParserService;
        const lessons = yield* service.getLessonsFromRepo(tmpDir);

        expect(lessons).toHaveLength(1);
        const lesson = lessons[0]!;

        const subfolders = yield* lesson.subfolders();

        // Should find only directories, not files
        expect(subfolders.sort()).toEqual(["problem", "solution"]);
      }).pipe(
        Effect.scoped,
        Effect.provide(NodeFileSystem.layer),
        Effect.provide(LessonParserService.Default)
      )
  );
});
