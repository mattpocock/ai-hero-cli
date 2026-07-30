import { Options } from "@effect/cli";
import { Console, Data, Effect } from "effect";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../../constants.js";
import { NotAGitRepoError } from "./session.js";

export class NotATtyError extends Data.TaggedError(
  "NotATtyError"
)<{
  command: string;
}> {}

export const commitOption = Options.text("commit").pipe(
  Options.withAlias("c"),
  Options.withDescription(
    "Lesson to act on: a lesson id (slug or numeric) or a SHA prefix. Omit to pick from a list."
  ),
  Options.optional
);

export const branchOption = Options.text("branch").pipe(
  Options.withDescription("The live branch holding the commits"),
  Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
);

export const mainBranchOption = Options.text("main-branch").pipe(
  Options.withDescription("The base branch of the project"),
  Options.withDefault("main")
);

/**
 * The preconditions every internal command shares: a git repo, and a TTY.
 *
 * These commands are interactive by design. Rather than silently degrading
 * into a non-interactive mode, they refuse — a caller without a TTY is
 * reaching for something they no longer offer.
 */
export const requireInteractiveRepo = (command: string) =>
  Effect.gen(function* () {
    const cwd = process.cwd();

    if (!existsSync(path.join(cwd, ".git"))) {
      return yield* new NotAGitRepoError({ path: cwd });
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return yield* new NotATtyError({ command });
    }
  });

/**
 * The error reporting every internal command shares. Kept in one place so a
 * new command can't quietly forget to handle a failure the others report.
 */
export const reportErrors = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        // Matched on `_tag` rather than via `catchTags` so this stays one
        // copy: each command's error channel is a slightly different union,
        // and a typed combinator would have to be re-specialised per command.
        const tagged = error as {
          _tag?: string;
          path?: string;
          command?: string;
          liveBranch?: string;
          mainBranch?: string;
          commit?: string;
        };

        switch (tagged._tag) {
          case "NotAGitRepoError":
            yield* Console.error(
              `Error: not a git repository: ${tagged.path}`
            );
            break;
          case "NotATtyError":
            yield* Console.error(
              `Error: \`${tagged.command}\` is interactive and needs a TTY.`
            );
            break;
          case "NoCommitsFoundError":
            yield* Console.error(
              `Error: No commits found on ${tagged.liveBranch} beyond ${tagged.mainBranch}`
            );
            break;
          case "CommitNotFoundError":
            yield* Console.error(
              `Error: No lesson matching "${tagged.commit}"`
            );
            break;
          case "PromptCancelledError":
            yield* Console.log("Cancelled.");
            // A cancellation is a normal exit, not a failure.
            return;
          default:
            yield* Console.error(`Unexpected error: ${error}`);
        }

        process.exitCode = 1;
      })
    )
  );
