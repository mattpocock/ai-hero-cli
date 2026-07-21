import { NodeContext, NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type BranchCommit,
  resolveCommitRef,
} from "../src/branch-commits.js";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import {
  applyToLiveBranch,
  beginSession,
  filesWithMarkers,
  finish,
  loadCommits,
  publish,
  recompose,
  resumeCherryPick,
  unwind,
} from "../src/internal/edit-commit/session.js";
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

/** Resolve a lesson ref and park its diff in the working tree. */
const startSession = (ref: string) =>
  Effect.gen(function* () {
    const commits = yield* loadCommits({
      branch: "live-run-through",
      mainBranch: "main",
    });
    const target = resolveCommitRef(commits, ref)!;
    expect(target).toBeDefined();

    return yield* beginSession({
      commits,
      target,
      liveBranch: "live-run-through",
    });
  });

const bareDirOf = (workingDir: string) =>
  path.resolve(workingDir, "..", "bare.git");

/**
 * Integration tests for the interactive edit-commit's git layer. Uses a real
 * GitService against a real temp repo + bare remote — the prompts sit above
 * these functions and are not exercised here.
 */
describe("edit-commit session", () => {
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
        commit("add-first: First", { "a.txt": "first" }),
        commit("add-second: Second", { "b.txt": "second" }),
        commit("add-third: Third", { "c.txt": "third" }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  /**
   * A course-repo shaped stack: one filled-in lesson followed by empty
   * placeholder commits that carry only a slug + subject.
   */
  const makePlaceholderRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("add-first: First", { "a.txt": "first" }),
        commit("add-second: Second", {}),
        commit("add-third: Third", {}),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  const makeConflictingRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("base", { "base.txt": "base" }),
      ])
      .withBranch("live-run-through", [
        commit("add-first: First", { "shared.txt": "v1\n" }),
        commit("add-second: Second", { "shared.txt": "v2\n" }),
        commit("add-third: Third", { "shared.txt": "v3\n" }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
  };

  it.effect(
    "beginSession parks the target's diff in the working tree on a temp branch",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(makeLayer(repo.workingDir)));

        expect(session.target.message).toBe(
          "add-second: Second"
        );
        expect(session.target.lessonId).toBe("add-second");
        // One commit follows add-second on the live branch.
        expect(session.following).toBe(1);
        expect(session.originalBranch).toBe("main");

        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toMatch(/^matt\/edit-commit-/);

        // The target introduced b.txt, so it should now be uncommitted, and
        // HEAD should be its parent (which introduced a.txt).
        expect(
          git(repo.workingDir, "status", "--short")
        ).toContain("b.txt");
        expect(
          git(repo.workingDir, "log", "-1", "--format=%s")
        ).toBe("add-first: First");
      })
  );

  it.effect(
    "recompose re-authors the commit with its original subject and replays the rest",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));

        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );

        const result = yield* recompose(session).pipe(
          Effect.provide(layer)
        );
        expect(result.conflict).toBe(false);

        const messages = git(
          repo.workingDir,
          "log",
          "--format=%s",
          "main..HEAD"
        ).split("\n");
        // Newest first: the stack is intact and the subject is unchanged.
        expect(messages).toEqual([
          "add-third: Third",
          "add-second: Second",
          "add-first: First",
        ]);

        // The edit landed in the re-authored commit, not a new one.
        const editedAtSecond = git(
          repo.workingDir,
          "show",
          "HEAD~1:b.txt"
        );
        expect(editedAtSecond).toBe("second-EDITED");

        // The following commit still applies on top.
        expect(
          git(repo.workingDir, "show", "HEAD:c.txt")
        ).toBe("third");
      })
  );

  it.effect(
    "recompose replays following empty placeholder commits instead of stalling on them",
    () =>
      Effect.gen(function* () {
        const repo = makePlaceholderRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession("add-first").pipe(
          Effect.provide(layer)
        );

        fs.writeFileSync(
          path.join(repo.workingDir, "a.txt"),
          "first-EDITED"
        );

        const result = yield* recompose(session).pipe(
          Effect.provide(layer)
        );
        expect(result.conflict).toBe(false);

        // The placeholders survive the replay, in order.
        const messages = git(
          repo.workingDir,
          "log",
          "--format=%s",
          "main..HEAD"
        ).split("\n");
        expect(messages).toEqual([
          "add-third: Third",
          "add-second: Second",
          "add-first: First",
        ]);

        // And they're still empty.
        for (const ref of ["HEAD~1", "HEAD"]) {
          expect(
            git(
              repo.workingDir,
              "diff",
              "--name-only",
              `${ref}^`,
              ref
            )
          ).toBe("");
        }
      })
  );

  it.effect(
    "recompose re-authors an empty placeholder target the user left empty",
    () =>
      Effect.gen(function* () {
        const repo = makePlaceholderRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession("add-second").pipe(
          Effect.provide(layer)
        );

        // The user decides there's nothing to add to this lesson yet, so
        // the working tree is left exactly as it was found.
        const result = yield* recompose(session).pipe(
          Effect.provide(layer)
        );
        expect(result.conflict).toBe(false);

        const messages = git(
          repo.workingDir,
          "log",
          "--format=%s",
          "main..HEAD"
        ).split("\n");
        expect(messages).toEqual([
          "add-third: Third",
          "add-second: Second",
          "add-first: First",
        ]);
      })
  );

  it.effect(
    "recompose reports a conflict when the replay collides",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));

        fs.writeFileSync(
          path.join(repo.workingDir, "shared.txt"),
          "v2-EDITED\n"
        );

        const result = yield* recompose(session).pipe(
          Effect.provide(layer)
        );

        expect(result.conflict).toBe(true);
        expect(
          git(repo.workingDir, "status", "--short")
        ).toContain("shared.txt");
      })
  );

  it.effect(
    "filesWithMarkers reports unresolved files and clears once they're fixed",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));
        fs.writeFileSync(
          path.join(repo.workingDir, "shared.txt"),
          "v2-EDITED\n"
        );
        yield* recompose(session).pipe(Effect.provide(layer));

        // Conflict markers are still in the file.
        const stillMarked = yield* filesWithMarkers.pipe(
          Effect.provide(layer)
        );
        expect(stillMarked).toEqual(["shared.txt"]);

        // Resolve, and the guard clears.
        fs.writeFileSync(
          path.join(repo.workingDir, "shared.txt"),
          "v3-resolved\n"
        );
        const afterFix = yield* filesWithMarkers.pipe(
          Effect.provide(layer)
        );
        expect(afterFix).toEqual([]);

        const result = yield* resumeCherryPick.pipe(
          Effect.provide(layer)
        );
        expect(result.conflict).toBe(false);

        const messages = git(
          repo.workingDir,
          "log",
          "--format=%s",
          "main..HEAD"
        ).split("\n");
        expect(messages).toEqual([
          "add-third: Third",
          "add-second: Second",
          "add-first: First",
        ]);
      })
  );

  it.effect(
    "applyToLiveBranch + publish force-pushes the recomposition and finish cleans up",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));
        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );
        yield* recompose(session).pipe(Effect.provide(layer));

        const recomposed = git(
          repo.workingDir,
          "rev-parse",
          "HEAD"
        );

        yield* applyToLiveBranch(session).pipe(
          Effect.provide(layer)
        );
        yield* publish(session).pipe(Effect.provide(layer));

        expect(
          git(
            bareDirOf(repo.workingDir),
            "rev-parse",
            "live-run-through"
          )
        ).toBe(recomposed);

        yield* finish(session).pipe(Effect.provide(layer));

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
      })
  );

  it.effect(
    "publish fails rather than clobbering when origin has moved",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));
        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );
        yield* recompose(session).pipe(Effect.provide(layer));
        yield* applyToLiveBranch(session).pipe(
          Effect.provide(layer)
        );

        // Someone else pushes to live-run-through from another clone, so our
        // force-with-lease is now stale.
        const bare = bareDirOf(repo.workingDir);
        const clone = path.resolve(
          repo.workingDir,
          "..",
          "other-clone"
        );
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

        const exit = yield* publish(session).pipe(
          Effect.provide(layer),
          Effect.exit
        );
        expect(exit._tag).toBe("Failure");

        // The intruder's commit is still the remote tip.
        expect(
          git(bare, "log", "-1", "--format=%s", "live-run-through")
        ).toBe("intruder");
      })
  );

  it.effect(
    "unwind discards the working tree, restores the original branch and deletes the temp branch",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));

        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );
        fs.writeFileSync(
          path.join(repo.workingDir, "untracked.txt"),
          "scratch"
        );

        const { discardedFiles } = yield* unwind(session, {
          midCherryPick: false,
          liveBranchMoved: false,
          keepTempBranch: false,
        }).pipe(Effect.provide(layer));

        expect(discardedFiles).toContain("b.txt");
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
        // `clean` removed the untracked scratch file too.
        expect(
          fs.existsSync(
            path.join(repo.workingDir, "untracked.txt")
          )
        ).toBe(false);
      })
  );

  it.effect(
    "unwind keeps the temp branch when the edits are already committed",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));
        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );
        yield* recompose(session).pipe(Effect.provide(layer));

        yield* unwind(session, {
          midCherryPick: false,
          liveBranchMoved: false,
          keepTempBranch: true,
        }).pipe(Effect.provide(layer));

        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
        // The recomposed work is still reachable.
        expect(
          git(
            repo.workingDir,
            "branch",
            "--list",
            "matt/edit-commit-*"
          )
        ).toContain("matt/edit-commit-");
        expect(
          git(
            repo.workingDir,
            "show",
            `${session.tempBranch}~1:b.txt`
          )
        ).toBe("second-EDITED");
      })
  );

  it.effect(
    "unwind puts the live branch back when it has already been moved",
    () =>
      Effect.gen(function* () {
        const repo = makeRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));
        fs.writeFileSync(
          path.join(repo.workingDir, "b.txt"),
          "second-EDITED"
        );
        yield* recompose(session).pipe(Effect.provide(layer));
        yield* applyToLiveBranch(session).pipe(
          Effect.provide(layer)
        );

        yield* unwind(session, {
          midCherryPick: false,
          liveBranchMoved: true,
          keepTempBranch: true,
        }).pipe(Effect.provide(layer));

        // The live branch is back at the tip it had before the session.
        expect(
          git(
            repo.workingDir,
            "rev-parse",
            "live-run-through"
          )
        ).toBe(session.targetBranchHead);
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
      })
  );

  it.effect(
    "unwind aborts an in-flight cherry-pick before restoring",
    () =>
      Effect.gen(function* () {
        const repo = makeConflictingRepo();
        const layer = makeLayer(repo.workingDir);

        const session = yield* startSession(
          "add-second"
        ).pipe(Effect.provide(layer));
        fs.writeFileSync(
          path.join(repo.workingDir, "shared.txt"),
          "v2-EDITED\n"
        );
        const result = yield* recompose(session).pipe(
          Effect.provide(layer)
        );
        expect(result.conflict).toBe(true);

        yield* unwind(session, {
          midCherryPick: true,
          liveBranchMoved: false,
          keepTempBranch: false,
        }).pipe(Effect.provide(layer));

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

describe("resolveCommitRef", () => {
  const make = (
    sequence: number,
    lessonId: string | null,
    sha: string
  ): BranchCommit => ({
    sha,
    message: lessonId ? `${lessonId}: Lesson` : "no lesson",
    lessonId,
    description: "Lesson",
    sequence,
  });

  const commits = [
    make(1, "add-first", "aaa1111"),
    make(2, "06.06.01", "bbb2222"),
    make(3, "add-third", "ccc3333"),
  ];

  it("resolves a slug lesson id", () => {
    expect(resolveCommitRef(commits, "add-third")?.sha).toBe(
      "ccc3333"
    );
  });

  it("normalises a numeric lesson id", () => {
    expect(resolveCommitRef(commits, "6.6.1")?.sha).toBe(
      "bbb2222"
    );
  });

  it("resolves a SHA prefix", () => {
    expect(resolveCommitRef(commits, "aaa")?.sha).toBe(
      "aaa1111"
    );
  });

  it("returns undefined for an unknown ref", () => {
    expect(
      resolveCommitRef(commits, "nope")
    ).toBeUndefined();
  });

  it("resolves a duplicated lesson id to the latest commit", () => {
    const withDuplicate = [
      ...commits,
      make(4, "add-first", "ddd4444"),
    ];
    expect(
      resolveCommitRef(withDuplicate, "add-first")?.sha
    ).toBe("ddd4444");
  });

  it("does not treat a positional index as an identifier", () => {
    // "2" was the old positional selector; it must no longer match anything.
    expect(resolveCommitRef(commits, "2")).toBeUndefined();
  });
});
