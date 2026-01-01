import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PromptService } from "../src/prompt-service.js";

/**
 * These tests verify the PromptService can be used via the Default layer.
 *
 * Per CLAUDE.md: "When creating tests which test commands, mock the GitService"
 * The same pattern applies to PromptService - mock it in command tests.
 *
 * Since PromptService wraps interactive prompts, we only test that:
 * 1. The Default layer can provide the service
 * 2. The service has the expected methods
 */

describe("PromptService", () => {
  describe("Default layer", () => {
    it.effect("should provide service with all confirm methods", () =>
      Effect.gen(function* () {
        const service = yield* PromptService;

        expect(service).toBeDefined();
        expect(typeof service.confirmReadyToCommit).toBe("function");
        expect(typeof service.confirmSaveToTargetBranch).toBe("function");
        expect(typeof service.confirmForcePush).toBe("function");
        expect(typeof service.selectCherryPickConflictAction).toBe("function");
        expect(typeof service.selectProblemOrSolution).toBe("function");
        expect(typeof service.selectResetAction).toBe("function");
        expect(typeof service.confirmResetWithUncommittedChanges).toBe("function");
        expect(typeof service.inputBranchName).toBe("function");
      }).pipe(Effect.provide(PromptService.Default))
    );
  });
});
