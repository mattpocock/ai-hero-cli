import { describe, expect, it } from "@effect/vitest";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import * as path from "path";
import { LessonParserService } from "../src/lesson-parser-service.js";
import { runRename } from "../src/internal/rename.js";

/**
 * Tests for the internal rename command.
 * Per SKILL.md: Internal commands are user-facing (Matt uses them daily).
 *
 * runRename renumbers lessons to use proper sequential 01-09 numbering.
 */

describe("rename", () => {
  describe("PRD: User runs rename to fix non-sequential lesson numbering", () => {
    it.effect(
      "should rename lessons with gaps to sequential numbering (1,3,5 -> 01,02,03)",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a course with non-sequential lesson numbers (gaps: 1, 3, 5)
          // User runs rename to fix numbering for cleaner organization
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Section 1 with lesson gaps (01.01, 01.03, 01.05)
          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem", "readme.md"),
            "# Intro"
          );

          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.03-variables", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.03-variables",
              "problem",
              "readme.md"
            ),
            "# Variables"
          );

          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.05-functions", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.05-functions",
              "problem",
              "readme.md"
            ),
            "# Functions"
          );

          // Run rename to fix the gaps
          const renamedCount = yield* runRename({ root: tmpDir });

          // Verify lessons were renamed
          expect(renamedCount).toBe(2); // 01.03->01.02 and 01.05->01.03

          // Verify new sequential structure exists
          const exists01 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.01-intro")
          );
          const exists02 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.02-variables")
          );
          const exists03 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.03-functions")
          );

          expect(exists01).toBe(true);
          expect(exists02).toBe(true);
          expect(exists03).toBe(true);

          // Verify old non-sequential names no longer exist
          const existsOld03 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.03-variables")
          );
          const existsOld05 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.05-functions")
          );

          expect(existsOld03).toBe(false);
          expect(existsOld05).toBe(false);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );

    it.effect(
      "should rename lessons across multiple sections in correct order",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a course with multiple sections to test section sorting
          // User runs rename when they have lessons across multiple sections
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Section 02 (created first but should be processed after 01)
          yield* fs.makeDirectory(
            path.join(tmpDir, "02-advanced", "02.03-async", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "02-advanced", "02.03-async", "problem", "readme.md"),
            "# Async"
          );

          // Section 01 (created second but should be processed first)
          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.05-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "01-basics", "01.05-intro", "problem", "readme.md"),
            "# Intro"
          );

          // Run rename - should process sections in sorted order (01 before 02)
          const renamedCount = yield* runRename({ root: tmpDir });

          // Both lessons need renumbering (01.05->01.01, 02.03->02.01)
          expect(renamedCount).toBe(2);

          // Verify section 01 was renamed correctly
          const exists0101 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.01-intro")
          );
          expect(exists0101).toBe(true);

          // Verify section 02 was renamed correctly
          const exists0201 = yield* fs.exists(
            path.join(tmpDir, "02-advanced", "02.01-async")
          );
          expect(exists0201).toBe(true);

          // Verify old names are gone
          const existsOld0105 = yield* fs.exists(
            path.join(tmpDir, "01-basics", "01.05-intro")
          );
          const existsOld0203 = yield* fs.exists(
            path.join(tmpDir, "02-advanced", "02.03-async")
          );
          expect(existsOld0105).toBe(false);
          expect(existsOld0203).toBe(false);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });
});
