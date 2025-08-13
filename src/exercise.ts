import {
  Args,
  Command as CLICommand,
  Options,
} from "@effect/cli";
import type { Scope } from "effect";
import { Console, Data, Effect, Fiber } from "effect";
import type {
  InvalidPathError,
  PathNumberIsNaNError,
} from "./lesson-parser-service.js";
import { LessonParserService } from "./lesson-parser-service.js";
import * as path from "path";
import prompt from "prompts";
import type {
  CommandExecutor,
  Terminal,
} from "@effect/platform";
import { Command } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { styleText } from "util";
import type { NoSuchElementException } from "effect/Cause";
import * as readline from "readline/promises";

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
  h: "Show all of the available shortcuts",
  n: "Go to the next exercise",
  q: "Quit the exercise",
  p: "Go to the previous exercise",
};

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
  | NoSuchElementException
  | PathNumberIsNaNError,
  | LessonParserService
  | CommandExecutor.CommandExecutor
  | Terminal.Terminal
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
    yield* Console.log(
      `${styleText("bold", "Instructions:")}\n  ${styleText(
        "dim",
        readmeFile
      )}\n`
    );
  }

  yield* Console.log(
    styleText(
      "bold",
      `Running ${foundLesson.num} ${exercise}...`
    )
  );
  yield* Console.log(
    styleText("dim", "  Press h + enter for help")
  );
  yield* Console.log(
    styleText("dim", "  Press q + enter to quit\n")
  );

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

  const exitCode = yield* Effect.gen(function* () {
    const exerciseProcessFork = yield* Effect.fork(
      Command.exitCode(command)
    ).pipe(Effect.onInterrupt(() => Effect.succeed(0)));

    yield* Effect.fork(
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
            for (const [key, value] of Object.entries(
              shortcuts
            )) {
              yield* Console.log(
                `  ${key} ${styleText("dim", `- ${value}`)}`
              );
            }
          } else if (line === "q") {
            yield* Fiber.interrupt(exerciseProcessFork);
            break;
          }
        }
      })
    );

    const exitCode = yield* exerciseProcessFork;

    return exitCode;
  }).pipe(Effect.scoped);

  // If the process failed, we don't need to do anything else.
  if (exitCode !== 0) {
    return;
  }
  yield* Console.log("");

  const { choice } = yield* runPrompt<{
    choice: "run-again" | "finish";
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
          {
            title: "Finish",
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
