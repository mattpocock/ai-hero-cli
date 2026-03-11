export {
  GitService,
  GitServiceConfig,
  UpstreamPatternsConfig,
  defaultGitServiceConfigLayer,
  defaultUpstreamPatternsConfigLayer,
  makeGitService,
} from "./git-service-impl.js";

export {
  CherryPickConflictError,
  FailedToCheckoutError,
  FailedToCommitError,
  FailedToCreateBranchError,
  FailedToDeleteBranchError,
  FailedToFetchError,
  FailedToFetchOriginError,
  FailedToFetchUpstreamError,
  FailedToPushError,
  FailedToResetError,
  FailedToTrackBranchError,
  InvalidRefError,
  MergeConflictError,
  NoParentCommitError,
  NoUpstreamFoundError,
  NotAGitRepoError,
  RebaseConflictError,
} from "./errors.js";
