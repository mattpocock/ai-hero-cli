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
} from "./lesson-parser-service.js";
import { LessonParserService } from "./lesson-parser-service.js";

class PromptCancelledError extends Data.TaggedError(
  "PromptCancelledError"
)<{}> {}

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
  | NoSuchElementException
  | PathNumberIsNaNError,
  | LessonParserService
  | FileSystem.FileSystem
  | CommandExecutor.CommandExecutor
  | Scope.Scope
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

  const subfolders = yield* foundLesson
    .subfolders()
    .pipe(
      Effect.map((files) => files.map((p) => path.basename(p)))
    );

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
      const result = yield* runPrompt<{
        subfolder: number;
      }>(() =>
        prompt([
          {
            type: "select",
            name: "subfolder",
            message: "Select a subfolder",
            choices: subfolders.map((file, index) => ({
              title: file,
              value: index,
            })),
          },
        ])
      );

      subfolderIndex = Number(result.subfolder);
    }
  }

  const subfolder = subfolders[subfolderIndex]!;

  let nextExerciseToRun: ExerciseInstruction | undefined;

  const nextSubfolder = subfolders[subfolderIndex + 1];

  if (nextSubfolder) {
    nextExerciseToRun = {
      lessonNumber: foundLesson.num,
      subfolderIndex: subfolderIndex + 1,
      subfolder: nextSubfolder,
    };
  } else if (nextLesson) {
    nextExerciseToRun = {
      lessonNumber: nextLesson.num,
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
      subfolderIndex: previousLessonLastSubfolderIndex,
      subfolder:
        previousLessonSubfolders[
          previousLessonLastSubfolderIndex
        ],
    };
  } else {
    previousExerciseToRun = undefined;
  }

  const mainFile = yield* foundLesson
    .allFiles()
    .pipe(
      Effect.map((files) =>
        files.find((file) =>
          file.includes(path.join(subfolder, "main.ts"))
        )
      )
    );

  if (!mainFile) {
    return yield* new LessonEntrypointNotFoundError({
      lesson,
      message: `main.ts file for exercise ${subfolder} not found`,
    });
  }

  const readmeFile = yield* foundLesson
    .allFiles()
    .pipe(
      Effect.map((files) =>
        files.find((file) =>
          file.includes(path.join(subfolder, "readme.md"))
        )
      )
    );

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
    yield* Console.log(
      `${styleText([], "Instructions:")}\n  ${styleText(
        "dim",
        readmeFile
      )}\n`
    );
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
    Command.exitCode(command).pipe(
      Effect.map((code) => (code === 0 ? "exit" : "failed"))
    ),
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
      lesson: previousExerciseToRun.lessonNumber,
      root,
      envFilePath,
      cwd,
      forceSubfolderIndex: previousExerciseToRun.subfolderIndex,
    });
  } else if (processOutcome === "choose-exercise") {
    return yield* chooseLessonAndRunIt({
      root,
      envFilePath,
      cwd,
    });
  }

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
            ? "Exercise complete! What's next?"
            : "Looks like the exercise errored! What's next?",
        choices: [
          {
            title:
              processOutcome === "failed"
                ? "🔄 Run the exercise again"
                : "🔄 Try the exercise again",
            value: "run-again",
          },
          ...(nextExerciseToRun
            ? [
                {
                  title: `➡️  Run the next exercise: ${nextExerciseToRun?.lessonNumber} ${nextExerciseToRun?.subfolder}`,
                  value: "next-exercise",
                },
              ]
            : []),
          ...(previousExerciseToRun
            ? [
                {
                  title: `⬅️  Run the previous exercise: ${previousExerciseToRun?.lessonNumber} ${previousExerciseToRun?.subfolder}`,
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
            title: `${lesson.num}-${lesson.name}`,
            value: lesson.num,
          })),
          suggest: async (input, choices) => {
            return choices.filter((choice) =>
              choice.title.includes(input)
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
    });
  }).pipe(Effect.catchAll(Console.log));

export const exercise = CLICommand.make(
  "exercise",
  {
    lesson: Args.float({
      name: "lesson-number",
    }).pipe(Args.optional),
    root: Options.text("root").pipe(
      Options.withDescription(
        "The directory to look for lessons"
      ),
      Options.withDefault(path.join(process.cwd(), "exercises"))
    ),
    envFilePath: Options.text("env-file").pipe(
      Options.withDescription(
        "The path to the environment file to use"
      ),
      Options.withDefault(path.join(process.cwd(), ".env"))
    ),
    cwd: Options.text("cwd").pipe(
      Options.withDescription(
        "The working directory to run the command in"
      ),
      Options.withDefault(process.cwd())
    ),
  },
  ({ cwd, envFilePath, lesson, root }) => {
    return Effect.gen(function* () {
      if (Option.isSome(lesson)) {
        return yield* runLesson({
          lesson: lesson.value,
          root,
          envFilePath,
          cwd,
          forceSubfolderIndex: undefined,
        });
      }

      return yield* chooseLessonAndRunIt({
        root,
        envFilePath,
        cwd,
      });
    });
  }
);
