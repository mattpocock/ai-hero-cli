import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import type { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import {
  Console,
  Data,
  Effect,
  Logger,
  LogLevel,
  Option,
} from "effect";
import { execSync } from "node:child_process";
import * as path from "path";
import prompt from "prompts";
import { styleText } from "node:util";
import type {
  InvalidPathError,
  Lesson,
  PathNumberIsNaNError,
} from "./lesson-parser-service.js";
import { LessonParserService } from "./lesson-parser-service.js";
import {
  cwdOption,
  envFilePathOption,
  rootOption,
} from "./options.js";
import {
  runPrompt,
  type PromptCancelledError,
} from "./prompt-utils.js";

class LessonNotFoundError extends Data.TaggedError(
  "LessonNotFoundError"
)<{
  lesson: number;
  message: string;
}> {}

class LessonEntrypointNotFoundError extends Data.TaggedError(
  "LessonEntrypointNotFoundError"
)<{
  lesson: number;
  message: string;
}> {}

type ExerciseInstruction = {
  /**
   * The lesson number to run
   */
  lessonNumber: number;
  lessonName: string;
  /**
   * The index of the subfolder to run the exercise in
   */
  subfolderIndex: number | undefined;
  /**
   * The subfolder to run the exercise in
   */
  subfolder: string | undefined;
};

const runLesson: (opts: {
  lesson: number;
  root: string;
  envFilePath: string;
  cwd: string;
  /**
   * The index of the subfolder to run the exercise in
   */
  forceSubfolderIndex: number | undefined;
}) => Effect.Effect<
  void,
  | LessonNotFoundError
  | LessonEntrypointNotFoundError
  | PromptCancelledError
  | PlatformError
  | InvalidPathError
  | PathNumberIsNaNError,
  LessonParserService | FileSystem.FileSystem
> = Effect.fn("runLesson")(function* (opts) {
  const { cwd, envFilePath, lesson, root } = opts;
  const service = yield* LessonParserService;
  const lessons = yield* service.getLessonsFromRepo(root);

  const foundLessonIndex = lessons.findIndex(
    (l) => l.num === lesson
  );

  if (foundLessonIndex === -1) {
    return yield* new LessonNotFoundError({
      lesson,
      message: `Lesson ${lesson} not found`,
    });
  }

  const foundLesson = lessons[foundLessonIndex]!;
  const previousLesson = lessons[foundLessonIndex - 1];
  const nextLesson = lessons[foundLessonIndex + 1];

  const subfolders = yield* foundLesson.subfolders();

  if (subfolders.length === 0) {
    return yield* new LessonEntrypointNotFoundError({
      lesson,
      message: `No subfolders found for lesson ${lesson}`,
    });
  }

  /**
   * The subfolder index to run the exercise in.
   */
  let subfolderIndex: number | undefined =
    opts.forceSubfolderIndex;

  if (subfolderIndex === undefined) {
    if (subfolders.length === 1) {
      subfolderIndex = 0;
    } else {
      const result = yield* selectSubfolderIndex({
        lesson: foundLesson,
      });

      subfolderIndex = result.subfolderIndex;
    }
  }

  const subfolder = subfolders[subfolderIndex]!;

  let nextExerciseToRun: ExerciseInstruction | undefined;

  const nextSubfolder = subfolders[subfolderIndex + 1];

  if (nextSubfolder) {
    nextExerciseToRun = {
      lessonNumber: foundLesson.num,
      lessonName: foundLesson.name,
      subfolderIndex: subfolderIndex + 1,
      subfolder: nextSubfolder,
    };
  } else if (nextLesson) {
    nextExerciseToRun = {
      lessonNumber: nextLesson.num,
      lessonName: nextLesson.name,
      subfolderIndex: 0,
      subfolder: (yield* nextLesson.subfolders())[0],
    };
  } else {
    // We're at the last exercise in the course!
    nextExerciseToRun = undefined;
  }

  let previousExerciseToRun: ExerciseInstruction | undefined;

  if (subfolderIndex > 0) {
    previousExerciseToRun = {
      lessonNumber: foundLesson.num,
      lessonName: foundLesson.name,
      subfolderIndex: subfolderIndex - 1,
      subfolder: subfolders[subfolderIndex - 1]!,
    };
  } else if (previousLesson) {
    const previousLessonSubfolders =
      yield* previousLesson.subfolders();

    const previousLessonLastSubfolderIndex =
      previousLessonSubfolders.length - 1;

    previousExerciseToRun = {
      lessonNumber: previousLesson.num,
      lessonName: previousLesson.name,
      subfolderIndex: previousLessonLastSubfolderIndex,
      subfolder:
        previousLessonSubfolders[
          previousLessonLastSubfolderIndex
        ],
    };
  } else {
    previousExerciseToRun = undefined;
  }

  const { mainFile, readmeFile } = yield* getMainAndReadmeFiles({
    lesson: foundLesson,
    subfolder,
  });

  yield* Console.clear;

  const isExplainer = yield* foundLesson.isExplainer();

  let result: "success" | "failed" | "readme-only";

  if (!mainFile && readmeFile) {
    yield* Console.log(styleText(["bold"], `Read the readme:`));

    yield* Console.log(
      styleText("dim", path.relative(cwd, readmeFile))
    );
    yield* Console.log("");
    result = "readme-only";
  } else if (mainFile) {
    yield* Console.log(
      styleText(
        "bold",
        `Running ${foundLesson.num} ${subfolder}...`
      )
    );
    if (readmeFile) {
      yield* logReadmeFile({ readmeFile });
    }
    result = yield* Effect.try({
      try: () =>
        execSync(
          `pnpm tsx --env-file="${envFilePath}" "${mainFile}"`,
          {
            stdio: "inherit",
            cwd,
          }
        ),
      catch: (error) =>
        new RunLessonSimpleError({ cause: error }),
    }).pipe(
      Effect.map(() => "success" as const),
      Effect.catchAll(() => Effect.succeed("failed" as const))
    );
    if (isExplainer && readmeFile) {
      yield* logReadmeFile({ readmeFile });
    }
  } else {
    result = "failed";
  }

  const lessonNoun = isExplainer
    ? {
        successMessage: `Explainer executed! Once you've read the readme and understand the code, you can go to the next exercise.`,
        failureMessage: `Looks like the explainer errored! Want to try again?`,
        lowercase: "explainer",
        readmeMessage: `Once you've read the readme, you can go to the next exercise.`,
      }
    : {
        successMessage: "Exercise complete! What's next?",
        failureMessage: `Looks like the exercise errored! Want to try again?`,
        lowercase: "exercise",
        readmeMessage:
          "Once you've read the readme, you can go to the next exercise.",
      };

  const { choice } = yield* runPrompt<{
    choice:
      | "run-again"
      | "next-exercise"
      | "previous-exercise"
      | "choose-exercise"
      | "finish";
  }>(() =>
    prompt([
      {
        type: "select",
        name: "choice",
        message:
          result === "success"
            ? lessonNoun.successMessage
            : result === "readme-only"
            ? lessonNoun.readmeMessage
            : lessonNoun.failureMessage,
        choices: [
          ...(result === "readme-only"
            ? []
            : [
                {
                  title:
                    result === "failed"
                      ? `🔄 Run the ${lessonNoun.lowercase} again`
                      : `🔄 Try the ${lessonNoun.lowercase} again`,
                  value: "run-again",
                },
              ]),
          ...(nextExerciseToRun
            ? [
                {
                  title: `➡️  Run the next exercise: ${nextExerciseToRun?.lessonNumber}-${nextExerciseToRun?.lessonName} ${nextExerciseToRun?.subfolder}`,
                  value: "next-exercise",
                },
              ]
            : []),
          ...(previousExerciseToRun
            ? [
                {
                  title: `⬅️  Run the previous exercise: ${previousExerciseToRun?.lessonNumber}-${previousExerciseToRun?.lessonName} ${previousExerciseToRun?.subfolder}`,
                  value: "previous-exercise",
                },
              ]
            : []),
          {
            title: "📋 Choose a new exercise",
            value: "choose-exercise",
          },
          {
            title: "✅ Finish",
            value: "finish",
          },
        ],
      },
    ])
  );

  if (choice === "run-again") {
    return yield* runLesson({
      lesson,
      root,
      envFilePath,
      cwd,
      // Run the same exercise again, with the same subfolder index
      forceSubfolderIndex: subfolderIndex,
    });
  } else if (choice === "choose-exercise") {
    return yield* chooseLessonAndRunIt({
      root,
      envFilePath,
      cwd,
    });
  } else if (choice === "next-exercise" && nextExerciseToRun) {
    return yield* runLesson({
      lesson: nextExerciseToRun.lessonNumber,
      root,
      envFilePath,
      cwd,
      forceSubfolderIndex: nextExerciseToRun.subfolderIndex,
    });
  } else if (
    choice === "previous-exercise" &&
    previousExerciseToRun
  ) {
    return yield* runLesson({
      lesson: previousExerciseToRun.lessonNumber,
      root,
      envFilePath,
      cwd,
      forceSubfolderIndex: previousExerciseToRun.subfolderIndex,
    });
  }
});

const logReadmeFile = Effect.fn("logReadmeFile")(
  function* (opts: { readmeFile: string }) {
    yield* Console.log(
      `${styleText([], "Instructions:")}\n  ${styleText(
        "dim",
        opts.readmeFile
      )}\n`
    );
  }
);

const normalizeExerciseNumber = (str: string): Array<string> => {
  const variations = new Set<string>();

  // Add original
  variations.add(str);

  // Check if it contains a dot (format like "02.03")
  const dotIndex = str.indexOf(".");
  if (dotIndex !== -1) {
    const beforeDot = str.slice(0, dotIndex);
    const afterDot = str.slice(dotIndex + 1);

    // Original with dot: "02.03"
    variations.add(str);

    // Without dot: "0203"
    variations.add(beforeDot + afterDot);

    // Remove leading zeros from both parts
    const beforeDotNoZeros = beforeDot.replace(/^0+/, "") || "0";
    const afterDotNoZeros = afterDot.replace(/^0+/, "") || "0";

    // Without leading zeros: "2.3"
    variations.add(`${beforeDotNoZeros}.${afterDotNoZeros}`);

    // Without dot and leading zeros: "23"
    variations.add(beforeDotNoZeros + afterDotNoZeros);

    // Partial leading zeros: "2.03", "02.3"
    variations.add(`${beforeDotNoZeros}.${afterDot}`);
    variations.add(`${beforeDot}.${afterDotNoZeros}`);

    // Without dot, partial leading zeros: "203", "023"
    variations.add(beforeDotNoZeros + afterDot);
    variations.add(beforeDot + afterDotNoZeros);
  } else {
    // No dot - just remove leading zeros
    const noZeros = str.replace(/^0+/, "") || "0";
    variations.add(noZeros);
    variations.add(str);
  }

  return Array.from(variations);
};

const chooseLessonAndRunIt = (opts: {
  root: string;
  envFilePath: string;
  cwd: string;
}) =>
  Effect.gen(function* () {
    const lessonService = yield* LessonParserService;
    const lessons = yield* lessonService.getLessonsFromRepo(
      opts.root
    );

    yield* Console.clear;

    const { lesson: lessonNumber } = yield* runPrompt<{
      lesson: number;
    }>(() =>
      prompt([
        {
          type: "autocomplete",
          name: "lesson",
          message:
            "Which exercise do you want to run? (type to search)",
          choices: lessons.map((lesson) => ({
            title: lesson.path.split("-")[0]!,
            value: lesson.num,
            description: lesson.name,
          })),
          suggest: async (input, choices) => {
            return choices.filter((choice) => {
              const searchText = `${choice.title}-${choice.description}`;
              // Check exact match first
              if (searchText.includes(input)) {
                return true;
              }
              // Check fuzzy matches using variations
              const searchTextVariations =
                normalizeExerciseNumber(searchText);
              return searchTextVariations.some(
                (variation) =>
                  variation.includes(input) ||
                  input.includes(variation)
              );
            });
          },
        },
      ])
    );

    if (typeof lessonNumber === "undefined") {
      return;
    }

    return yield* runLesson({
      lesson: lessonNumber,
      root: opts.root,
      envFilePath: opts.envFilePath,
      cwd: opts.cwd,
      forceSubfolderIndex: undefined,
    });
  }).pipe(
    Effect.catchTags({
      PromptCancelledError: () => {
        process.exitCode = 0;
        return Effect.succeed(void 0);
      },
    }),
    Effect.catchAll(Console.log)
  );

export const exercise = CLICommand.make(
  "exercise",
  {
    lesson: Args.float({
      name: "lesson-number",
    }).pipe(Args.optional),
    root: rootOption,
    envFilePath: envFilePathOption,
    cwd: cwdOption,
    simple: Options.boolean("simple").pipe(
      Options.withDescription(
        "Run the exercise in simple mode. This will disable the more advanced features of the CLI, such as shortcuts, to ensure maximum compatibility with some systems."
      ),
      Options.withDefault(false)
    ),
    debug: Options.boolean("debug").pipe(
      Options.withDescription(
        "Whether or not to run the exercise in debug mode"
      ),
      Options.withDefault(false)
    ),
  },
  ({ cwd, debug, envFilePath, lesson, root, simple }) => {
    return Effect.gen(function* () {
      if (simple) {
        return yield* Console.log(
          "Simple mode is now the default mode! No need to use the --simple flag."
        );
      }

      const resolvedEnvFilePath = path.relative(
        cwd,
        envFilePath
      );

      if (Option.isSome(lesson)) {
        return yield* runLesson({
          lesson: lesson.value,
          root,
          envFilePath: resolvedEnvFilePath,
          cwd,
          forceSubfolderIndex: undefined,
        }).pipe(
          Logger.withMinimumLogLevel(
            debug ? LogLevel.Debug : LogLevel.Info
          )
        );
      }

      return yield* chooseLessonAndRunIt({
        root,
        envFilePath: resolvedEnvFilePath,
        cwd,
      }).pipe(
        Logger.withMinimumLogLevel(
          debug ? LogLevel.Debug : LogLevel.Info
        )
      );
    });
  }
);

const selectSubfolderIndex = Effect.fn("selectSubfolder")(
  function* (opts: { lesson: Lesson }) {
    const subfolders = yield* opts.lesson.subfolders();

    if (subfolders.length === 0) {
      return yield* new LessonEntrypointNotFoundError({
        lesson: opts.lesson.num,
        message: `No subfolders found for lesson ${opts.lesson.num}`,
      });
    }

    const result = yield* runPrompt<{
      subfolderIndex: number;
    }>(() =>
      prompt([
        {
          type: "select",
          name: "subfolderIndex",
          message: "Select a subfolder",
          choices: subfolders.map((file, index) => ({
            title: file,
            value: index,
          })),
        },
      ])
    );

    return {
      subfolderIndex: result.subfolderIndex,
      subfolder: subfolders[result.subfolderIndex]!,
    };
  }
);

const getMainAndReadmeFiles = Effect.fn("getMainAndReadmeFiles")(
  function* (opts: { lesson: Lesson; subfolder: string }) {
    const mainFile = yield* opts.lesson
      .allFiles()
      .pipe(
        Effect.map((files) =>
          files.find((file) =>
            file.includes(path.join(opts.subfolder, "main.ts"))
          )
        )
      );

    const readmeFile = yield* opts.lesson
      .allFiles()
      .pipe(
        Effect.map((files) =>
          files.find((file) =>
            file.includes(path.join(opts.subfolder, "readme.md"))
          )
        )
      );

    if (!mainFile && !readmeFile) {
      return yield* new LessonEntrypointNotFoundError({
        lesson: opts.lesson.num,
        message: `main.ts file for exercise ${opts.subfolder} not found`,
      });
    }

    return {
      mainFile: mainFile ?? null,
      readmeFile: readmeFile ?? null,
    };
  }
);

class RunLessonSimpleError extends Data.TaggedError(
  "RunLessonSimpleError"
)<{
  cause: unknown;
}> {}
