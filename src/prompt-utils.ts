import { Data, Effect } from "effect";

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
