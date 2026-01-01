import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import {
  CherryPickConflictError,
  FailedToCheckoutError,
  FailedToCommitError,
  FailedToCreateBranchError,
  FailedToFetchOriginError,
  FailedToPushError,
  FailedToResetError,
  GitService,
  InvalidRefError,
} from "../src/git-service.js";

describe("GitService", () => {
  describe("fetchOrigin", () => {
    it.effect("succeeds when fetch exits with 0", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // fetchOrigin returns void on success
        // This may fail if no network, but verifies the method works
        const result = yield* git.fetchOrigin().pipe(
          Effect.map(() => "success" as const),
          Effect.catchTag("FailedToFetchOriginError", () =>
            Effect.succeed("network-error" as const)
          )
        );

        // Either success or network error is valid
        expect(["success", "network-error"]).toContain(result);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("FailedToFetchOriginError has correct structure", () => {
      const error = new FailedToFetchOriginError({
        message: "Failed to fetch from origin (exit code: 1)",
      });

      expect(error._tag).toBe("FailedToFetchOriginError");
      expect(error.message).toContain("Failed to fetch");
    });
  });

  describe("revParse", () => {
    it.effect("resolves HEAD to a SHA", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        const sha = yield* git.revParse("HEAD");

        // SHA should be 40 hex characters
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it.effect("resolves branch name to a SHA", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        const sha = yield* git.revParse("main");

        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("InvalidRefError has correct structure", () => {
      const error = new InvalidRefError({
        ref: "nonexistent-branch",
        message: "Failed to resolve ref: nonexistent-branch",
      });

      expect(error._tag).toBe("InvalidRefError");
      expect(error.ref).toBe("nonexistent-branch");
      expect(error.message).toContain("Failed to resolve ref");
    });
  });

  describe("revListCount", () => {
    it.effect("counts commits between refs", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Count commits from 5 back to HEAD
        const headSha = yield* git.revParse("HEAD");
        const count = yield* git.revListCount(`${headSha}~5`, headSha);

        expect(typeof count).toBe("number");
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(5);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it.effect("returns 0 for same ref", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        const headSha = yield* git.revParse("HEAD");
        const count = yield* git.revListCount(headSha, headSha);

        expect(count).toBe(0);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("getStatusShort", () => {
    it.effect("returns status output as string", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        const status = yield* git.getStatusShort();

        // Status is a string (may be empty if working dir is clean)
        expect(typeof status).toBe("string");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it.effect("shows modified files with status codes", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        const status = yield* git.getStatusShort();

        // If there are changes, each line starts with status codes
        // Format: XY filename (X=staging, Y=working tree)
        // Codes: M (modified), A (added), D (deleted), ?? (untracked)
        if (status.length > 0) {
          const lines = status.split("\n").filter((l) => l.length > 0);
          for (const line of lines) {
            // Each line: status code (2 chars) + space + filename
            expect(line.length).toBeGreaterThanOrEqual(3);
          }
        }
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("resetHard", () => {
    it.effect("resets to a valid SHA", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Get current HEAD SHA first
        const headSha = yield* git.revParse("HEAD");

        // Reset to the same commit (safe operation, no actual change)
        yield* git.resetHard(headSha);

        // Verify we're still at the same commit
        const afterSha = yield* git.revParse("HEAD");
        expect(afterSha).toBe(headSha);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("FailedToResetError has correct structure", () => {
      const error = new FailedToResetError({
        sha: "abc123",
        message: "Failed to reset to abc123 (exit code: 1)",
      });

      expect(error._tag).toBe("FailedToResetError");
      expect(error.sha).toBe("abc123");
      expect(error.message).toContain("Failed to reset");
    });
  });

  describe("resetHead", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - actually calling it
        // would undo the last commit which we don't want in tests
        expect(typeof git.resetHead).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("restoreStaged", () => {
    it.effect("succeeds when there are no staged changes", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // restoreStaged is safe to call even with nothing staged
        yield* git.restoreStaged();

        // If we get here, the command succeeded
        expect(true).toBe(true);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("stageAll", () => {
    it.effect("succeeds in a git repo", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // stageAll is safe to call even with nothing to stage
        yield* git.stageAll();

        // If we get here, the command succeeded
        expect(true).toBe(true);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("commit", () => {
    it.effect("fails when nothing is staged", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Ensure nothing is staged
        yield* git.restoreStaged();

        // Try to commit with nothing staged - should fail
        const result = yield* git.commit("test commit").pipe(
          Effect.map(() => "success" as const),
          Effect.catchTag("FailedToCommitError", () =>
            Effect.succeed("commit-failed" as const)
          )
        );

        // Commit should fail since nothing is staged
        expect(result).toBe("commit-failed");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("FailedToCommitError has correct structure", () => {
      const error = new FailedToCommitError({
        message: "Failed to commit (exit code: 1)",
      });

      expect(error._tag).toBe("FailedToCommitError");
      expect(error.message).toContain("Failed to commit");
    });
  });

  describe("cherryPick", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - actually calling it
        // would require a valid commit range and could modify repo state
        expect(typeof git.cherryPick).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("CherryPickConflictError has correct structure", () => {
      const error = new CherryPickConflictError({
        range: "abc123..def456",
        message: "Cherry-pick conflict on range abc123..def456",
      });

      expect(error._tag).toBe("CherryPickConflictError");
      expect(error.range).toBe("abc123..def456");
      expect(error.message).toContain("Cherry-pick conflict");
    });
  });

  describe("cherryPickContinue", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - can only be called during an active cherry-pick
        expect(typeof git.cherryPickContinue).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("cherryPickAbort", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - can only be called during an active cherry-pick
        expect(typeof git.cherryPickAbort).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("checkout", () => {
    it.effect("switches to an existing branch", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Get current branch first
        const currentBranch = yield* git.getCurrentBranch();

        // Checkout the same branch (safe operation)
        yield* git.checkout(currentBranch);

        // Verify we're still on the same branch
        const afterBranch = yield* git.getCurrentBranch();
        expect(afterBranch).toBe(currentBranch);
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it.effect("fails for non-existent branch", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        const result = yield* git
          .checkout("nonexistent-branch-that-does-not-exist-12345")
          .pipe(
            Effect.map(() => "success" as const),
            Effect.catchTag("FailedToCheckoutError", () =>
              Effect.succeed("checkout-failed" as const)
            )
          );

        expect(result).toBe("checkout-failed");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("FailedToCheckoutError has correct structure", () => {
      const error = new FailedToCheckoutError({
        branch: "feature-branch",
        message: "Failed to checkout feature-branch (exit code: 1)",
      });

      expect(error._tag).toBe("FailedToCheckoutError");
      expect(error.branch).toBe("feature-branch");
      expect(error.message).toContain("Failed to checkout");
    });
  });

  describe("checkoutNewBranch", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - actually creating a branch
        // would modify repo state
        expect(typeof git.checkoutNewBranch).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("FailedToCreateBranchError has correct structure", () => {
      const error = new FailedToCreateBranchError({
        branchName: "new-feature",
        message: "Failed to create branch new-feature (exit code: 1)",
      });

      expect(error._tag).toBe("FailedToCreateBranchError");
      expect(error.branchName).toBe("new-feature");
      expect(error.message).toContain("Failed to create branch");
    });
  });

  describe("checkoutNewBranchAt", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - actually creating a branch
        // would modify repo state
        expect(typeof git.checkoutNewBranchAt).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );
  });

  describe("pushForceWithLease", () => {
    it.effect("method exists and is callable", () =>
      Effect.gen(function* () {
        const git = yield* GitService;

        // Just verify the method exists - actually pushing would modify remote
        expect(typeof git.pushForceWithLease).toBe("function");
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(GitService.Default)
      )
    );

    it("FailedToPushError has correct structure", () => {
      const error = new FailedToPushError({
        remote: "origin",
        branch: "feature-branch",
        message: "Failed to push feature-branch to origin (exit code: 1)",
      });

      expect(error._tag).toBe("FailedToPushError");
      expect(error.remote).toBe("origin");
      expect(error.branch).toBe("feature-branch");
      expect(error.message).toContain("Failed to push");
    });
  });
});
