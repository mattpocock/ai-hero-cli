import { describe, expect, it } from "@effect/vitest";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import * as path from "path";
import { LessonParserService } from "../src/lesson-parser-service.js";
import { runLint } from "../src/internal/lint.js";

/**
 * Tests for the internal lint command.
 * Per SKILL.md: Internal commands are user-facing (Matt uses them daily).
 *
 * runLint validates course repository structure and content.
 */

describe("lint", () => {
  describe("PRD: User runs lint to validate course structure", () => {
    it.effect(
      "should report error when lesson has no subfolders (no problem/solution)",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User creates a malformed lesson without problem/solution subfolders
          // Lint should catch this and report an error
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Create lesson directory without any subfolders
          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro"),
            { recursive: true }
          );

          // Run lint to validate course structure
          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          // Verify lint catches the missing subfolder error
          expect(errors).toHaveLength(1);
          expect(errors[0]?.error).toBe(
            "No subfolders, like problem or solution, found in the exercise."
          );
          expect(errors[0]?.lessonPath).toBe("01.01-intro");
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );

    it.effect(
      "should report error when lesson has subfolders but none are problem/explainer",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User creates a lesson with wrong subfolder names (e.g., "code" instead of "problem")
          // Lint should catch this and tell them they need problem/explainer/explainer.1
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Create lesson with a non-standard subfolder
          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "code"),
            { recursive: true }
          );

          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          expect(errors).toHaveLength(1);
          expect(errors[0]?.error).toBe(
            "No problem, explainer, or explainer.1 folder found in the exercise."
          );
          expect(errors[0]?.lessonPath).toBe("01.01-intro");
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );

    it.effect(
      "should report error when lesson problem folder is missing readme.md",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User creates a lesson with problem folder but forgets to add readme.md
          // Lint should catch this - every lesson needs instructions for users
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Create lesson with problem folder but no readme.md
          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
            { recursive: true }
          );

          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          // Should report missing readme.md and missing main.ts
          expect(errors).toHaveLength(2);
          expect(errors.map((e) => e.error)).toContain(
            "readme.md file not found in the exercise."
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });
});
