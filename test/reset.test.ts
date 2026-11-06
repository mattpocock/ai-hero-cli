import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Exit, Layer, Option } from "effect";
import { runReset } from "../src/reset.js";
import {
  FailedToResetError,
  GitService,
} from "../src/git-service.js";
import {
  PromptCancelledError,
  PromptService,
} from "../src/prompt-service.js";

/**
 * Unit tests for the ordering of destructive git calls in reset.
 * GitService and PromptService are both mocked; each mock records
 * the calls it receives so tests can assert on their order.
 */
describe("reset (unit)", () => {
  const makeGitService = (opts: {
    calls: Array<string>;
    statusOutput: string;
    resetHardFails?: boolean;
  }) =>
    fromPartial<GitService>({
      hasRemote: Effect.fn("hasRemote")(function* () {
        return true;
      }),
      hasLocalBranch: Effect.fn("hasLocalBranch")(function* () {
        return true;
      }),
      ensureIsGitRepo: Effect.fn("ensureIsGitRepo")(
        function* () {}
      ),
      getCurrentBranch: Effect.fn("getCurrentBranch")(
        function* () {
          return "my-branch";
        }
      ),
      setUpstreamRemote: Effect.fn("setUpstreamRemote")(
        function* () {}
      ),
      ensureUpstreamBranchConnected: Effect.fn(
        "ensureUpstreamBranchConnected"
      )(function* () {}),
      fetch: Effect.fn("fetch")(function* () {}),
      revParse: Effect.fn("revParse")(function* () {
        return "target-sha";
      }),
      hasSymlinksDisabled: Effect.fn("hasSymlinksDisabled")(
        function* () {
          return false;
        }
      ),
      revListCountExcluding: Effect.fn("revListCountExcluding")(
        function* () {
          return 0;
        }
      ),
      getUncommittedChanges: Effect.fn("getUncommittedChanges")(
        function* () {
          return {
            hasUncommittedChanges: opts.statusOutput !== "",
            statusOutput: opts.statusOutput,
          };
        }
      ),
      resetHard: Effect.fn("resetHard")(function* (sha: string) {
        opts.calls.push(`resetHard ${sha}`);
        if (opts.resetHardFails) {
          return yield* new FailedToResetError({
            sha,
            message: "index.lock exists",
          });
        }
      }),
      clean: Effect.fn("clean")(function* () {
        opts.calls.push("clean");
      }),
      applyAsUnstagedChanges: Effect.fn("applyAsUnstagedChanges")(
        function* (sha: string, applyOpts?: { clean?: boolean }) {
          opts.calls.push(
            `applyAsUnstagedChanges ${sha} clean=${applyOpts?.clean}`
          );
        }
      ),
    });

  const makePromptService = (opts: {
    calls: Array<string>;
    confirm: boolean;
  }) =>
    fromPartial<PromptService>({
      selectResetAction: Effect.fn("selectResetAction")(
        function* () {
          return "reset-current" as const;
        }
      ),
      confirmResetWithUncommittedChanges: Effect.fn(
        "confirmResetWithUncommittedChanges"
      )(function* () {
        opts.calls.push("confirm");
        if (!opts.confirm) {
          return yield* new PromptCancelledError();
        }
      }),
    });

  const run = (opts: {
    calls: Array<string>;
    statusOutput: string;
    confirm?: boolean;
    unstaged?: boolean;
    resetHardFails?: boolean;
  }) =>
    runReset({
      branch: "live-run-through",
      lessonId: Option.some("main"),
      unstaged: opts.unstaged ?? false,
      upstream: "/tmp/upstream",
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(GitService, makeGitService(opts)),
          Layer.succeed(
            PromptService,
            makePromptService({
              calls: opts.calls,
              confirm: opts.confirm ?? true,
            })
          ),
          NodeContext.layer
        )
      ),
      Effect.exit
    );

  it.effect("cleans after the hard reset once confirmed", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];

      const exit = yield* run({
        calls,
        statusOutput: "?? src/leftover.ts",
      });

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(calls).toEqual([
        "confirm",
        "resetHard target-sha",
        "clean",
      ]);
    })
  );

  it.effect("does not clean when the user declines", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];

      const exit = yield* run({
        calls,
        statusOutput: "?? src/leftover.ts",
        confirm: false,
      });

      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toEqual(["confirm"]);
    })
  );

  it.effect("does not clean when the hard reset fails", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];

      const exit = yield* run({
        calls,
        statusOutput: "?? src/leftover.ts",
        resetHardFails: true,
      });

      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toEqual(["confirm", "resetHard target-sha"]);
    })
  );

  it.effect("does not clean when the tree is already clean", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];

      const exit = yield* run({ calls, statusOutput: "" });

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(calls).toEqual(["resetHard target-sha"]);
    })
  );

  it.effect(
    "asks applyAsUnstagedChanges to clean in --unstaged mode",
    () =>
      Effect.gen(function* () {
        const calls: Array<string> = [];

        const exit = yield* run({
          calls,
          statusOutput: "?? src/leftover.ts",
          unstaged: true,
        });

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(calls).toEqual([
          "confirm",
          "applyAsUnstagedChanges target-sha clean=true",
        ]);
      })
  );
});
