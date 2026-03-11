import { Data } from "effect";

export class NotAGitRepoError extends Data.TaggedError(
  "NotAGitRepoError"
)<{
  path: string;
  message: string;
}> {}

export class FailedToFetchUpstreamError extends Data.TaggedError(
  "FailedToFetchUpstreamError"
)<{
  targetBranch: string;
  message: string;
}> {}

export class FailedToCreateBranchError extends Data.TaggedError(
  "FailedToCreateBranchError"
)<{
  branchName: string;
  message: string;
}> {}

export class FailedToDeleteBranchError extends Data.TaggedError(
  "FailedToDeleteBranchError"
)<{
  branchName: string;
  message: string;
}> {}

/**
 * Error thrown when git fetch origin fails.
 * This can happen due to network issues, authentication problems,
 * or the remote not being configured.
 */
export class FailedToFetchOriginError extends Data.TaggedError(
  "FailedToFetchOriginError"
)<{
  message: string;
}> {}

/**
 * Error thrown when a git ref cannot be resolved.
 * This typically happens when the ref (branch, tag, or SHA) doesn't exist.
 */
export class InvalidRefError extends Data.TaggedError(
  "InvalidRefError"
)<{
  ref: string;
  message: string;
}> {}

export class FailedToTrackBranchError extends Data.TaggedError(
  "FailedToTrackBranchError"
)<{
  branchName: string;
  message: string;
}> {}

/**
 * Error thrown when git reset --hard fails.
 * This can happen due to permission issues or filesystem problems.
 */
export class FailedToResetError extends Data.TaggedError(
  "FailedToResetError"
)<{
  sha: string;
  message: string;
}> {}

/**
 * Error thrown when git commit fails.
 * Common causes: nothing to commit, pre-commit hook failure, or git configuration issues.
 */
export class FailedToCommitError extends Data.TaggedError(
  "FailedToCommitError"
)<{
  message: string;
}> {}

/**
 * Error thrown when cherry-pick encounters a conflict.
 * Conflicts occur when changes in the cherry-picked commit overlap with
 * changes in the current branch that cannot be automatically merged.
 */
export class CherryPickConflictError extends Data.TaggedError(
  "CherryPickConflictError"
)<{
  range: string;
  message: string;
}> {}

/**
 * Error thrown when git checkout fails.
 * Common causes: uncommitted changes that would be overwritten,
 * branch doesn't exist, or path conflicts.
 */
export class FailedToCheckoutError extends Data.TaggedError(
  "FailedToCheckoutError"
)<{
  branch: string;
  message: string;
}> {}

/**
 * Error thrown when git push fails.
 * Common causes: remote rejected push (force-with-lease safety),
 * network issues, or authentication problems.
 */
export class FailedToPushError extends Data.TaggedError(
  "FailedToPushError"
)<{
  remote: string;
  branch: string;
  message: string;
}> {}

/**
 * Error thrown when git fetch fails.
 * Common causes: network issues, authentication problems,
 * or the remote/branch doesn't exist.
 */
export class FailedToFetchError extends Data.TaggedError(
  "FailedToFetchError"
)<{
  remote: string;
  branch: string;
  message: string;
}> {}

/**
 * Error thrown when git merge encounters conflicts.
 * Conflicts occur when changes in the merged ref overlap with
 * changes in the current branch that cannot be automatically resolved.
 */
export class MergeConflictError extends Data.TaggedError(
  "MergeConflictError"
)<{
  ref: string;
  message: string;
}> {}

/**
 * Error thrown when git rebase encounters conflicts.
 * Rebasing replays commits on top of a new base, and conflicts occur
 * when changes in the replayed commits overlap with the new base.
 * Unlike merge, rebase rewrites history - all rebased commits get new SHAs.
 */
export class RebaseConflictError extends Data.TaggedError(
  "RebaseConflictError"
)<{
  onto: string;
  message: string;
}> {}

/**
 * Error thrown when a commit has no parent.
 * This occurs when trying to get the parent of the initial commit
 * in a repository, as it has no parent by definition.
 */
export class NoParentCommitError extends Data.TaggedError(
  "NoParentCommitError"
)<{
  commitSha: string;
}> {}
