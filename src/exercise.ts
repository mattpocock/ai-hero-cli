import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import type {
  CommandExecutor,
  FileSystem,
} from "@effect/platform";
import { Command } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import type { Scope } from "effect";
import { Console, Data, Effect, Option } from "effect";
import type { NoSuchElementException } from "effect/Cause";
import * as path from "path";
import prompt from "prompts";
import * as readline from "node:readline/promises";
import { styleText } from "util";
import type {
  InvalidPathError,
  PathNumberIsNaNError,
  Lesson,
} from "./lesson-parser-service.js";
import { LessonParserService } from "./lesson-parser-service.js";
import { execSync } from "node:child_process";
import {
  cwdOption,
  envFilePathOption,
  rootOption,
} from "./options.js";
import { on } from "node:events";

class PromptCancelledError extends Data.TaggedError(
  "PromptCancelledError"
) {}

const runPrompt = <T>(prompt: () => Promise<T>) => {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => prompt());

    if (!result) {
      return yield* new PromptCancelledError();
    }

    return result;
  });
};

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

const shortcuts = {
  enter: "Choose a new exercise to run",
  n: "Go to the next exercise",
  p: "Go to the previous exercise",
  q: "Quit the exercise",
};

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
  simple: boolean;
}) => Effect.Effect<
  void,
  | LessonNotFoundError
  | LessonEntrypointNotFoundError
  | PromptCancelledError
  | PlatformError
  | InvalidPathError
  | NoSuchElementException
  | PathNumberIsNaNError,
  | LessonParserService
  | FileSystem.FileSystem
  | CommandExecutor.CommandExecutor
  | Scope.Scope
> = Effect.fn("runLesson")(function* (opts) {
  if (opts.simple) {
    return yield* runLessonSimple(opts);
  }

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

  yield* Console.log(
    styleText(
      "bold",
      `Running ${foundLesson.num} ${subfolder}...`
    )
  );
  yield* Console.log(
    styleText(
      "dim",
      "  Press n + enter to go to the next exercise"
    )
  );
  yield* Console.log(
    styleText("dim", "  Press h + enter for more shortcuts\n")
  );

  if (readmeFile) {
    yield* logReadmeFile({ readmeFile });
  }

  const command = Command.make(
    "pnpm",
    "tsx",
    "--env-file",
    envFilePath,
    mainFile
  ).pipe(
    Command.stdout("inherit"),
    Command.stderr("inherit"),
    Command.workingDirectory(cwd)
  );

  const processOutcome:
    | "next"
    | "previous"
    | "quit"
    | "choose-exercise"
    | "failed"
    | "exit" = yield* Effect.raceAll([
    Effect.gen(function* () {
      const proc = yield* Command.start(command);

      yield* Effect.addFinalizer(() =>
        proc
          .kill()
          .pipe(
            Effect.catchAll((e) =>
              Effect.logDebug(
                `Error occurred when killing child process.`,
                e
              )
            )
          )
      );

      const result = yield* proc.exitCode;

      return result === 0 ? "exit" : "failed";
    }),
    Effect.gen(function* () {
      const rl = readline.createInterface({
        input: process.stdin,
      });

      yield* Effect.addFinalizer(() => {
        return Effect.succeed(rl.close());
      });

      while (true) {
        const line = yield* Effect.promise(() =>
          rl.question("")
        );

        if (line === "h") {
          yield* Console.log(styleText("bold", "Shortcuts:"));
          for (const [key, value] of Object.entries(shortcuts)) {
            yield* Console.log(
              `  ${key} ${styleText("dim", `- ${value}`)}`
            );
          }
        } else if (line === "q") {
          return "quit";
        } else if (line === "n") {
          return "next";
        } else if (line === "p") {
          return "previous";
        } else if (line.trim() === "") {
          return "choose-exercise";
        }
      }
    }),
  ]).pipe(Effect.scoped);

  yield* Console.log("");

  if (processOutcome === "next" && nextExerciseToRun) {
    return yield* runLesson({
      simple: opts.simple,
      lesson: nextExerciseToRun.lessonNumber,
      root,
      envFilePath,
      cwd,
      forceSubfolderIndex: nextExerciseToRun.subfolderIndex,
    });
  } else if (
    processOutcome === "previous" &&
    previousExerciseToRun
  ) {
    return yield* runLesson({
      simple: opts.simple,
      lesson: previousExerciseToRun.lessonNumber,
      root,
      envFilePath,
      cwd,
      forceSubfolderIndex: previousExerciseToRun.subfolderIndex,
    });
  } else if (processOutcome === "choose-exercise") {
    return yield* chooseLessonAndRunIt({
      simple: opts.simple,
      root,
      envFilePath,
      cwd,
    });
  }

  const isExplainer = yield* foundLesson.isExplainer();

  if (isExplainer && readmeFile) {
    yield* logReadmeFile({ readmeFile });
  }

  const lessonNoun = isExplainer
    ? {
        successMessage: `Explainer executed! Once you've read the readme and understand the code, you can go to the next exercise.`,
        failureMessage: `Looks like the explainer errored! Want to try again?`,
        lowercase: "explainer",
      }
    : {
        successMessage: "Exercise complete! What's next?",
        failureMessage: `Looks like the exercise errored! Want to try again?`,
        lowercase: "exercise",
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
          processOutcome === "exit"
            ? lessonNoun.successMessage
            : lessonNoun.failureMessage,
        choices: [
          {
            title:
              processOutcome === "failed"
                ? `🔄 Run the ${lessonNoun.lowercase} again`
                : `🔄 Try the ${lessonNoun.lowercase} again`,
            value: "run-again",
          },
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
      simple: opts.simple,
    });
  } else if (choice === "choose-exercise") {
    return yield* chooseLessonAndRunIt({
      root,
      envFilePath,
      cwd,
      simple: opts.simple,
    });
  } else if (choice === "next-exercise" && nextExerciseToRun) {
    return yield* runLesson({
      lesson: nextExerciseToRun.lessonNumber,
      root,
      envFilePath,
      cwd,
      forceSubfolderIndex: nextExerciseToRun.subfolderIndex,
      simple: opts.simple,
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
      simple: opts.simple,
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

const chooseLessonAndRunIt = (opts: {
  root: string;
  envFilePath: string;
  cwd: string;
  simple: boolean;
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
            return choices.filter((choice) =>
              `${choice.title}-${choice.description}`.includes(
                input
              )
            );
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
      simple: opts.simple,
    });
  }).pipe(Effect.catchAll(Console.log));

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
  },
  ({ cwd, envFilePath, lesson, root, simple }) => {
    return Effect.gen(function* () {
      if (Option.isSome(lesson)) {
        return yield* runLesson({
          lesson: lesson.value,
          root,
          envFilePath,
          cwd,
          forceSubfolderIndex: undefined,
          simple,
        });
      }

      return yield* chooseLessonAndRunIt({
        root,
        envFilePath,
        cwd,
        simple,
      });
    });
  }
);

