import { Data, Effect } from "effect";

export class PromptCancelledError extends Data.TaggedError(
  "PromptCancelledError"
) {}

export const runPrompt = <T>(promptFn: () => Promise<T>) => {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => promptFn());

    if (!result) {
      return yield* new PromptCancelledError();
    }

    return result;
  });
};
