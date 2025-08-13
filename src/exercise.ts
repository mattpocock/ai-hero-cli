import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import { Console, Data, Effect } from "effect";
import type {
  InvalidPathError,
  PathNumberIsNaNError,
} from "./lesson-parser-service.js";
import { LessonParserService } from "./lesson-parser-service.js";
import * as path from "path";
import prompt from "prompts";
import type { CommandExecutor } from "@effect/platform";
import { Command, Terminal } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";

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

const runLesson: (opts: {
  lesson: number;
  root: string;
  envFilePath: string;
  cwd: string;
  // The folder to auto-run the exercise in
  autoRunFolder: string | undefined;
}) => Effect.Effect<
  void,
  | LessonNotFoundError
  | LessonEntrypointNotFoundError
  | PromptCancelledError
  | PlatformError
  | InvalidPathError
  | PathNumberIsNaNError,
  LessonParserService | CommandExecutor.CommandExecutor
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

  const topLevelFiles = foundLesson
    .topLevelFiles()
    .map((p) => path.basename(p));

  let exercise: string;

  if (topLevelFiles.length === 1) {
    exercise = topLevelFiles[0];
  } else {
    const result = yield* runPrompt<{
      exercise: string;
    }>(() =>
      prompt([
        {
          type: "select",
          name: "exercise",
          message: "Select an exercise",
          choices: topLevelFiles.map((file) => ({
            title: file,
            value: file,
          })),
        },
      ])
    );

    exercise = result.exercise;
  }

  const mainFile = foundLesson
    .allFiles()
    .find((file) =>
      file.includes(path.join(exercise, "main.ts"))
    );

  if (!mainFile) {
    return yield* new LessonEntrypointNotFoundError({
      lesson,
      message: `main.ts file for exercise ${exercise} not found`,
    });
  }

  const readmeFile = foundLesson
    .allFiles()
    .find((file) =>
      file.includes(path.join(exercise, "readme.md"))
    );

  if (readmeFile) {
    yield* Console.log(readmeFile);
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

  const processFork = yield* Effect.fork(
    Command.exitCode(command)
  );

  const exitCode = yield* processFork;

  // If the process failed, we don't need to do anything else.
  if (exitCode !== 0) {
    return;
  }
  yield* Console.log("");

  const { choice } = yield* runPrompt<{
    choice: "run-again" | "run-next" | "run-prev";
  }>(() =>
    prompt([
      {
        type: "select",
        name: "choice",
        message: "Exercise complete! What's next?",
        choices: [
          {
            title: "Run the exercise again",
            value: "run-again",
          },
          { title: "Run the next exercise", value: "run-next" },
          {
            title: "Run the previous exercise",
            value: "run-prev",
          },
        ],
      },
    ])
  );

  if (choice === "run-again") {
    yield* Console.log("");
    return yield* runLesson({
      lesson,
      root,
      envFilePath,
      cwd,
      autoRunFolder: undefined,
    });
  }
});

export const exercise = CLICommand.make(
  "exercise",
  {
    lesson: Args.float({
      name: "lesson-number",
    }),
    root: Options.text("root").pipe(
      Options.withDescription(
        "The directory to look for lessons"
      ),
      Options.withDefault(process.cwd())
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
      yield* runLesson({
        lesson,
        root,
        envFilePath,
        cwd,
        autoRunFolder: undefined,
      });
    }).pipe(Effect.catchAll(Console.log));
  }
);
