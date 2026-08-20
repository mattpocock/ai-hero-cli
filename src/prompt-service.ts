import { Data, Effect } from "effect";
import { prompt } from "prompts";

export class PromptCancelledError extends Data.TaggedError(
  "PromptCancelledError"
) {}

const runPrompt = <T extends object>(
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

/**
 * Prefixes a lesson's description with a 📭 notice when its commit carries no
 * content — a placeholder lesson stub. Emoji + text (not just text) so it
 * reads as visibly empty in the list rather than blank when you're picking a
 * commit, not just something you'd notice if you read the gray description
 * text carefully.
 */
const emptyCommitNotice = (message: string) =>
  `📭 (empty — no content) ${message}`.trim();

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
       * Prompts user to confirm discarding their working-tree changes.
       * Default is false (no) — this throws away hand-written work.
       *
       * @returns true to discard, false to leave the branch in place
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const confirmDiscardChanges = Effect.fn(
        "confirmDiscardChanges"
      )(function* (branch: string) {
        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
          prompt([
            {
              type: "confirm",
              name: "confirm",
              message: `Discard your changes? (No leaves them on ${branch})`,
              initial: false,
            },
          ])
        );

        return confirm;
      });

      /**
       * Prompts user to select action during cherry-pick conflict.
       *
       * "Skip" is deliberately absent: the old implementation returned without
       * touching the in-flight cherry-pick, leaving the repo half-recomposed.
       *
       * @returns 'continue' | 'abort'
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectCherryPickConflictAction = Effect.fn(
        "selectCherryPickConflictAction"
      )(function* () {
        const { action } = yield* runPrompt<{
          action: "continue" | "abort";
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
       * A commit marked `isEmpty` gets a 📭 "(empty — no content)" notice in
       * front of its description, so a placeholder lesson is obvious before
       * you pick it.
       *
       * @param commits - Array of commits with lessonId and message
       * @param promptMessage - Custom prompt message to display
       * @returns The selected lesson ID string
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectLessonCommit = Effect.fn("selectLessonCommit")(
        function* (
          commits: Array<{
            lessonId: string;
            message: string;
            isEmpty?: boolean;
          }>,
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
                  description: commit.isEmpty
                    ? emptyCommitNotice(commit.message)
                    : commit.message,
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
            subfolderIndex: string;
          }>(() =>
            prompt([
              {
                type: "autocomplete",
                name: "subfolderIndex",
                message: "Select a subfolder",
                choices: subfolders.map((subfolder) => ({
                  title: subfolder,
                  // Use subfolder name as value instead of numeric index
                  // to avoid prompts library treating 0 as falsy and
                  // returning the title string instead (GitHub issue #42)
                  value: subfolder,
                })),
              },
            ])
          );

          return subfolders.indexOf(subfolderIndex);
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

      /**
       * Generic confirmation prompt with custom message.
       * Default is true (yes).
       *
       * @param message - The message to display
       * @param defaultToContinue - Whether to default to yes (true) or no (false)
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmContinue = Effect.fn("confirmContinue")(
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

      /**
       * Prompts user to select a subdirectory from a list.
       *
       * @param subdirs - Array of subdirectory names
       * @param message - Custom prompt message
       * @returns The selected subdirectory name
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectSubdirectory = Effect.fn("selectSubdirectory")(
        function* (subdirs: Array<string>, message: string) {
          const { subdirectory } = yield* runPrompt<{
            subdirectory: string;
          }>(() =>
            prompt([
              {
                type: "autocomplete",
                name: "subdirectory",
                message,
                choices: subdirs.map((dir) => ({
                  title: dir,
                  value: dir,
                })),
              },
            ])
          );

          return subdirectory;
        }
      );

      /**
       * Prompts user for text input.
       *
       * @param message - The prompt message
       * @returns The entered text
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const inputText = Effect.fn("inputText")(
        function* (message: string) {
          const { text } = yield* runPrompt<{
            text: string;
          }>(() =>
            prompt([
              {
                type: "text",
                name: "text",
                message,
              },
            ])
          );

          return text;
        }
      );

      /**
       * Prompts the user for a GitHub repository name, pre-filled with a
       * suggested default (typically the current directory name).
       *
       * @param defaultName - The suggested repo name
       * @returns The entered repo name (falls back to the default if empty)
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const inputRepoName = Effect.fn("inputRepoName")(
        function* (defaultName: string) {
          const { repoName } = yield* runPrompt<{
            repoName: string;
          }>(() =>
            prompt([
              {
                type: "text",
                name: "repoName",
                message: "Name for your new private GitHub repo:",
                initial: defaultName,
              },
            ])
          );

          const trimmed = (repoName ?? "").trim();
          return trimmed === "" ? defaultName : trimmed;
        }
      );

      /**
       * Prompts for a lesson slug — the durable id, named for the change.
       *
       * @param initial - Prefilled value, for renaming an existing lesson
       * @returns The entered slug (unvalidated; see `checkSlug`)
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const inputSlug = Effect.fn("inputSlug")(function* (
        initial?: string | undefined
      ) {
        const { slug } = yield* runPrompt<{ slug: string }>(() =>
          prompt([
            {
              type: "text",
              name: "slug",
              message:
                "Slug (the durable id, named for the change — e.g. add-settings-json):",
              ...(initial === undefined ? {} : { initial }),
            },
          ])
        );

        return slug ?? "";
      });

      /**
       * Prompts for a lesson title — the human half of the subject, free to
       * change later.
       *
       * @param initial - Prefilled value, for renaming an existing lesson
       * @returns The entered title
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const inputTitle = Effect.fn("inputTitle")(function* (
        initial?: string | undefined
      ) {
        const { title } = yield* runPrompt<{ title: string }>(
          () =>
            prompt([
              {
                type: "text",
                name: "title",
                message: "Title:",
                ...(initial === undefined ? {} : { initial }),
              },
            ])
        );

        return title ?? "";
      });

      /**
       * Prompts for where a new lesson should be inserted.
       *
       * The two boundary choices are pinned: "at the start" first, "at the
       * end" last, with the existing lessons in teaching order between them.
       *
       * A lesson marked `isEmpty` gets the same 📭 "(empty — no content)"
       * notice as `selectLessonCommit`, so inserting after a placeholder
       * lesson is an informed choice, not a guess.
       *
       * @param lessons - Existing lessons, in teaching order
       * @returns "start", "end", or the lesson id to insert after
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectInsertPosition = Effect.fn(
        "selectInsertPosition"
      )(function* (
        lessons: Array<{
          lessonId: string;
          message: string;
          isEmpty?: boolean;
        }>
      ) {
        const START = " start";
        const END = " end";

        const choices = [
          {
            title: "── at the start ──",
            value: START,
            description: "Before the first lesson",
          },
          ...lessons.map((lesson) => ({
            title: `after ${lesson.lessonId}`,
            value: lesson.lessonId,
            description: lesson.isEmpty
              ? emptyCommitNotice(lesson.message)
              : lesson.message,
          })),
          {
            title: "── at the end ──",
            value: END,
            description: "After the last lesson",
          },
        ];

        const { position } = yield* runPrompt<{
          position: string;
        }>(() =>
          prompt([
            {
              type: "autocomplete",
              name: "position",
              message: "Where should the new lesson go?",
              choices,
              suggest: async (
                input: string,
                options: Array<{
                  title: string;
                  value: string;
                  description: string;
                }>
              ) => {
                const lowerInput = input.toLowerCase().trim();
                if (lowerInput === "") {
                  return options;
                }
                return options.filter((choice) =>
                  `${choice.title} ${choice.description}`
                    .toLowerCase()
                    .includes(lowerInput)
                );
              },
            },
          ])
        );

        if (position === START) {
          return { _tag: "start" as const };
        }
        if (position === END) {
          return { _tag: "end" as const };
        }
        return { _tag: "after" as const, lessonId: position };
      });

      /**
       * Confirms a lesson deletion, having shown what it destroys.
       * Default is false (no) — this is the only op that discards authored
       * work rather than moving it.
       *
       * @throws PromptCancelledError if user declines or cancels
       */
      const confirmDeleteLesson = Effect.fn(
        "confirmDeleteLesson"
      )(function* (opts: { label: string; following: number }) {
        const replay =
          opts.following === 0
            ? "Nothing follows it."
            : `This will replay ${opts.following} commit${
                opts.following === 1 ? "" : "s"
              } after it.`;

        const { confirm } = yield* runPrompt<{
          confirm: boolean;
        }>(() =>
          prompt([
            {
              type: "confirm",
              name: "confirm",
              message: `Delete ${opts.label}? ${replay}`,
              initial: false,
            },
          ])
        );

        if (!confirm) {
          return yield* new PromptCancelledError();
        }
      });

      /**
       * The menu shown by a bare `internal` invocation.
       *
       * Edit first — it's the one used daily. Delete last, so a stray Enter
       * can't reach the destructive one.
       *
       * @returns The selected command name
       * @throws PromptCancelledError if user presses Ctrl+C
       */
      const selectInternalCommand = Effect.fn(
        "selectInternalCommand"
      )(function* () {
        const { command } = yield* runPrompt<{
          command:
            | "edit-commit"
            | "add-commit"
            | "rename-commit"
            | "delete-commit";
        }>(() =>
          prompt([
            {
              type: "select",
              name: "command",
              message: "What would you like to do?",
              choices: [
                {
                  title: "edit-commit",
                  value: "edit-commit",
                  description:
                    "Edit a lesson's contents and replay the commits after it",
                },
                {
                  title: "add-commit",
                  value: "add-commit",
                  description:
                    "Add an empty stub lesson to fill in later",
                },
                {
                  title: "rename-commit",
                  value: "rename-commit",
                  description: "Change a lesson's slug and title",
                },
                {
                  title: "delete-commit",
                  value: "delete-commit",
                  description:
                    "Remove a lesson from the history entirely",
                },
              ],
            },
          ])
        );

        return command;
      });

      return {
        confirmReadyToCommit,
        confirmSaveToTargetBranch,
        confirmForcePush,
        confirmDiscardChanges,
        selectCherryPickConflictAction,
        selectResetAction,
        confirmResetWithUncommittedChanges,
        inputBranchName,
        selectLessonCommit,
        selectExercise,
        confirmProceedWithUncommittedChanges,
        selectWalkThroughAction,
        selectSubfolder,
        selectExerciseAction,
        confirmContinue,
        selectSubdirectory,
        inputText,
        inputRepoName,
        inputSlug,
        inputTitle,
        selectInsertPosition,
        confirmDeleteLesson,
        selectInternalCommand,
      };
    }),
    dependencies: [],
  }
) {}
