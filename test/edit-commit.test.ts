import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import {
  runAbort,
  runBegin,
  runContinue,
  runPublish,
  runStatus,
} from "../src/internal/edit-commit/run.js";
import { stateFilePath } from "../src/internal/edit-commit/state.js";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  })
    .toString()
    .trim();

const makeLayer = (workingDir: string) => {
  const deps = Layer.mergeAll(
    NodeFileSystem.layer,
    Layer.succeed(GitServiceConfig, { cwd: workingDir })
  );

  return Layer.mergeAll(
    Layer.effect(GitService, makeGitService).pipe(
      Layer.provide(deps)
    ),
    NodeFileSystem.layer,
    Layer.succeed(GitServiceConfig, { cwd: workingDir }),
    NodeContext.layer
  );
};

/**
 * Integration tests for the agent-driven edit-commit state machine.
 * Uses a real GitService against a real temp repo + bare remote.
 */
describe("edit-commit begin", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const makeRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("01.01 - First", { "a.txt": "first" }),
        commit("01.02 - Second", { "b.txt": "second" }),
        commit("01.03 - Third", { "c.txt": "third" }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  it.effect(
    "opens an editing session with the target commit's diff as the unstaged working tree",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();

        const envelope = yield* runBegin({
          commit: "2",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(makeLayer(repo.workingDir)));

        // Envelope describes the targeted commit
        expect(envelope.phase).toBe("editing");
        expect(envelope.target.sequence).toBe(2);
        expect(envelope.target.message).toBe("01.02 - Second");
        // One commit follows #2 on the live branch (#3)
        expect(envelope.following).toBe(1);

        // We are parked on a temp branch, not the original branch
        const branch = git(
          repo.workingDir,
          "branch",
          "--show-current"
        );
        expect(branch).toMatch(/^matt\/edit-commit-/);

        // The target commit (#2) introduced b.txt — it should now be
        // sitting in the working tree as an uncommitted change, and HEAD
        // should be the target's parent (#1), which introduced a.txt.
        const status = git(
          repo.workingDir,
          "status",
          "--short"
        );
        expect(status).toContain("b.txt");

        const headMessage = git(
          repo.workingDir,
          "log",
          "-1",
          "--format=%s"
        );
        expect(headMessage).toBe("01.01 - First");
      })
  );

  it.effect(
    "continue folds the agent's edit into the re-authored commit and replays the following commits",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        yield* runBegin({
          commit: "2",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer));

        // Agent edits the working tree: change the content the target
        // commit (#2) introduced.
        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );

        const envelope = yield* runContinue().pipe(
          Effect.provide(layer)
        );

        expect(envelope.phase).toBe("ready");
        expect(envelope.conflictedFiles).toEqual([]);

        // The branch still has the same three commits, same messages,
        // same order.
        const messages = git(
          repo.workingDir,
          "log",
          "--format=%s",
          "--reverse",
          "main..HEAD"
        ).split("\n");
        expect(messages).toEqual([
          "01.01 - First",
          "01.02 - Second",
          "01.03 - Third",
        ]);

        // The edit landed in commit #2 specifically (HEAD~1), not the tip.
        const editedAtSecond = git(
          repo.workingDir,
          "show",
          "HEAD~1:b.txt"
        );
        expect(editedAtSecond).toBe("second-EDITED");

        // The following commit (#3) is intact.
        const third = git(
          repo.workingDir,
          "show",
          "HEAD:c.txt"
        );
        expect(third).toBe("third");
      })
  );

  const makeConflictingRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("01.01 - First", { "shared.txt": "v1\n" }),
        commit("01.02 - Second", { "shared.txt": "v2\n" }),
        commit("01.03 - Third", { "shared.txt": "v3\n" }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  it.effect(
    "continue stops at the conflict phase and names the conflicted files when a following commit conflicts",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = makeLayer(repo.workingDir);

        yield* runBegin({
          commit: "2",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer));

        // Agent re-writes the line the target (#2) owns. Cherry-picking #3
        // (which also edits that line, based on the original #2) will
        // conflict against the agent's new content.
        fs.writeFileSync(
          path.join(repo.workingDir, "shared.txt"),
          "v2-EDITED\n"
        );

        const envelope = yield* runContinue().pipe(
          Effect.provide(layer)
        );

        expect(envelope.phase).toBe("conflict");
        expect(envelope.conflictedFiles).toEqual([
          "shared.txt",
        ]);

        // Git really is mid-cherry-pick with an unmerged path.
        const status = git(
          repo.workingDir,
          "status",
          "--short"
        );
        expect(status).toContain("UU shared.txt");
      })
  );

  const driveToConflict = (repo: {
    workingDir: string;
  }) => {
    const layer = makeLayer(repo.workingDir);
    return Effect.gen(function* () {
      yield* runBegin({
        commit: "2",
        branch: "live-run-through",
        mainBranch: "main",
      }).pipe(Effect.provide(layer));
      fs.writeFileSync(
        path.join(repo.workingDir, "shared.txt"),
        "v2-EDITED\n"
      );
      yield* runContinue().pipe(Effect.provide(layer));
      return layer;
    });
  };

  it.effect(
    "continue refuses while conflict markers remain",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = yield* driveToConflict(repo);

        // Do NOT resolve — the file still has conflict markers.
        const error = yield* runContinue().pipe(
          Effect.provide(layer),
          Effect.flip
        );

        expect(error._tag).toBe("UnresolvedConflictsError");
        if (error._tag === "UnresolvedConflictsError") {
          expect(error.files).toEqual(["shared.txt"]);
        }
      })
  );

  it.effect(
    "continue completes the cherry-pick once the conflict is resolved",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = yield* driveToConflict(repo);

        // Agent resolves the conflict: remove markers, pick final content.
        fs.writeFileSync(
          path.join(repo.workingDir, "shared.txt"),
          "v3-resolved\n"
        );

        const envelope = yield* runContinue().pipe(
          Effect.provide(layer)
        );

        expect(envelope.phase).toBe("ready");

        const messages = git(
          repo.workingDir,
          "log",
          "--format=%s",
          "--reverse",
          "main..HEAD"
        ).split("\n");
        expect(messages).toEqual([
          "01.01 - First",
          "01.02 - Second",
          "01.03 - Third",
        ]);

        const tip = git(
          repo.workingDir,
          "show",
          "HEAD:shared.txt"
        );
        expect(tip).toBe("v3-resolved");
      })
  );

  const bareDirOf = (workingDir: string) =>
    path.resolve(workingDir, "..", "bare.git");

  // Move origin's live-run-through from a *different* clone, so the local
  // force-with-lease becomes stale.
  const moveOrigin = (workingDir: string) => {
    const bare = bareDirOf(workingDir);
    const clone = path.resolve(workingDir, "..", "other-clone");
    fs.mkdirSync(clone);
    git(clone, "clone", bare, ".");
    git(clone, "checkout", "live-run-through");
    fs.writeFileSync(
      path.join(clone, "intruder.txt"),
      "sneaky"
    );
    git(clone, "add", ".");
    git(clone, "commit", "-m", "intruder");
    git(clone, "push", "origin", "live-run-through");
  };

  const driveToReady = (repo: { workingDir: string }) => {
    const layer = makeLayer(repo.workingDir);
    return Effect.gen(function* () {
      yield* runBegin({
        commit: "2",
        branch: "live-run-through",
        mainBranch: "main",
      }).pipe(Effect.provide(layer));
      fs.writeFileSync(
        path.join(repo.workingDir, "b.txt"),
        "second-EDITED"
      );
      yield* runContinue().pipe(Effect.provide(layer));
      return layer;
    });
  };

  it.effect(
    "publish force-pushes the recomposed branch to origin and cleans up",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = yield* driveToReady(repo);

        const recomposed = git(
          repo.workingDir,
          "rev-parse",
          "HEAD"
        );

        const envelope = yield* runPublish().pipe(
          Effect.provide(layer)
        );

        expect(envelope.phase).toBe("published");

        // Origin's live-run-through now points at the recomposed tip.
        const remoteTip = git(
          bareDirOf(repo.workingDir),
          "rev-parse",
          "live-run-through"
        );
        expect(remoteTip).toBe(recomposed);

        // Back on the original branch, temp branch gone, state cleared.
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
        expect(
          git(
            repo.workingDir,
            "branch",
            "--list",
            "matt/edit-commit-*"
          )
        ).toBe("");
        expect(
          fs.existsSync(stateFilePath(repo.workingDir))
        ).toBe(false);
      })
  );

  it.effect(
    "publish fails with LeaseRejectedError when origin has moved",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = yield* driveToReady(repo);

        moveOrigin(repo.workingDir);

        const error = yield* runPublish().pipe(
          Effect.provide(layer),
          Effect.flip
        );

        expect(error._tag).toBe("LeaseRejectedError");
      })
  );

  it.effect(
    "publish is re-runnable: after a rejected lease, re-fetching and retrying succeeds",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = yield* driveToReady(repo);

        const recomposed = git(
          repo.workingDir,
          "rev-parse",
          "HEAD"
        );

        // First attempt: origin moved -> rejected.
        moveOrigin(repo.workingDir);
        const error = yield* runPublish().pipe(
          Effect.provide(layer),
          Effect.flip
        );
        expect(error._tag).toBe("LeaseRejectedError");

        // Agent re-fetches to refresh the lease, then retries the same verb.
        git(repo.workingDir, "fetch", "origin");
        const envelope = yield* runPublish().pipe(
          Effect.provide(layer)
        );

        expect(envelope.phase).toBe("published");
        expect(
          git(
            bareDirOf(repo.workingDir),
            "rev-parse",
            "live-run-through"
          )
        ).toBe(recomposed);
      })
  );

  it.effect(
    "begin refuses when a session already exists",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        yield* runBegin({
          commit: "2",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer));

        const error = yield* runBegin({
          commit: "3",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer), Effect.flip);

        expect(error._tag).toBe("SessionExistsError");
        if (error._tag === "SessionExistsError") {
          expect(error.phase).toBe("editing");
        }
      })
  );

  it.effect(
    "begin rejects a commit reference that matches nothing",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const error = yield* runBegin({
          commit: "99",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer), Effect.flip);

        expect(error._tag).toBe("CommitNotFoundError");

        // It bailed before stranding a temp branch.
        expect(
          git(
            repo.workingDir,
            "branch",
            "--list",
            "matt/edit-commit-*"
          )
        ).toBe("");
      })
  );

  it.effect(
    "status reports the current phase without mutating the repo",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        yield* runBegin({
          commit: "2",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer));

        const branchBefore = git(
          repo.workingDir,
          "branch",
          "--show-current"
        );

        const envelope = yield* runStatus().pipe(
          Effect.provide(layer)
        );

        expect(envelope.phase).toBe("editing");
        expect(envelope.target.sequence).toBe(2);

        // status is read-only: same branch, still mid-edit.
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe(branchBefore);
      })
  );

  it.effect(
    "status fails with NoSessionError when nothing is in progress",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const error = yield* runStatus().pipe(
          Effect.provide(layer),
          Effect.flip
        );

        expect(error._tag).toBe("NoSessionError");
      })
  );

  it.effect(
    "continue fails with NoSessionError when nothing is in progress",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const error = yield* runContinue().pipe(
          Effect.provide(layer),
          Effect.flip
        );

        expect(error._tag).toBe("NoSessionError");
      })
  );

  it.effect(
    "abort from editing restores the original branch clean and reports the discarded edits",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        yield* runBegin({
          commit: "2",
          branch: "live-run-through",
          mainBranch: "main",
        }).pipe(Effect.provide(layer));

        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );

        const result = yield* runAbort().pipe(
          Effect.provide(layer)
        );

        expect(result.restoredBranch).toBe("main");
        expect(result.discardedFiles).toContain("b.txt");

        // Back on main with a clean tree.
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
        expect(
          git(repo.workingDir, "status", "--short")
        ).toBe("");
        // Temp branch and state gone.
        expect(
          git(
            repo.workingDir,
            "branch",
            "--list",
            "matt/edit-commit-*"
          )
        ).toBe("");
        expect(
          fs.existsSync(stateFilePath(repo.workingDir))
        ).toBe(false);
      })
  );

  it.effect(
    "abort from a conflict aborts the cherry-pick and restores the original branch",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = yield* driveToConflict(repo);

        const result = yield* runAbort().pipe(
          Effect.provide(layer)
        );

        expect(result.restoredBranch).toBe("main");

        // No cherry-pick in progress, clean tree, back on main.
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
        expect(
          git(repo.workingDir, "status", "--short")
        ).toBe("");
        expect(
          git(
            repo.workingDir,
            "branch",
            "--list",
            "matt/edit-commit-*"
          )
        ).toBe("");
      })
  );
});
