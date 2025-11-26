import { Data, Effect } from "effect";
import { prompt } from "prompts";

export class PromptCancelledError extends Data.TaggedError(
  "PromptCancelledError"
) {}

export const runPrompt = <T extends object>(
  promptFn: () => Promise<T>
) => {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => promptFn());

    if (Object.keys(result).length === 0) {
      return yield* new PromptCancelledError();
    }

    return result;
  });
};

export const confirmContinue = Effect.fn("confirmContinue")(
  function* (
    message: string,
    defaultToContinue: boolean = true
  ) {
    const { confirm } = yield* runPrompt<{
      confirm: boolean;
    }>(() =>
      prompt([
        {
          type: "confirm",
          name: "confirm",
          message,
          initial: defaultToContinue,
        },
      ])
    );

    if (!confirm) {
      return yield* new PromptCancelledError();
    }
  }
);
