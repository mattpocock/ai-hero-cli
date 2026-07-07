import { Command as CLICommand, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "../../constants.js";
import {
  runAbort,
  runBegin,
  runContinue,
  runPublish,
  runStatus,
} from "./run.js";

const branchOption = Options.text("branch").pipe(
  Options.withDescription("The live branch holding the commits"),
  Options.withDefault(DEFAULT_PROJECT_TARGET_BRANCH)
);

const mainBranchOption = Options.text("main-branch").pipe(
  Options.withDescription("The base branch of the project"),
  Options.withDefault("main")
);

/**
 * Fallback snake_case codes for foreign errors that don't carry their own
 * `code` field (git/platform errors, and branch-commits' NoCommitsFoundError).
 */
const FALLBACK_ERROR_CODES: Record<string, string> = {
  NoCommitsFoundError: "no_commits_found",
};

/**
 * Run a verb and print its result as a single JSON object on stdout.
 * Typed failures become `{ "error": <code>, ... }` + a non-zero exit code,
 * so an agent always parses one schema regardless of outcome.
 */
const emit = <
  A,
  E extends { _tag: string; code?: string },
  R,
>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.flatMap((result) =>
      Console.log(JSON.stringify(result))
    ),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const code =
          error.code ??
          FALLBACK_ERROR_CODES[error._tag] ??
          "error";
        yield* Console.log(
          JSON.stringify({ error: code, ...error })
        );
        process.exitCode = 1;
      })
    )
  );

const begin = CLICommand.make(
  "begin",
  {
    commit: Options.text("commit").pipe(
      Options.withAlias("c"),
      Options.withDescription(
        "Commit to edit: a 1-based sequence number or a SHA prefix"
      )
    ),
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  (opts) => emit(runBegin(opts))
).pipe(
  CLICommand.withDescription(
    "Start editing a commit: park its diff in the working tree"
  )
);

const continueCmd = CLICommand.make("continue", {}, () =>
  emit(runContinue())
).pipe(
  CLICommand.withDescription(
    "Commit the working-tree edits and replay following commits (or resume after resolving conflicts)"
  )
);

const status = CLICommand.make("status", {}, () =>
  emit(runStatus())
).pipe(
  CLICommand.withDescription(
    "Report the current edit-commit session phase (read-only)"
  )
);

const abort = CLICommand.make("abort", {}, () =>
  emit(runAbort())
).pipe(
  CLICommand.withDescription(
    "Discard the session and restore the original branch"
  )
);

const publish = CLICommand.make("publish", {}, () =>
  emit(runPublish())
).pipe(
  CLICommand.withDescription(
    "Force-push the recomposed live branch to origin and clean up"
  )
);

export const editCommit = CLICommand.make("edit-commit").pipe(
  CLICommand.withSubcommands([
    begin,
    continueCmd,
    status,
    abort,
    publish,
  ]),
  CLICommand.withDescription(
    "Agent-driven, resumable editing of a commit's contents"
  )
);
