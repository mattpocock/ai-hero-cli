import { Console, Effect } from "effect";
import { PromptService } from "../../prompt-service.js";
import {
  applyToLiveBranch,
  conflictedFiles,
  filesWithMarkers,
  finish,
  publish,
  resumeCherryPick,
  type StackSession,
  unwind,
} from "./session.js";

/**
 * The stage the session has reached, which decides how a cancellation unwinds.
 *
 *   editing  -> the operation's changes are in the working tree, uncommitted.
 *   conflict -> a cherry-pick has stopped; resolved files are uncommitted.
 *   composed -> everything is committed on the temp branch.
 *   applied  -> the live branch has been moved onto the temp branch.
 */
export type Stage = "editing" | "conflict" | "composed" | "applied";

/**
 * Walk the cherry-pick conflict loop until it clears or the user aborts.
 * Returns false when the user chose to abort the whole session.
 *
 * Written as a loop rather than a recursive effect so the error and
 * requirement channels stay inferred.
 */
export const resolveConflicts = Effect.gen(function* () {
  const prompts = yield* PromptService;

  while (true) {
    const files = yield* conflictedFiles;
    yield* Console.log("\n⚠️  Cherry-pick conflict:");
    for (const file of files) {
      yield* Console.log(`   ${file}`);
    }

    const action =
      yield* prompts.selectCherryPickConflictAction();

    if (action === "abort") {
      return false;
    }

    // Never take "continue" on trust — a committed `<<<<<<<` surfaces later as
    // a broken exercise for students rather than immediately for the author.
    const stillMarked = yield* filesWithMarkers;
    if (stillMarked.length > 0) {
      yield* Console.log(
        "\nThese files still contain conflict markers:"
      );
      for (const file of stillMarked) {
        yield* Console.log(`   ${file}`);
      }
      continue;
    }

    const result = yield* resumeCherryPick;
    if (result.conflict) {
      continue;
    }

    yield* Console.log("✓ Cherry-pick complete");
    return true;
  }
});

/**
 * Run the shared tail every internal command ends in: resolve any replay
 * conflict, confirm the save onto the live branch, confirm the force push,
 * then return to the branch we started on.
 *
 * `compose` is the only part that differs between commands. It mutates the
 * temp branch and reports whether the replay stopped on a conflict; everything
 * either side of it — including how a cancellation unwinds — is identical, on
 * purpose. Four copies of `unwind` is how orphaned branches come back.
 */
export const runCeremony = <E, R>(opts: {
  session: StackSession;
  /** Human name for the lesson being operated on, for progress output. */
  label: string;
  /** Past-tense summary line, e.g. "added" or "deleted". */
  verb: string;
  compose: Effect.Effect<{ conflict: boolean }, E, R>;
}) =>
  Effect.gen(function* () {
    const prompts = yield* PromptService;
    const { label, session } = opts;

    let stage: Stage = "editing";

    const body = Effect.gen(function* () {
      const result = yield* opts.compose;

      if (result.conflict) {
        stage = "conflict";
        const resolved = yield* resolveConflicts;
        if (!resolved) {
          yield* Console.log("Aborting session…");
          const { discardedFiles } = yield* unwind(session, {
            midCherryPick: true,
            liveBranchMoved: false,
            keepTempBranch: false,
          });
          yield* Console.log(
            `✓ Restored ${session.originalBranch}; discarded ${discardedFiles.length} path(s)`
          );
          return;
        }
      }

      stage = "composed";
      yield* Console.log(`\n✓ ${label} ${opts.verb}`);

      yield* prompts.confirmSaveToTargetBranch(
        session.liveBranch
      );
      yield* applyToLiveBranch(session);
      stage = "applied";
      yield* Console.log(
        `✓ ${session.liveBranch} updated with your changes`
      );

      yield* prompts.confirmForcePush(session.liveBranch);
      yield* publish(session);
      yield* Console.log(
        `✓ Pushed ${session.liveBranch} to origin`
      );

      yield* finish(session);
      yield* Console.log(
        `✓ Switched back to ${session.originalBranch}`
      );

      if (session.backupBranch) {
        yield* Console.log(
          `  Backup of the previous history: ${session.backupBranch}`
        );
      }
    });

    /**
     * Cancelling a prompt unwinds in-process. Before the changes are committed
     * we ask first, because the unwind throws away hand-written work (conflict
     * resolutions included); once they're committed we unwind silently but
     * keep the temp branch, so backing out of a push never costs you the work.
     */
    const onCancel = Effect.gen(function* () {
      if (stage === "editing" || stage === "conflict") {
        const discard = yield* prompts.confirmDiscardChanges(
          session.tempBranch
        );

        if (!discard) {
          yield* Console.log(
            `Cancelled. Your changes are on ${session.tempBranch}.`
          );
          return;
        }

        const { discardedFiles } = yield* unwind(session, {
          midCherryPick: stage === "conflict",
          liveBranchMoved: false,
          keepTempBranch: false,
        });
        yield* Console.log(
          `✓ Restored ${session.originalBranch}; discarded ${discardedFiles.length} path(s)`
        );
        return;
      }

      yield* unwind(session, {
        midCherryPick: false,
        liveBranchMoved: stage === "applied",
        keepTempBranch: true,
      });
      yield* Console.log(
        `Cancelled. Your recomposed branch is ${session.tempBranch}.`
      );
    });

    yield* body.pipe(
      Effect.catchTag("PromptCancelledError", () => onCancel),
      // A hard interrupt can't prompt, so leave everything alone and print
      // the breadcrumb needed to find the work again.
      Effect.onInterrupt(() =>
        Console.log(
          `\nInterrupted. Your session is on ${session.tempBranch}.`
        )
      )
    );
  });
