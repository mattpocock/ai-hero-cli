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

    it.effect("should report error when readme.md exists but is empty", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        // User creates readme.md but forgets to add content
        // Lint should catch this - empty readme gives no instructions to users
        const tmpDir = yield* fs.makeTempDirectoryScoped();

        // Create lesson with problem folder and empty readme.md
        yield* fs.makeDirectory(
          path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
          { recursive: true }
        );
        yield* fs.writeFileString(
          path.join(tmpDir, "01-basics", "01.01-intro", "problem", "readme.md"),
          "   \n\n  " // Whitespace-only content
        );

        const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

        expect(errors.map((e) => e.error)).toContain(
          "readme.md file is empty"
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(NodeFileSystem.layer),
        Effect.provide(LessonParserService.Default)
      )
    );

    it.effect(
      "should report error when readme.md contains pnpm run exercise command",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User has outdated instructions with pnpm run exercise command
          // Lint should catch this - these commands are deprecated
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "readme.md"
            ),
            "# Exercise\n\nRun `pnpm run exercise 1` to start."
          );

          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          expect(errors.map((e) => e.error)).toContain(
            "readme.md file contains a pnpm run exercise command. Please remove it."
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );

    it.effect(
      "should report error when readme.md contains broken absolute link",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User writes readme with absolute link to file that doesn't exist
          // Lint should catch this - broken links confuse users
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "readme.md"
            ),
            "# Exercise\n\nSee [the example](/non-existent/file.ts) for details."
          );
          // Add main.ts to avoid the "main.ts not found" error
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "main.ts"
            ),
            "console.log('hello');\nconsole.log('world');"
          );

          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          // The url in the error is without the leading slash (due to slice(1, -1))
          expect(errors.map((e) => e.error)).toContain(
            "Broken absolute link in readme.md: non-existent/file.ts"
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );

    it.effect(
      "should report error when readme.md contains broken relative link",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User writes readme with relative link to file that doesn't exist
          // Lint should catch this - broken documentation links confuse users
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "readme.md"
            ),
            "# Exercise\n\nSee [the code](./missing-file.ts) for details."
          );
          // Add main.ts to avoid the "main.ts not found" error
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "main.ts"
            ),
            "console.log('hello');\nconsole.log('world');"
          );

          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          expect(errors.map((e) => e.error)).toContain(
            "Broken relative link in readme.md: ./missing-file.ts"
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );

    it.effect(
      "should report error when main.ts has only one line (too short)",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // User creates a main.ts with only 1 line of code
          // Lint should suggest using readme-only exercise instead
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "01-basics", "01.01-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "readme.md"
            ),
            "# Exercise\n\nThis is a valid exercise."
          );
          // Create main.ts with only 1 line - should trigger error
          yield* fs.writeFileString(
            path.join(
              tmpDir,
              "01-basics",
              "01.01-intro",
              "problem",
              "main.ts"
            ),
            "console.log('hello');"
          );

          const errors = yield* runLint({ cwd: tmpDir, root: tmpDir });

          expect(errors.map((e) => e.error)).toContain(
            "main.ts file in the problem folder is too short (1 lines). Please use a readme-only exercise instead if you only need to show instructions."
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });
});
