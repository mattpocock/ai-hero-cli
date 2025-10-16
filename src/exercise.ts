import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
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
import { styleText } from "util";
import type { Lesson } from "./lesson-parser-service.js";
import { LessonParserService } from "./lesson-parser-service.js";
import {
  cwdOption,
  envFilePathOption,
  rootOption,
} from "./options.js";

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

const runLesson = Effect.fn("runLesson")(function* (opts: {
  lesson: number;
  root: string;
  envFilePath: string;
  cwd: string;
  /**
   * The index of the subfolder to run the exercise in
   */
  forceSubfolderIndex: number | undefined;
}) {
  return yield* runLessonSimple(opts);
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

const normalizeExerciseNumber = (str: string): string => {
  return str.replace(/\b0+(\d)/g, "$1");
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
            const normalizedInput =
              normalizeExerciseNumber(input);
            return choices.filter((choice) => {
              const searchText = `${choice.title}-${choice.description}`;
              const normalizedSearchText =
                normalizeExerciseNumber(searchText);
              return (
                searchText.includes(input) ||
                normalizedSearchText.includes(normalizedInput)
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
        return yield* Effect.fail(
          new Error(
            "Simple is now the default mode, so you no longer need to include the --simple flag"
          )
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
      `pnpm tsx --env-file="${envFilePath}" "${mainFile}"`,
      {
        stdio: "inherit",
        cwd,
      }
    );

    if ((yield* foundLesson.isExplainer()) && readmeFile) {
      yield* logReadmeFile({ readmeFile });
    }
  });
