import { Command as CLICommand } from "@effect/cli";
import { Console, Effect } from "effect";
import {
  type BranchCommit,
  CommitNotFoundError,
  resolveCommitRef,
} from "../../branch-commits.js";
import { PromptService } from "../../prompt-service.js";
import { runCeremony } from "../stack/ceremony.js";
import {
  branchOption,
  mainBranchOption,
  reportErrors,
  requireInteractiveRepo,
} from "../stack/options.js";
import { loadCommitsAllowingEmpty } from "../stack/session.js";
import { promptForSubject } from "../stack/slug.js";
import {
  beginAddSession,
  composeStub,
  type InsertPosition,
} from "./session.js";

export interface AddCommitOptions {
  branch: string;
  mainBranch: string;
}

/** Ask where the new lesson goes, skipping the question on an empty stack. */
const askPosition = (commits: Array<BranchCommit>) =>
  Effect.gen(function* () {
    const prompts = yield* PromptService;

    const lessons = commits.filter(
      (commit) => commit.lessonId !== null
    );

    // Nothing to insert between — the first lesson can only go at the tip.
    if (lessons.length === 0) {
      return { _tag: "end" } satisfies InsertPosition;
    }

    const choice = yield* prompts.selectInsertPosition(
      lessons.map((commit) => ({
        lessonId: commit.lessonId!,
        message: commit.description,
        isEmpty: commit.isEmpty,
      }))
    );

    if (choice._tag !== "after") {
      return choice satisfies InsertPosition;
    }

    const commit = resolveCommitRef(lessons, choice.lessonId);
    // The picker can only return an id we offered, so a miss means the list
    // and the resolver disagree — fail loudly rather than insert blind.
    if (!commit) {
      return yield* new CommitNotFoundError({
        commit: choice.lessonId,
      });
    }

    return {
      _tag: "after",
      commit,
    } satisfies InsertPosition;
  });

/**
 * Add an empty stub lesson to the stack, to be filled in later with
 * `edit-commit`.
 *
 * Alone among the internal commands this tolerates an empty stack: "there are
 * no lessons yet" is a perfectly good state to be adding the first one from.
 */
export const runAddCommit = (opts: AddCommitOptions) =>
  Effect.gen(function* () {
    const liveBranch = opts.branch;

    yield* requireInteractiveRepo("add-commit");

    const commits = yield* loadCommitsAllowingEmpty({
      branch: liveBranch,
      mainBranch: opts.mainBranch,
    });

    // Everything that can fail or be cancelled happens before a branch moves.
    const { slug, subject } = yield* promptForSubject({ commits });
    const position = yield* askPosition(commits);

    const session = yield* beginAddSession({
      commits,
      position,
      liveBranch,
    });

    yield* runCeremony({
      session,
      label: slug,
      verb: "added",
      compose: Effect.gen(function* () {
        yield* Console.log(
          `\nAdding "${subject}" on ${session.tempBranch}`
        );
        yield* Console.log(
          session.following === 0
            ? "It goes at the end of the stack; nothing needs replaying."
            : `Will replay ${session.following} commit${
                session.following === 1 ? "" : "s"
              } after it.`
        );

        return yield* composeStub({ session, subject });
      }),
    });
  }).pipe(reportErrors);

export const addCommit = CLICommand.make(
  "add-commit",
  {
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  runAddCommit
).pipe(
  CLICommand.withDescription(
    "Add an empty stub lesson commit to fill in later"
  )
);