const findLesson = Effect.fn("findLesson")(function* (opts: {
  lesson: number;
  root: string;
}) {
  const service = yield* LessonParserService;
  const lessons = yield* service.getLessonsFromRepo(opts.root);

  const foundLessonIndex = lessons.findIndex(
    (l) => l.num === opts.lesson
  );

  if (foundLessonIndex === -1) {
    return yield* new LessonNotFoundError({
      lesson: opts.lesson,
      message: `Lesson ${opts.lesson} not found`,
    });
  }

  return lessons[foundLessonIndex]!;
});

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

    if (!mainFile) {
      return yield* new LessonEntrypointNotFoundError({
        lesson: opts.lesson.num,
        message: `main.ts file for exercise ${opts.subfolder} not found`,
      });
    }

    const readmeFile = yield* opts.lesson
      .allFiles()
      .pipe(
        Effect.map((files) =>
          files.find((file) =>
            file.includes(path.join(opts.subfolder, "readme.md"))
          )
        )
      );

    return { mainFile, readmeFile };
  }
);

const runLessonSimple = (opts: {
  lesson: number;
  root: string;
  envFilePath: string;
  cwd: string;
}) =>
  Effect.gen(function* () {
    const { cwd, envFilePath, lesson, root } = opts;

    const foundLesson = yield* findLesson({
      lesson,
      root,
    });

    const { subfolder } = yield* selectSubfolderIndex({
      lesson: foundLesson,
    });

    const { mainFile, readmeFile } =
      yield* getMainAndReadmeFiles({
        lesson: foundLesson,
        subfolder,
      });

    if (readmeFile) {
      yield* logReadmeFile({ readmeFile });
    }

    yield* Console.log(
      styleText("bold", `Running ${lesson} ${subfolder}...`)
    );

    execSync(
      `pnpm tsx --env-file "${envFilePath}" "${mainFile}"`,
      {
        stdio: "inherit",
        cwd,
      }
    );

    if ((yield* foundLesson.isExplainer()) && readmeFile) {
      yield* logReadmeFile({ readmeFile });
    }
  });
