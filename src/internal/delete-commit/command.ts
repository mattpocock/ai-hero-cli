import { Command as CLICommand } from "@effect/cli";
import type { Option } from "effect";
import { Console, Effect } from "effect";
import { GitService } from "../../git-service.js";
import { PromptService } from "../../prompt-service.js";
import { runCeremony } from "../stack/ceremony.js";
import {
  branchOption,
  commitOption,
  mainBranchOption,
  reportErrors,
  requireInteractiveRepo,
} from "../stack/options.js";
import { loadCommits } from "../stack/session.js";
import { labelOf, resolveTarget } from "../stack/target.js";
import {
  beginDeleteSession,
  replayWithoutTarget,
} from "./session.js";

export interface DeleteCommitOptions {
  commit: Option.Option<string>;
  branch: string;
  mainBranch: string;
}

/**
 * Remove a lesson from the history entirely.
 *
 * The extra up-front confirmation and the diffstat are deliberate: this is the
 * only internal command that destroys authored work rather than moving it, and
 * the diffstat is what tells you at a glance whether later lessons build on
 * what you're about to drop. A conflict during the replay usually means
 * exactly that — the tool working, not failing.
 */
export const runDeleteCommit = (opts: DeleteCommitOptions) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const prompts = yield* PromptService;
    const liveBranch = opts.branch;

    yield* requireInteractiveRepo("delete-commit");

    const commits = yield* loadCommits({
      branch: liveBranch,
      mainBranch: opts.mainBranch,
    });

    const target = yield* resolveTarget({
      commits,
      commit: opts.commit,
      promptMessage:
        "Which lesson do you want to delete? (type to search)",
    });

    const label = labelOf(target);
    const following = commits.length - target.sequence;

    yield* Console.log(`\n${target.message}`);
    yield* Console.log(yield* git.showStat(target.sha));

    yield* prompts.confirmDeleteLesson({ label, following });

    const session = yield* beginDeleteSession({
      commits,
      target,
      liveBranch,
    });

    yield* runCeremony({
      session,
      label,
      verb: "deleted",
      compose: Effect.gen(function* () {
        yield* Console.log(
          `\nDeleting ${label} on ${session.tempBranch}`
        );
        if (session.backupBranch) {
          yield* Console.log(
            `Backed up the previous history to ${session.backupBranch}`
          );
        }
        yield* Console.log(
          session.following === 0
            ? `No commits follow ${label}.`
            : `Will replay ${session.following} commit${
                session.following === 1 ? "" : "s"
              } after it.`
        );

        return yield* replayWithoutTarget(session);
      }),
    });
  }).pipe(reportErrors);

export const deleteCommit = CLICommand.make(
  "delete-commit",
  {
    commit: commitOption,
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  runDeleteCommit
).pipe(
  CLICommand.withDescription(
    "Remove a lesson commit from the history"
  )
);
