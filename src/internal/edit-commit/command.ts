import { Command as CLICommand } from "@effect/cli";
import type { Option } from "effect";
import { Console, Effect } from "effect";
import { PromptService } from "../../prompt-service.js";
import { runCeremony } from "../stack/ceremony.js";
import {
  branchOption,
  commitOption,
  mainBranchOption,
  reportErrors,
  requireInteractiveRepo,
} from "../stack/options.js";
import { labelOf, resolveTarget } from "../stack/target.js";
import { beginSession, loadCommits, recompose } from "./session.js";

export interface EditCommitOptions {
  commit: Option.Option<string>;
  branch: string;
  mainBranch: string;
}

/**
 * Interactively edit a lesson commit's contents.
 *
 * Exported as a plain function so both the CLI subcommand and the `internal`
 * picker run exactly one implementation.
 */
export const runEditCommit = (opts: EditCommitOptions) =>
  Effect.gen(function* () {
    const prompts = yield* PromptService;
    const liveBranch = opts.branch;

    yield* requireInteractiveRepo("edit-commit");

    const commits = yield* loadCommits({
      branch: liveBranch,
      mainBranch: opts.mainBranch,
    });

    const target = yield* resolveTarget({
      commits,
      commit: opts.commit,
      promptMessage:
        "Which lesson do you want to edit? (type to search)",
    });

    const label = labelOf(target);
    const session = yield* beginSession({
      commits,
      target,
      liveBranch,
    });

    yield* runCeremony({
      session,
      label,
      verb: "updated",
      compose: Effect.gen(function* () {
        yield* Console.log(
          `Editing ${label} on ${session.tempBranch}`
        );
        yield* Console.log(
          session.following === 0
            ? `No commits follow ${label}.`
            : `Will replay ${session.following} commit${
                session.following === 1 ? "" : "s"
              } after it.`
        );
        yield* Console.log(
          "\nSession active. Make your changes — ALL unstaged changes go into the commit."
        );

        yield* prompts.confirmReadyToCommit();

        yield* Console.log(
          `Committing with original message: "${session.target.message}"`
        );
        return yield* recompose(session);
      }),
    });
  }).pipe(reportErrors);

export const editCommit = CLICommand.make(
  "edit-commit",
  {
    commit: commitOption,
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  runEditCommit
).pipe(
  CLICommand.withDescription(
    "Interactively edit a lesson commit and replay the commits after it"
  )
);
