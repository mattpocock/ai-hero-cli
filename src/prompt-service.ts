import { Effect } from "effect";
import { prompt } from "prompts";
import {
  PromptCancelledError,
  runPrompt,
} from "./prompt-utils.js";

/**
 * Normalizes exercise numbers for fuzzy matching.
 * Generates variations like "02.03" -> ["02.03", "0203", "2.3", "23", etc.]
 */
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
      const confirmReadyToCommit = Effect.fn(
        "confirmReadyToCommit"
      )(function* () {
        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
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
      });

      /**
       * Prompts user to confirm saving to target branch.
       * Default is true (yes).
       *
       * @param branch - The target branch name
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmSaveToTargetBranch = Effect.fn(
        "confirmSaveToTargetBranch"
      )(function* (branch: string) {
        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
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
      });

      /**
       * Prompts user to confirm force push (dangerous operation).
       * Default is false (no) for safety.
       *
       * @param branch - The branch name
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmForcePush = Effect.fn("confirmForcePush")(
        function* (branch: string) {
          const { confirm } = yield* runPrompt<{
            confirm: boolean;
          }>(() =>
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
        }
      );

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
              message:
                "Cherry-pick conflict. What would you like to do?",
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

      /**
       * Prompts user to select problem or solution state for reset.
       *
       * @returns 'problem' | 'solution'
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectProblemOrSolution = Effect.fn(
        "selectProblemOrSolution"
      )(function* () {
        const { action } = yield* runPrompt<{
          action: "problem" | "solution";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "action",
              message: "What would you like to do?",
              choices: [
                {
                  title: "Start the exercise",
                  value: "problem",
                },
                { title: "View final code", value: "solution" },
              ],
            },
          ])
        );

        return action;
      });

      /**
       * Prompts user to choose reset method.
       *
       * @param _branch - The current branch name (for display context)
       * @returns 'reset-current' | 'create-branch'
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectResetAction = Effect.fn("selectResetAction")(
        function* (_branch: string) {
          const { action } = yield* runPrompt<{
            action: "reset-current" | "create-branch";
          }>(() =>
            prompt([
              {
                type: "select",
                name: "action",
                message: "How would you like to proceed?",
                choices: [
                  {
                    title: "Reset current branch",
                    value: "reset-current",
                  },
                  {
                    title: "Create new branch from commit",
                    value: "create-branch",
                  },
                ],
              },
            ])
          );

          return action;
        }
      );

      /**
       * Warns about uncommitted changes before reset.
       * Default is false (no) for safety.
       *
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmResetWithUncommittedChanges = Effect.fn(
        "confirmResetWithUncommittedChanges"
      )(function* () {
        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
          prompt([
            {
              type: "confirm",
              name: "confirm",
              message:
                "This will lose all uncommitted work. Continue?",
              initial: false,
            },
          ])
        );

        if (!confirm) {
          return yield* new PromptCancelledError();
        }
      });

      /**
       * Prompts user to enter a new branch name.
       *
       * @param context - 'working' or 'new' to determine the prompt message
       * @returns The entered branch name
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const inputBranchName = Effect.fn("inputBranchName")(
        function* (context: "working" | "new") {
          const message =
            context === "working"
              ? "Enter name of your new working branch:"
              : "Enter new branch name:";

          const { branchName } = yield* runPrompt<{
            branchName: string;
          }>(() =>
            prompt([
              {
                type: "text",
                name: "branchName",
                message,
              },
            ])
          );

          return branchName;
        }
      );

      /**
       * Autocomplete prompt for selecting a lesson commit.
       *
       * @param commits - Array of commits with lessonId and message
       * @param promptMessage - Custom prompt message to display
       * @returns The selected lesson ID string
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectLessonCommit = Effect.fn("selectLessonCommit")(
        function* (
          commits: Array<{ lessonId: string; message: string }>,
          promptMessage: string
        ) {
          const { lesson } = yield* runPrompt<{
            lesson: string;
          }>(() =>
            prompt([
              {
                type: "autocomplete",
                name: "lesson",
                message: promptMessage,
                choices: commits.map((commit) => ({
                  title: commit.lessonId,
                  value: commit.lessonId,
                  description: commit.message,
                })),
                suggest: async (
                  input: string,
                  choices: Array<{
                    title: string;
                    value: string;
                    description: string;
                  }>
                ) => {
                  const lowerInput = input.toLowerCase();
                  return choices.filter((choice) => {
                    const searchText = `${choice.title} ${choice.description}`;
                    // Check if input matches
                    if (
                      searchText
                        .toLowerCase()
                        .includes(lowerInput)
                    ) {
                      return true;
                    }
                    // Regex-based fuzzy matching for lesson IDs (e.g., 01.02.03)
                    // Allow matching without leading zeros or dots
                    const lessonIdPattern = choice.title
                      .replace(/\./g, "\\.?")
                      .replace(/0(\d)/g, "0?$1");
                    const regex = new RegExp(
                      lessonIdPattern,
                      "i"
                    );
                    return regex.test(input);
                  });
                },
              },
            ])
          );

          return lesson;
        }
      );

      /**
       * Warns about uncommitted changes in walk-through.
       * Default is false (no) for safety.
       *
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmProceedWithUncommittedChanges = Effect.fn(
        "confirmProceedWithUncommittedChanges"
      )(function* () {
        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
          prompt([
            {
              type: "confirm",
              name: "confirm",
              message:
                "You have uncommitted changes. Continuing will lose them. Proceed?",
              initial: false,
            },
          ])
        );

        if (!confirm) {
          return yield* new PromptCancelledError();
        }
      });

      /**
       * Autocomplete prompt for selecting an exercise.
       *
       * @param lessons - Array of lessons with num, name, and path
       * @param promptMessage - Custom prompt message to display
       * @returns The selected lesson number (index)
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectExercise = Effect.fn("selectExercise")(
        function* (
          lessons: Array<{
            num: number;
            name: string;
            path: string;
          }>,
          promptMessage: string
        ) {
          const { lesson } = yield* runPrompt<{
            lesson: number;
          }>(() =>
            prompt([
              {
                type: "autocomplete",
                name: "lesson",
                message: promptMessage,
                choices: lessons.map((l) => ({
                  title: l.path.split("-")[0]!,
                  value: l.num,
                  description: l.name,
                })),
                suggest: async (
                  input: string,
                  choices: Array<{
                    title: string;
                    value: number;
                    description: string;
                  }>
                ) => {
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

          return lesson;
        }
      );

      /**
       * Prompts for next action during walk-through.
       *
       * @param currentCommit - Current commit number (1-based)
       * @param totalCommits - Total number of commits
       * @returns 'continue' | 'cancel'
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectWalkThroughAction = Effect.fn(
        "selectWalkThroughAction"
      )(function* (currentCommit: number, totalCommits: number) {
        const { action } = yield* runPrompt<{
          action: "continue" | "cancel";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "action",
              message: `Commit ${currentCommit}/${totalCommits} applied. Next?`,
              choices: [
                {
                  title: "Continue to next commit",
                  value: "continue",
                },
                {
                  title: "Cancel walk-through",
                  value: "cancel",
                },
              ],
            },
          ])
        );

        return action;
      });

      /**
       * Prompts user to select a subfolder for exercise.
       *
       * @param subfolders - Array of subfolder names
       * @returns The selected index (0-based)
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectSubfolder = Effect.fn("selectSubfolder")(
        function* (subfolders: Array<string>) {
          const { subfolderIndex } = yield* runPrompt<{
            subfolderIndex: number;
          }>(() =>
            prompt([
              {
                type: "autocomplete",
                name: "subfolderIndex",
                message: "Select a subfolder",
                choices: subfolders.map((subfolder, index) => ({
                  title: subfolder,
                  value: index,
                })),
              },
            ])
          );

          return subfolderIndex;
        }
      );

      /**
       * Prompts for next action after running exercise.
       *
       * @param opts - Options for the prompt
       * @param opts.result - The result of the exercise: 'success', 'failed', or 'readme-only'
       * @param opts.hasNext - Whether there is a next exercise
       * @param opts.hasPrevious - Whether there is a previous exercise
       * @param opts.nextLabel - Label for the next exercise (if hasNext)
       * @param opts.previousLabel - Label for the previous exercise (if hasPrevious)
       * @param opts.lessonType - Type of lesson: 'exercise' or 'explainer'
       * @returns Selected action
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectExerciseAction = Effect.fn(
        "selectExerciseAction"
      )(function* (opts: {
        result: "success" | "failed" | "readme-only";
        hasNext: boolean;
        hasPrevious: boolean;
        nextLabel?: string | undefined;
        previousLabel?: string | undefined;
        lessonType: "exercise" | "explainer";
      }) {
        const lessonNoun =
          opts.lessonType === "explainer"
            ? {
                successMessage: `Explainer executed! Once you've read the readme and understand the code, you can go to the next exercise.`,
                failureMessage: `Looks like the explainer errored! Want to try again?`,
                lowercase: "explainer",
                readmeMessage: `Once you've read the readme, you can go to the next exercise.`,
              }
            : {
                successMessage:
                  "Exercise complete! What's next?",
                failureMessage: `Looks like the exercise errored! Want to try again?`,
                lowercase: "exercise",
                readmeMessage:
                  "Once you've read the readme, you can go to the next exercise.",
              };

        const message =
          opts.result === "success"
            ? lessonNoun.successMessage
            : opts.result === "readme-only"
            ? lessonNoun.readmeMessage
            : lessonNoun.failureMessage;

        type Choice = {
          title: string;
          value:
            | "run-again"
            | "next-exercise"
            | "previous-exercise"
            | "choose-exercise"
            | "finish";
        };

        const choices: Array<Choice> = [];

        // Run again (not shown for readme-only)
        if (opts.result !== "readme-only") {
          choices.push({
            title:
              opts.result === "failed"
                ? `🔄 Run the ${lessonNoun.lowercase} again`
                : `🔄 Try the ${lessonNoun.lowercase} again`,
            value: "run-again",
          });
        }

        // Next exercise
        if (opts.hasNext && opts.nextLabel) {
          choices.push({
            title: `➡️  Run the next exercise: ${opts.nextLabel}`,
            value: "next-exercise",
          });
        }

        // Previous exercise
        if (opts.hasPrevious && opts.previousLabel) {
          choices.push({
            title: `⬅️  Run the previous exercise: ${opts.previousLabel}`,
            value: "previous-exercise",
          });
        }

        // Always show these
        choices.push({
          title: "📋 Choose a new exercise",
          value: "choose-exercise",
        });
        choices.push({
          title: "✅ Finish",
          value: "finish",
        });

        const { action } = yield* runPrompt<{
          action:
            | "run-again"
            | "next-exercise"
            | "previous-exercise"
            | "choose-exercise"
            | "finish";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "action",
              message,
              choices,
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
        selectProblemOrSolution,
        selectResetAction,
        confirmResetWithUncommittedChanges,
        inputBranchName,
        selectLessonCommit,
        selectExercise,
        confirmProceedWithUncommittedChanges,
        selectWalkThroughAction,
        selectSubfolder,
        selectExerciseAction,
      };
    }),
    dependencies: [],
  }
) {}
