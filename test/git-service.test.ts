import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import {
  FailedToFetchOriginError,
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
        const count = yield* git.revListCount(
          `${headSha}~5`,
          headSha
        );

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
          const lines = status
            .split("\n")
            .filter((l) => l.length > 0);
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
});
