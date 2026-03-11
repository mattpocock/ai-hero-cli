import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  commit,
  createTestRepo,
} from "./helpers/create-test-repo.js";

const git = (cwd: string, ...args: Array<string>) =>
  execSync(`git ${args.join(" ")}`, {
    cwd,
    stdio: "pipe",
  })
    .toString()
    .trim();

describe("createTestRepo", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("creates a repo with correct branches", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("01.01 - Arrays (problem)", {
          "src/01.ts": "// problem",
        }),
        commit("01.01 - Arrays (solution)", {
          "src/01.ts": "// solution",
        }),
      ])
      .build();

    cleanup = repo.cleanup;

    // Verify it's a git repo
    expect(
      fs.existsSync(`${repo.workingDir}/.git`)
    ).toBe(true);

    // Verify current branch is main
    const currentBranch = git(
      repo.workingDir,
      "branch",
      "--show-current"
    );
    expect(currentBranch).toBe("main");

    // Verify commit messages
    const log = git(
      repo.workingDir,
      "log",
      "--oneline",
      "--reverse"
    );
    const lines = log.split("\n");
    // initial commit + 2 lesson commits
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(
      "01.01 - Arrays (problem)"
    );
    expect(lines[2]).toContain(
      "01.01 - Arrays (solution)"
    );
  });

  it("creates files with correct contents", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("01.01 - Arrays (problem)", {
          "src/01.ts": "// problem code",
        }),
        commit("01.01 - Arrays (solution)", {
          "src/01.ts": "// solution code",
        }),
      ])
      .build();

    cleanup = repo.cleanup;

    // File should have the solution content (latest commit)
    const content = fs.readFileSync(
      `${repo.workingDir}/src/01.ts`,
      "utf-8"
    );
    expect(content).toBe("// solution code");
  });

  it("configures the remote and branches are fetchable", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("01.01 - Lesson", {
          "file.ts": "content",
        }),
      ])
      .build();

    cleanup = repo.cleanup;

    // Verify remote exists
    const remotes = git(
      repo.workingDir,
      "remote",
      "-v"
    );
    expect(remotes).toContain("upstream");

    // Verify branch is fetchable
    expect(() => {
      git(
        repo.workingDir,
        "fetch",
        "upstream",
        "main"
      );
    }).not.toThrow();
  });

  it("creates working branches at the right commit", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("01.01 - Arrays (problem)", {
          "src/01.ts": "// problem",
        }),
        commit("01.01 - Arrays (solution)", {
          "src/01.ts": "// solution",
        }),
        commit("02.01 - Objects (problem)", {
          "src/02.ts": "// problem",
        }),
      ])
      .withWorkingBranch("my-branch", {
        from: "main",
        atCommit: 0,
      })
      .build();

    cleanup = repo.cleanup;

    // Current branch should be the working branch
    const currentBranch = git(
      repo.workingDir,
      "branch",
      "--show-current"
    );
    expect(currentBranch).toBe("my-branch");

    // Should be at the first commit (problem), so file should have problem content
    const content = fs.readFileSync(
      `${repo.workingDir}/src/01.ts`,
      "utf-8"
    );
    expect(content).toBe("// problem");

    // src/02.ts should not exist (commit 2 is ahead)
    expect(
      fs.existsSync(`${repo.workingDir}/src/02.ts`)
    ).toBe(false);
  });

  it("supports multiple branches", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("01.01 - Lesson A", {
          "a.ts": "content-a",
        }),
      ])
      .withBranch("live-run-through", [
        commit("02.01 - Lesson B", {
          "b.ts": "content-b",
        }),
      ])
      .build();

    cleanup = repo.cleanup;

    // Both branches should exist
    const branches = git(
      repo.workingDir,
      "branch",
      "-a"
    );
    expect(branches).toContain("main");
    expect(branches).toContain("live-run-through");

    // Both branches should be on the remote
    expect(branches).toContain(
      "remotes/upstream/main"
    );
    expect(branches).toContain(
      "remotes/upstream/live-run-through"
    );
  });

  it("produces commits parseable by lesson ID regex", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("01.02.03 Setup arrays", {
          "file.ts": "content",
        }),
      ])
      .build();

    cleanup = repo.cleanup;

    const log = git(
      repo.workingDir,
      "log",
      "--oneline",
      "--reverse"
    );
    const lines = log.split("\n");
    // Skip the initial commit (line 0), get lesson commit (line 1)
    const lessonLine = lines[1]!;
    const message = lessonLine
      .split(" ")
      .slice(1)
      .join(" ");
    // The parseCommits regex: /^(\d+)[.-](\d+)[.-](\d+)\s*/
    const match = message.match(
      /^(\d+)[.-](\d+)[.-](\d+)\s*/
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("01");
    expect(match![2]).toBe("02");
    expect(match![3]).toBe("03");
  });

  it("cleans up temp directories", () => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("main", [
        commit("Lesson", { "f.ts": "x" }),
      ])
      .build();

    const dir = repo.workingDir;
    expect(fs.existsSync(dir)).toBe(true);

    repo.cleanup();
    // workingDir's parent (tmpRoot) should be removed
    const tmpRoot = dir.replace(/\/work$/, "");
    expect(fs.existsSync(tmpRoot)).toBe(false);
  });
});
