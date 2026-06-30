import { Data } from "effect";
import type { EditCommitPhase } from "./state.js";

/** Raised when `begin` is run while a session is already in progress. */
export class SessionExistsError extends Data.TaggedError(
  "SessionExistsError"
)<{
  phase: EditCommitPhase;
}> {}

/** Raised when `begin`'s commit reference matches no commit on the branch. */
export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  commit: string;
}> {}

/** Raised when a verb that needs an active session finds none. */
export class NoSessionError extends Data.TaggedError(
  "NoSessionError"
) {}

/**
 * Raised when `continue` is run from the conflict phase but tracked files
 * still contain conflict markers (the agent hasn't finished resolving).
 */
export class UnresolvedConflictsError extends Data.TaggedError(
  "UnresolvedConflictsError"
)<{
  files: Array<string>;
}> {}

/**
 * Raised when the force-push is rejected because origin moved since the
 * session began (the `--force-with-lease` guard fired).
 */
export class LeaseRejectedError extends Data.TaggedError(
  "LeaseRejectedError"
)<{
  branch: string;
}> {}
