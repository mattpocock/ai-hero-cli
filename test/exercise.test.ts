import { describe, expect, it } from "@effect/vitest";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as path from "path";
import {
  LessonEntrypointNotFoundError,
  LessonNotFoundError,
  runLesson,
} from "../src/exercise.js";
import { LessonParserService } from "../src/lesson-parser-service.js";
import { PromptService } from "../src/prompt-service.js";

/**
 * These tests validate user-facing exercise command behaviors.
 *
 * Per CLAUDE.md: "When creating tests which test commands, mock the GitService"
 * The same pattern applies to PromptService - mock it in command tests.
 */

/**
 * Creates a mock PromptService for testing.
 * Most methods will throw if called - tests should not reach interactive prompts.
 */
const createMockPromptService = () => {
  const notImplemented = () => {
    throw new Error("Prompt should not be called in this test");
  };

  return Layer.succeed(PromptService, {
    confirmReadyToCommit: notImplemented,
    confirmSaveToTargetBranch: notImplemented,
    confirmForcePush: notImplemented,
    selectCherryPickConflictAction: notImplemented,
    selectProblemOrSolution: notImplemented,
    selectResetAction: notImplemented,
    confirmResetWithUncommittedChanges: notImplemented,
    inputBranchName: notImplemented,
    selectLessonCommit: notImplemented,
    selectExercise: notImplemented,
    confirmProceedWithUncommittedChanges: notImplemented,
    selectWalkThroughAction: notImplemented,
    selectSubfolder: notImplemented,
    selectExerciseAction: notImplemented,
    confirmContinue: notImplemented,
    selectSubdirectory: notImplemented,
    inputText: notImplemented,
  } as unknown as PromptService);
};

describe("exercise", () => {
  describe("PRD: User requests a lesson that does not exist", () => {
    it.effect(
      "should fail with LessonNotFoundError when lesson number is not in the course",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a course with lessons 1 and 2, but not 99
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "problem"),
            { recursive: true }
          );
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "2-variables", "solution"),
            { recursive: true }
          );

          // User tries to run lesson 99 which doesn't exist
          const error = yield* runLesson({
            lesson: 99,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: undefined,
          }).pipe(Effect.flip);

          expect(error).toBeInstanceOf(LessonNotFoundError);
          expect(error).toEqual(
            new LessonNotFoundError({
              lesson: 99,
              message: "Lesson 99 not found",
            })
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default),
          Effect.provide(createMockPromptService())
        )
    );
  });

  describe("PRD: User runs a malformed lesson with no subfolders", () => {
    it.effect(
      "should fail with LessonEntrypointNotFoundError when lesson has no problem/solution directories",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a lesson directory that exists but has no subfolders (no problem/solution)
          // This simulates a malformed course structure
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Create lesson directory with just a file, no subdirectories
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro"),
            { recursive: true }
          );
          // Add a file so the directory isn't empty
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "notes.txt"),
            "Some notes"
          );

          // User tries to run lesson 1 which exists but has no problem/solution folders
          const error = yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: undefined,
          }).pipe(Effect.flip);

          expect(error).toBeInstanceOf(LessonEntrypointNotFoundError);
          expect(error).toEqual(
            new LessonEntrypointNotFoundError({
              lesson: 1,
              message: "No subfolders found for lesson 1",
            })
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default),
          Effect.provide(createMockPromptService())
        )
    );
  });

  describe("PRD: User runs a lesson with empty subfolder (no main.ts or readme.md)", () => {
    it.effect(
      "should fail with LessonEntrypointNotFoundError when subfolder has no main.ts or readme.md",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a lesson with a problem subfolder but no main.ts or readme.md inside
          // This simulates a malformed course where someone created folders but no content
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "problem"),
            { recursive: true }
          );
          // Add a random file that isn't main.ts or readme.md
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "problem", "notes.txt"),
            "Some notes but no main.ts"
          );

          // User tries to run lesson 1 which has a subfolder but no entrypoint
          const error = yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 0, // Force selecting the problem subfolder
          }).pipe(Effect.flip);

          expect(error).toBeInstanceOf(LessonEntrypointNotFoundError);
          expect(error).toEqual(
            new LessonEntrypointNotFoundError({
              lesson: 1,
              message: "main.ts file for exercise problem not found",
            })
          );
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default),
          Effect.provide(createMockPromptService())
        )
    );
  });
});
