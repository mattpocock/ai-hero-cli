import { Data, Effect } from "effect";
import { DEFAULT_PROJECT_TARGET_BRANCH } from "./constants.js";
import { GitService } from "./git-service.js";

export class InvalidBranchOperationError extends Data.TaggedError(
  "InvalidBranchOperationError"
)<{
  message: string;
}> {}

/**
 * Ensures the current branch is not the protected exercise branch.
 * Returns the current branch name on success.
 */
export const ensureNotOnProtectedBranch = (command: string) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const currentBranch = yield* git.getCurrentBranch();
    if (currentBranch === DEFAULT_PROJECT_TARGET_BRANCH) {
      return yield* new InvalidBranchOperationError({
        message: `Cannot run ${command} while on the "${DEFAULT_PROJECT_TARGET_BRANCH}" branch. This branch contains exercise data and should not be modified. Switch to a working branch first.`,
      });
    }
    return currentBranch;
  });
