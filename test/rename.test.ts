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
  });
});
