import { Data } from "effect";
import type { EditCommitPhase } from "./state.js";

/** Raised when `begin` is run while a session is already in progress. */
export class SessionExistsError extends Data.TaggedError(
  "SessionExistsError"
)<{
  phase: EditCommitPhase;
}> {
  readonly code = "session_exists";
}

/** Raised when `begin`'s commit reference matches no commit on the branch. */
export class CommitNotFoundError extends Data.TaggedError(
  "CommitNotFoundError"
)<{
  commit: string;
}> {
  readonly code = "commit_not_found";
}

/** Raised when a verb that needs an active session finds none. */
export class NoSessionError extends Data.TaggedError(
  "NoSessionError"
) {
  readonly code = "no_session";
}

/**
 * Raised when `continue` is run from the conflict phase but tracked files
 * still contain conflict markers (the agent hasn't finished resolving).
 */
export class UnresolvedConflictsError extends Data.TaggedError(
  "UnresolvedConflictsError"
)<{
  files: Array<string>;
}> {
  readonly code = "unresolved_conflicts";
}

/**
 * Raised when the force-push is rejected because origin moved since the
 * session began (the `--force-with-lease` guard fired).
 */
export class LeaseRejectedError extends Data.TaggedError(
  "LeaseRejectedError"
)<{
  branch: string;
}> {
  readonly code = "lease_rejected";
}

/**
 * Raised when a verb is run from a phase it doesn't support (e.g. `continue`
 * from `ready`, or `publish` from `editing`). Caught before any git mutation.
 */
export class InvalidPhaseError extends Data.TaggedError(
  "InvalidPhaseError"
)<{
  phase: EditCommitPhase;
  allowed: ReadonlyArray<EditCommitPhase>;
}> {
  readonly code = "invalid_phase";
}

/**
 * Raised when the recorded session state no longer matches git reality — the
 * temp branch is gone, or the working tree was moved off it — so resuming
 * would operate on the wrong branch.
 */
export class StateDivergedError extends Data.TaggedError(
  "StateDivergedError"
)<{
  message: string;
}> {
  readonly code = "state_diverged";
}
