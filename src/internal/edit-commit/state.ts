import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import * as path from "node:path";
import { GitServiceConfig } from "../../git-service.js";
import { NoSessionError } from "./errors.js";

/**
 * The phases an edit-commit session moves through.
 *
 *   editing  -> the target commit's diff is sitting in the working tree,
 *               waiting for the agent to make changes, then `continue`.
 *   conflict -> a cherry-pick stopped on conflicts; resolve, then `continue`.
 *   ready    -> the branch has been recomposed locally; `publish` to push.
 */
export type EditCommitPhase = "editing" | "conflict" | "ready";

export interface EditCommitState {
  phase: EditCommitPhase;
  tempBranch: string;
  originalBranch: string;
  liveBranch: string;
  mainBranch: string;
  /** SHA of the commit being edited, as it was before the session began. */
  targetSha: string;
  targetMessage: string;
  targetSequence: number;
  /** Live branch tip before the session began (what we cherry-pick up to). */
  targetBranchHead: string;
  /** Number of commits that follow the target on the live branch. */
  following: number;
}

/** Path to the session state file, relative to the git working directory. */
export const stateFilePath = (cwd: string) =>
  path.join(cwd, ".git", "ai-hero", "edit-commit.json");

export const readState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { cwd } = yield* GitServiceConfig;
  const raw = yield* fs.readFileString(stateFilePath(cwd));
  return JSON.parse(raw) as EditCommitState;
});

/** The current session state, or undefined when none is in progress. */
export const readStateOption = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { cwd } = yield* GitServiceConfig;
  const exists = yield* fs.exists(stateFilePath(cwd));
  if (!exists) return undefined;
  return yield* readState;
});

/** The current session state, or fail with NoSessionError when none. */
export const requireState = Effect.gen(function* () {
  const state = yield* readStateOption;
  if (!state) {
    return yield* Effect.fail(new NoSessionError());
  }
  return state;
});

export const writeState = (state: EditCommitState) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { cwd } = yield* GitServiceConfig;
    const file = stateFilePath(cwd);
    yield* fs.makeDirectory(path.dirname(file), {
      recursive: true,
    });
    yield* fs.writeFileString(
      file,
      JSON.stringify(state, null, 2)
    );
  });

export const clearState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { cwd } = yield* GitServiceConfig;
  yield* fs.remove(stateFilePath(cwd), { force: true });
});
