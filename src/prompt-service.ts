import { Effect } from "effect";
import { prompt } from "prompts";
import { PromptCancelledError, runPrompt } from "./prompt-utils.js";

export class PromptService extends Effect.Service<PromptService>()(
  "PromptService",
  {
    effect: Effect.gen(function* () {
      /**
       * Prompts user to confirm ready to commit changes.
       * Default is true (yes).
       *
       * @throws PromptCancelledError if user says no or presses Ctrl+C
       */
      const confirmReadyToCommit = Effect.fn("confirmReadyToCommit")(
        function* () {
          const { confirm } = yield* runPrompt<{ confirm: boolean }>(() =>
            prompt([
              {
                type: "confirm",
                name: "confirm",
                message: "Ready to commit?",
                initial: true,
              },
            ])
          );

          if (!confirm) {
            return yield* new PromptCancelledError();
          }
        }
      );

      /**
       * Prompts user to confirm saving to target branch.
       * Default is true (yes).
       *
       * @param branch - The target branch name
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmSaveToTargetBranch = Effect.fn("confirmSaveToTargetBranch")(
        function* (branch: string) {
          const { confirm } = yield* runPrompt<{ confirm: boolean }>(() =>
            prompt([
              {
                type: "confirm",
                name: "confirm",
                message: `Save changes to ${branch}?`,
                initial: true,
              },
            ])
          );

          if (!confirm) {
            return yield* new PromptCancelledError();
          }
        }
      );

      /**
       * Prompts user to confirm force push (dangerous operation).
       * Default is false (no) for safety.
       *
       * @param branch - The branch name
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmForcePush = Effect.fn("confirmForcePush")(function* (
        branch: string
      ) {
        const { confirm } = yield* runPrompt<{ confirm: boolean }>(() =>
          prompt([
            {
              type: "confirm",
              name: "confirm",
              message: `Force push to origin/${branch}?`,
              initial: false,
            },
          ])
        );

        if (!confirm) {
          return yield* new PromptCancelledError();
        }
      });

      /**
       * Prompts user to select action during cherry-pick conflict.
       *
       * @returns 'continue' | 'abort' | 'skip'
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectCherryPickConflictAction = Effect.fn(
        "selectCherryPickConflictAction"
      )(function* () {
        const { action } = yield* runPrompt<{
          action: "continue" | "abort" | "skip";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "action",
              message: "Cherry-pick conflict. What would you like to do?",
              choices: [
                { title: "Continue", value: "continue" },
                { title: "Abort", value: "abort" },
                { title: "Skip", value: "skip" },
              ],
            },
          ])
        );

        return action;
      });

      return {
        confirmReadyToCommit,
        confirmSaveToTargetBranch,
        confirmForcePush,
        selectCherryPickConflictAction,
      };
    }),
    dependencies: [],
  }
) {}
