import { Command as CLICommand } from "@effect/cli";
import type { Option } from "effect";
import { Console, Effect } from "effect";
import { runCeremony } from "../stack/ceremony.js";
import {
  branchOption,
  commitOption,
  mainBranchOption,
  reportErrors,
  requireInteractiveRepo,
} from "../stack/options.js";
import { loadCommits } from "../stack/session.js";
import { promptForSubject } from "../stack/slug.js";
import { labelOf, resolveTarget } from "../stack/target.js";
import {
  beginRenameSession,
  renameSubject,
} from "./session.js";

export interface RenameCommitOptions {
  commit: Option.Option<string>;
  branch: string;
  mainBranch: string;
}

/**
 * Change a lesson's slug and title.
 *
 * Both prompts are prefilled with the current values, so Enter-Enter is a
 * no-op and fixing only the title never forces you to retype the slug.
 */
export const runRenameCommit = (opts: RenameCommitOptions) =>
  Effect.gen(function* () {
    const liveBranch = opts.branch;

    yield* requireInteractiveRepo("rename-commit");

    const commits = yield* loadCommits({
      branch: liveBranch,
      mainBranch: opts.mainBranch,
    });

    const target = yield* resolveTarget({
      commits,
      commit: opts.commit,
      promptMessage:
        "Which lesson do you want to rename? (type to search)",
    });

    const label = labelOf(target);
    yield* Console.log(`\nRenaming "${target.message}"`);

    const { slug, subject } = yield* promptForSubject({
      commits,
      ...(target.lessonId === null
        ? {}
        : { initialSlug: target.lessonId }),
      initialTitle: target.description,
      // Keeping the commit's own slug is not a duplicate.
      ...(target.lessonId === null
        ? {}
        : { allowExisting: target.lessonId }),
    });

    if (subject === target.message) {
      yield* Console.log("Nothing changed.");
      return;
    }

    const session = yield* beginRenameSession({
      commits,
      target,
      liveBranch,
    });

    yield* runCeremony({
      session,
      label: slug,
      verb: "renamed",
      compose: Effect.gen(function* () {
        yield* Console.log(
          `\n${label} -> "${subject}" on ${session.tempBranch}`
        );
        yield* Console.log(
          session.following === 0
            ? `No commits follow ${label}.`
            : `Will replay ${session.following} commit${
                session.following === 1 ? "" : "s"
              } after it.`
        );

        return yield* renameSubject({ session, subject });
      }),
    });
  }).pipe(reportErrors);

export const renameCommit = CLICommand.make(
  "rename-commit",
  {
    commit: commitOption,
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  runRenameCommit
).pipe(
  CLICommand.withDescription(
    "Change a lesson commit's slug and title"
  )
);
