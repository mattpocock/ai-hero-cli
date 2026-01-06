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

  describe("PRD: User runs a readme-only lesson (no main.ts)", () => {
    it.effect(
      "should display readme path and prompt for next action when lesson has only readme.md",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a lesson with a readme but no main.ts
          // This is a valid "documentation-only" lesson users might have
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "explainer"),
            { recursive: true }
          );
          // Only readme.md, no main.ts
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "explainer", "readme.md"),
            "# Introduction\n\nRead this documentation."
          );

          let exerciseActionCalled = false;

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: () => {
              throw new Error("Should not be called");
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: () => {
              throw new Error("Should not be called");
            },
            selectExerciseAction: (opts: {
              result: "success" | "failed" | "readme-only";
              hasNext: boolean;
              hasPrevious: boolean;
              nextLabel?: string | undefined;
              previousLabel?: string | undefined;
              lessonType: "exercise" | "explainer";
            }) => {
              exerciseActionCalled = true;
              // Verify the result is "readme-only" when no main.ts exists
              expect(opts.result).toBe("readme-only");
              // Return a valid choice to exit the loop
              return Effect.succeed(
                "exit" as
                  | "run-again"
                  | "choose-exercise"
                  | "next-exercise"
                  | "previous-exercise"
                  | "exit"
              );
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User runs lesson 1 which has only readme.md
          yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 0,
          }).pipe(Effect.provide(mockPromptService));

          // Verify the action prompt was called with readme-only result
          expect(exerciseActionCalled).toBe(true);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });

  describe("PRD: User navigates to next exercise after completing current one", () => {
    it.effect(
      "should navigate to next lesson when user selects next-exercise",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create two lessons so user can navigate between them
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Lesson 1 with readme
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "explainer", "readme.md"),
            "# Lesson 1"
          );

          // Lesson 2 with readme
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "2-variables", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "2-variables", "explainer", "readme.md"),
            "# Lesson 2"
          );

          const lessonsVisited: number[] = [];

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: () => {
              throw new Error("Should not be called");
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: () => {
              throw new Error("Should not be called");
            },
            selectExerciseAction: (opts: {
              result: "success" | "failed" | "readme-only";
              hasNext: boolean;
              hasPrevious: boolean;
              nextLabel?: string | undefined;
              previousLabel?: string | undefined;
              lessonType: "exercise" | "explainer";
            }) => {
              // Track which lesson we're on based on nextLabel
              if (opts.nextLabel?.includes("2-variables")) {
                lessonsVisited.push(1);
                // User selects "next" on lesson 1
                expect(opts.hasNext).toBe(true);
                expect(opts.nextLabel).toContain("2-variables");
                return Effect.succeed("next-exercise" as const);
              } else {
                // We're now on lesson 2
                lessonsVisited.push(2);
                expect(opts.hasNext).toBe(false); // No more lessons
                expect(opts.hasPrevious).toBe(true);
                return Effect.succeed("exit" as const);
              }
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User starts on lesson 1 and navigates to lesson 2
          yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 0,
          }).pipe(Effect.provide(mockPromptService));

          // Verify user successfully navigated from lesson 1 to lesson 2
          expect(lessonsVisited).toEqual([1, 2]);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });

  describe("PRD: User re-runs exercise after failure", () => {
    it.effect(
      "should re-run same lesson when user selects run-again",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a lesson with readme
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "explainer", "readme.md"),
            "# Lesson 1"
          );

          let runCount = 0;

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: () => {
              throw new Error("Should not be called");
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: () => {
              throw new Error("Should not be called");
            },
            selectExerciseAction: () => {
              runCount++;
              if (runCount === 1) {
                // First run - user selects "run-again"
                return Effect.succeed("run-again" as const);
              } else {
                // Second run - user exits
                return Effect.succeed("exit" as const);
              }
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User runs lesson 1, selects "run-again", then exits
          yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 0,
          }).pipe(Effect.provide(mockPromptService));

          // Verify the exercise was run twice (original + re-run)
          expect(runCount).toBe(2);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });

  describe("PRD: User chooses a specific exercise from the list", () => {
    it.effect(
      "should navigate to chosen lesson when user selects choose-exercise",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create three lessons so user can choose between them
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Lesson 1
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "explainer", "readme.md"),
            "# Lesson 1"
          );

          // Lesson 2
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "2-variables", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "2-variables", "explainer", "readme.md"),
            "# Lesson 2"
          );

          // Lesson 3
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "3-functions", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "3-functions", "explainer", "readme.md"),
            "# Lesson 3"
          );

          const lessonsVisited: number[] = [];
          let selectExerciseCalled = false;

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: (lessons: unknown[], _prompt: string) => {
              selectExerciseCalled = true;
              // User sees all 3 lessons and picks lesson 3
              expect(Array.isArray(lessons)).toBe(true);
              expect((lessons as { num: number }[]).length).toBe(3);
              // Return lesson 3's number
              return Effect.succeed(3);
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: () => {
              throw new Error("Should not be called");
            },
            selectExerciseAction: (opts: {
              result: "success" | "failed" | "readme-only";
              hasNext: boolean;
              hasPrevious: boolean;
              nextLabel?: string | undefined;
              previousLabel?: string | undefined;
              lessonType: "exercise" | "explainer";
            }) => {
              // Track which lesson we're on
              if (opts.nextLabel?.includes("2-variables")) {
                lessonsVisited.push(1);
                // User on lesson 1 selects "choose-exercise"
                return Effect.succeed("choose-exercise" as const);
              } else if (!opts.hasNext) {
                // We're on lesson 3 (the last one user chose)
                lessonsVisited.push(3);
                expect(opts.hasPrevious).toBe(true);
                return Effect.succeed("exit" as const);
              }
              throw new Error("Unexpected state");
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User starts on lesson 1, chooses to browse, picks lesson 3
          yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 0,
          }).pipe(Effect.provide(mockPromptService));

          // Verify user was shown exercise picker and navigated to lesson 3
          expect(selectExerciseCalled).toBe(true);
          expect(lessonsVisited).toEqual([1, 3]);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });

  describe("PRD: User selects subfolder when lesson has multiple (problem/solution)", () => {
    it.effect(
      "should prompt user to select subfolder when lesson has both problem and solution directories",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a lesson with both problem and solution subfolders
          // This is the standard exercise format where users work through both states
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Lesson with both problem and solution
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "problem", "readme.md"),
            "# Problem - Start here"
          );
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "solution"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "solution", "readme.md"),
            "# Solution - Reference"
          );

          let selectSubfolderCalled = false;
          let subfoldersPassed: string[] = [];

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: () => {
              throw new Error("Should not be called");
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: (subfolders: string[]) => {
              selectSubfolderCalled = true;
              subfoldersPassed = subfolders;
              // User selects the "problem" subfolder (index 0)
              return Effect.succeed(0);
            },
            selectExerciseAction: () => {
              // Exit after first run
              return Effect.succeed("exit" as const);
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User runs lesson without forceSubfolderIndex - should be prompted
          yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: undefined, // No forced subfolder - triggers prompt
          }).pipe(Effect.provide(mockPromptService));

          // Verify user was prompted to select between problem and solution
          expect(selectSubfolderCalled).toBe(true);
          expect(subfoldersPassed).toContain("problem");
          expect(subfoldersPassed).toContain("solution");
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });

  describe("PRD: User navigates to previous subfolder within same lesson", () => {
    it.effect(
      "should navigate to previous subfolder when user selects previous-exercise on non-first subfolder",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create a lesson with multiple subfolders (problem, solution)
          // User starts on solution and navigates back to problem
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Lesson with problem and solution subfolders
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "problem"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "problem", "readme.md"),
            "# Problem"
          );
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "solution"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "solution", "readme.md"),
            "# Solution"
          );

          const subfoldersVisited: string[] = [];

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: () => {
              throw new Error("Should not be called");
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: () => {
              throw new Error("Should not be called");
            },
            selectExerciseAction: (opts: {
              result: "success" | "failed" | "readme-only";
              hasNext: boolean;
              hasPrevious: boolean;
              nextLabel?: string | undefined;
              previousLabel?: string | undefined;
              lessonType: "exercise" | "explainer";
            }) => {
              // Track which subfolder we're on based on previousLabel
              if (opts.previousLabel?.includes("problem")) {
                // On solution subfolder - previous goes to problem
                subfoldersVisited.push("solution");
                expect(opts.hasPrevious).toBe(true);
                return Effect.succeed("previous-exercise" as const);
              } else {
                // On problem subfolder - no more previous in same lesson
                subfoldersVisited.push("problem");
                return Effect.succeed("exit" as const);
              }
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User starts on solution (subfolderIndex=1) and goes back to problem
          yield* runLesson({
            lesson: 1,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 1, // Start on solution
          }).pipe(Effect.provide(mockPromptService));

          // Verify user navigated from solution back to problem within same lesson
          expect(subfoldersVisited).toEqual(["solution", "problem"]);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });

  describe("PRD: User navigates to previous exercise", () => {
    it.effect(
      "should navigate to previous lesson when user selects previous-exercise",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          // Create two lessons so user can navigate between them
          const tmpDir = yield* fs.makeTempDirectoryScoped();

          // Lesson 1 with readme
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "1-intro", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "1-intro", "explainer", "readme.md"),
            "# Lesson 1"
          );

          // Lesson 2 with readme
          yield* fs.makeDirectory(
            path.join(tmpDir, "1-basics", "2-variables", "explainer"),
            { recursive: true }
          );
          yield* fs.writeFileString(
            path.join(tmpDir, "1-basics", "2-variables", "explainer", "readme.md"),
            "# Lesson 2"
          );

          const lessonsVisited: number[] = [];

          const mockPromptService = Layer.succeed(PromptService, {
            confirmReadyToCommit: () => {
              throw new Error("Should not be called");
            },
            confirmSaveToTargetBranch: () => {
              throw new Error("Should not be called");
            },
            confirmForcePush: () => {
              throw new Error("Should not be called");
            },
            selectCherryPickConflictAction: () => {
              throw new Error("Should not be called");
            },
            selectProblemOrSolution: () => {
              throw new Error("Should not be called");
            },
            selectResetAction: () => {
              throw new Error("Should not be called");
            },
            confirmResetWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            inputBranchName: () => {
              throw new Error("Should not be called");
            },
            selectLessonCommit: () => {
              throw new Error("Should not be called");
            },
            selectExercise: () => {
              throw new Error("Should not be called");
            },
            confirmProceedWithUncommittedChanges: () => {
              throw new Error("Should not be called");
            },
            selectWalkThroughAction: () => {
              throw new Error("Should not be called");
            },
            selectSubfolder: () => {
              throw new Error("Should not be called");
            },
            selectExerciseAction: (opts: {
              result: "success" | "failed" | "readme-only";
              hasNext: boolean;
              hasPrevious: boolean;
              nextLabel?: string | undefined;
              previousLabel?: string | undefined;
              lessonType: "exercise" | "explainer";
            }) => {
              // Track which lesson we're on based on previousLabel
              if (opts.previousLabel?.includes("1-intro")) {
                lessonsVisited.push(2);
                // User selects "previous" on lesson 2
                expect(opts.hasPrevious).toBe(true);
                expect(opts.previousLabel).toContain("1-intro");
                return Effect.succeed("previous-exercise" as const);
              } else {
                // We're now on lesson 1
                lessonsVisited.push(1);
                expect(opts.hasPrevious).toBe(false); // No previous lesson
                expect(opts.hasNext).toBe(true);
                return Effect.succeed("exit" as const);
              }
            },
            confirmContinue: () => {
              throw new Error("Should not be called");
            },
            selectSubdirectory: () => {
              throw new Error("Should not be called");
            },
            inputText: () => {
              throw new Error("Should not be called");
            },
          } as unknown as PromptService);

          // User starts on lesson 2 and navigates back to lesson 1
          yield* runLesson({
            lesson: 2,
            root: tmpDir,
            envFilePath: ".env",
            cwd: tmpDir,
            forceSubfolderIndex: 0,
          }).pipe(Effect.provide(mockPromptService));

          // Verify user successfully navigated from lesson 2 to lesson 1
          expect(lessonsVisited).toEqual([2, 1]);
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeFileSystem.layer),
          Effect.provide(LessonParserService.Default)
        )
    );
  });
});
