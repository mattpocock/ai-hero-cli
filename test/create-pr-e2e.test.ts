import {
  NodeContext,
  NodeFileSystem,
} from "@effect/platform-node";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runCreatePr,
  toPrCommitMessage,
} from "../src/create-pr.js";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import {
  GhNotAuthenticatedError,
  GitHubService,
  parseGitHubRemoteUrl,
} from "../src/github-service.js";
import {
  PromptCancelledError,
  PromptService,
} from "../src/prompt-service.js";
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

const ORIGIN_URL = "https://github.com/student/course.git";

const upstreamBareOf = (workingDir: string) =>
  path.resolve(workingDir, "..", "bare.git");

const originBareOf = (workingDir: string) =>
  path.resolve(workingDir, "..", "origin.git");

/** Refs on the student's origin, as `{ "refs/heads/x": sha }`. */
const originRefs = (workingDir: string) =>
  Object.fromEntries(
    git(originBareOf(workingDir), "for-each-ref", "--format=%(refname) %(objectname)")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ") as [string, string])
  );

type FakeGitHubCall =
  | {
      kind: "create";
      repo: string;
      base: string;
      head: string;
      title: string;
      body: string;
    }
  | {
      kind: "edit";
      repo: string;
      number: number;
      title: string;
      body: string;
      base: string;
    }
  | { kind: "draft"; repo: string; number: number };

/**
 * A GitHubService with no network: records every PR call and keeps a
 * single open PR in memory once one is created.
 */
const makeFakeGitHub = (
  opts: {
    authenticated?: boolean;
    openPr?: { number: number; url: string };
  } = {}
) => {
  const calls: Array<FakeGitHubCall> = [];
  let openPr = opts.openPr;

  const service = fromPartial<GitHubService>({
    ensureInstalled: Effect.fn("ensureInstalled")(function* () {}),
    ensureAuthenticated: Effect.fn("ensureAuthenticated")(
      function* () {
        if (opts.authenticated === false) {
          return yield* new GhNotAuthenticatedError({
            message: "gh not authenticated",
          });
        }
      }
    ),
    getAuthenticatedUser: Effect.fn("getAuthenticatedUser")(
      function* () {
        return "student";
      }
    ),
    ensureRepoAccessible: Effect.fn("ensureRepoAccessible")(
      function* () {}
    ),
    findOpenPullRequest: Effect.fn("findOpenPullRequest")(
      function* () {
        return openPr ? Option.some(openPr) : Option.none();
      }
    ),
    createDraftPullRequest: Effect.fn("createDraftPullRequest")(
      function* (args: {
        repo: string;
        base: string;
        head: string;
        title: string;
        body: string;
      }) {
        calls.push({ kind: "create", ...args });
        openPr = {
          number: 7,
          url: "https://github.com/student/course/pull/7",
        };
      }
    ),
    editPullRequest: Effect.fn("editPullRequest")(function* (args: {
      repo: string;
      number: number;
      title: string;
      body: string;
      base: string;
    }) {
      calls.push({ kind: "edit", ...args });
    }),
    markPullRequestAsDraft: Effect.fn("markPullRequestAsDraft")(
      function* (args: { repo: string; number: number }) {
        calls.push({ kind: "draft", ...args });
      }
    ),
  });

  return { service, calls };
};

const makeLayer = (
  workingDir: string,
  promptService: PromptService,
  githubService: GitHubService
) => {
  const deps = Layer.mergeAll(
    NodeFileSystem.layer,
    Layer.succeed(GitServiceConfig, { cwd: workingDir })
  );

  return Layer.mergeAll(
    Layer.effect(GitService, makeGitService).pipe(
      Layer.provide(deps)
    ),
    Layer.succeed(GitHubService, githubService),
    Layer.succeed(PromptService, promptService),
    NodeContext.layer
  );
};

const noPrompts = fromPartial<PromptService>({});

const confirmingPrompt = (onConfirm?: (message: string) => void) =>
  fromPartial<PromptService>({
    confirmContinue: Effect.fn("confirmContinue")(function* (
      message: string
    ) {
      onConfirm?.(message);
    }),
  });

/**
 * E2E tests for create-pr using real local git repositories: an
 * `upstream` bare repo carrying `main` + the `live-run-through` lesson
 * stack, and the student's `origin` — a second bare repo reached through
 * a github.com URL (rewritten locally via `url.<path>.insteadOf`), so the
 * GitHub-remote check runs for real. GitHubService and PromptService are
 * faked.
 */
describe("create-pr (e2e)", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const buildRepo = (opts: { originUrl?: string | null } = {}) => {
    const repo = createTestRepo()
      .withRemote("upstream")
      .withBranch("live-run-through", [
        commit("add-arrays: Arrays intro\n\nWhy arrays matter.", {
          "src/arrays.ts": "// arrays",
        }),
        commit("add-loops: Loops", {
          "src/loops.ts": "// loops",
          "src/arrays.ts": "// arrays, looped",
        }),
      ])
      .withWorkingBranch("my-branch", {
        from: "live-run-through",
        atCommit: 0,
      })
      .build();
    cleanup = repo.cleanup;

    const dir = repo.workingDir;

    // `main` is the commit the lesson stack grows from.
    const initial = git(dir, "rev-parse", "live-run-through~2");
    git(dir, "push", "upstream", `${initial}:refs/heads/main`);

    // The student's own GitHub repo.
    const originBare = originBareOf(dir);
    fs.mkdirSync(originBare);
    git(originBare, "init", "--bare");

    const originUrl =
      opts.originUrl === undefined ? ORIGIN_URL : opts.originUrl;
    if (originUrl !== null) {
      git(dir, "remote", "add", "origin", originUrl);
      git(dir, "config", `url.${originBare}.insteadOf`, ORIGIN_URL);
    }

    const sha = (ref: string) => git(dir, "rev-parse", ref);

    return {
      dir,
      initial,
      arrays: sha("live-run-through~1"),
      loops: sha("live-run-through"),
    };
  };

  const run = (
    dir: string,
    lessonId: string,
    prompts: PromptService,
    github: GitHubService
  ) =>
    runCreatePr({
      branch: "live-run-through",
      lessonId: Option.some(lessonId),
      upstream: upstreamBareOf(dir),
    }).pipe(Effect.provide(makeLayer(dir, prompts, github)));

  it.effect(
    "opens a draft PR whose base is main's tip when the lesson is the first on the stack",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub();

        const result = yield* run(
          repo.dir,
          "add-arrays",
          noPrompts,
          github.service
        );

        expect(result.prUrl).toBe(
          "https://github.com/student/course/pull/7"
        );

        // pr-base sits at the lesson's parent — here, main's tip.
        const refs = originRefs(repo.dir);
        expect(refs["refs/heads/pr-base/add-arrays"]).toBe(
          repo.initial
        );

        // pr/<slug> is exactly one commit on top of it, carrying the
        // lesson's tree, with the slug stripped from its message.
        const prSha = refs["refs/heads/pr/add-arrays"]!;
        expect(git(repo.dir, "rev-parse", `${prSha}^`)).toBe(
          repo.initial
        );
        expect(git(repo.dir, "rev-parse", `${prSha}^{tree}`)).toBe(
          git(repo.dir, "rev-parse", `${repo.arrays}^{tree}`)
        );
        expect(git(repo.dir, "log", "-1", "--format=%s", prSha)).toBe(
          "Arrays intro"
        );
        expect(git(repo.dir, "log", "-1", "--format=%b", prSha)).toBe(
          "Why arrays matter."
        );

        // The student is left on the PR branch, wired for gh.
        expect(git(repo.dir, "branch", "--show-current")).toBe(
          "pr/add-arrays"
        );
        expect(git(repo.dir, "rev-parse", "HEAD")).toBe(prSha);
        expect(
          git(repo.dir, "config", "branch.pr/add-arrays.gh-merge-base")
        ).toBe("pr-base/add-arrays");

        expect(github.calls).toEqual([
          {
            kind: "create",
            repo: "student/course",
            base: "pr-base/add-arrays",
            head: "pr/add-arrays",
            title: "Arrays intro",
            body: "Why arrays matter.",
          },
        ]);
      })
  );

  it.effect(
    "carries only the chosen lesson's diff for a lesson mid-stack",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub();

        yield* run(repo.dir, "add-loops", noPrompts, github.service);

        const refs = originRefs(repo.dir);
        expect(refs["refs/heads/pr-base/add-loops"]).toBe(repo.arrays);

        const prSha = refs["refs/heads/pr/add-loops"]!;
        expect(
          git(
            repo.dir,
            "diff",
            "--name-only",
            repo.arrays,
            prSha
          ).split("\n")
        ).toEqual(["src/arrays.ts", "src/loops.ts"]);
        expect(
          git(repo.dir, "rev-list", "--count", `${repo.arrays}..${prSha}`)
        ).toBe("1");
      })
  );

  it.effect(
    "never gives the PR commit a subject the lesson lookup could match",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub();

        yield* run(repo.dir, "add-arrays", noPrompts, github.service);

        const subjects = git(
          repo.dir,
          "log",
          "--format=%s",
          `${repo.initial}..pr/add-arrays`
        );
        expect(subjects).not.toContain("add-arrays:");
      })
  );

  it.effect(
    "fails without changing anything when the lesson isn't on the stack",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub();

        const error = yield* run(
          repo.dir,
          "no-such-lesson",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("CommitNotFoundError");
        expect(originRefs(repo.dir)).toEqual({});
        expect(git(repo.dir, "branch", "--show-current")).toBe(
          "my-branch"
        );
        expect(github.calls).toEqual([]);
      })
  );

  it.effect(
    "refuses to run with a dirty working tree",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub();
        fs.writeFileSync(
          path.join(repo.dir, "src/arrays.ts"),
          "// student's uncommitted work"
        );

        const error = yield* run(
          repo.dir,
          "add-arrays",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("DirtyWorkingTreeError");
        expect(originRefs(repo.dir)).toEqual({});
        expect(
          fs.readFileSync(path.join(repo.dir, "src/arrays.ts"), "utf-8")
        ).toBe("// student's uncommitted work");
      })
  );

  it.effect(
    "fails before changing anything when gh isn't authenticated",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub({ authenticated: false });

        const error = yield* run(
          repo.dir,
          "add-arrays",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("GhNotAuthenticatedError");
        expect(originRefs(repo.dir)).toEqual({});
      })
  );

  it.effect(
    "fails before changing anything when origin isn't a GitHub repo",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo({ originUrl: "/srv/git/course.git" });
        const github = makeFakeGitHub();

        const error = yield* run(
          repo.dir,
          "add-arrays",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("NotAGitHubRemoteError");
        expect(git(repo.dir, "branch", "--show-current")).toBe(
          "my-branch"
        );
      })
  );

  it.effect(
    "fails before changing anything when there is no origin remote",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo({ originUrl: null });
        const github = makeFakeGitHub();

        const error = yield* run(
          repo.dir,
          "add-arrays",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("NotAGitHubRemoteError");
      })
  );

  it.effect(
    "fails before pushing anything when the lesson id can't be a branch name",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        // A lesson id is whatever precedes the first ": " — spaces too.
        git(repo.dir, "checkout", "-q", "live-run-through");
        fs.writeFileSync(path.join(repo.dir, "src/wip.ts"), "// wip");
        git(repo.dir, "add", ".");
        git(repo.dir, "commit", "-q", "-m", "WIP thing: half done");
        git(
          repo.dir,
          "push",
          "-q",
          "upstream",
          "live-run-through"
        );
        git(repo.dir, "checkout", "-q", "my-branch");
        const github = makeFakeGitHub();

        const error = yield* run(
          repo.dir,
          "WIP thing",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("InvalidBranchOperationError");
        expect(originRefs(repo.dir)).toEqual({});
      })
  );

  it.effect(
    "refuses to run on the live-run-through branch",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        git(repo.dir, "checkout", "live-run-through");
        const github = makeFakeGitHub();

        const error = yield* run(
          repo.dir,
          "add-arrays",
          noPrompts,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("InvalidBranchOperationError");
        expect(originRefs(repo.dir)).toEqual({});
      })
  );

  it.effect(
    "a retake after the stack is rewritten force-updates both branches and refreshes the open PR",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const github = makeFakeGitHub();

        yield* run(repo.dir, "add-arrays", noPrompts, github.service);

        // The maintainer rewrites the course: main and the lesson both
        // get new shas.
        const upstreamBare = upstreamBareOf(repo.dir);
        const newMain = git(
          repo.dir,
          "commit-tree",
          `${repo.initial}^{tree}`,
          "-m",
          "initial (rewritten)"
        );
        const newArrays = git(
          repo.dir,
          "commit-tree",
          `${repo.arrays}^{tree}`,
          "-p",
          newMain,
          "-m",
          "add-arrays: Arrays intro, take two\n\nNew body."
        );
        git(repo.dir, "push", "--force", upstreamBare, `${newMain}:refs/heads/main`);
        git(
          repo.dir,
          "push",
          "--force",
          upstreamBare,
          `${newArrays}:refs/heads/live-run-through`
        );

        const confirmations: Array<string> = [];
        yield* run(
          repo.dir,
          "add-arrays",
          confirmingPrompt((m) => confirmations.push(m)),
          github.service
        );

        // pr/add-arrays already existed locally, so the student was asked.
        expect(confirmations).toHaveLength(1);
        expect(confirmations[0]).toContain('"pr/add-arrays"');

        const refs = originRefs(repo.dir);
        expect(refs["refs/heads/pr-base/add-arrays"]).toBe(newMain);
        const prSha = refs["refs/heads/pr/add-arrays"]!;
        expect(git(repo.dir, "rev-parse", `${prSha}^`)).toBe(newMain);
        expect(git(repo.dir, "rev-parse", "HEAD")).toBe(prSha);

        // The existing PR was reset, not duplicated.
        expect(github.calls.slice(1)).toEqual([
          {
            kind: "edit",
            repo: "student/course",
            number: 7,
            title: "Arrays intro, take two",
            body: "New body.",
            base: "pr-base/add-arrays",
          },
          { kind: "draft", repo: "student/course", number: 7 },
        ]);
      })
  );

  it.effect(
    "leaves everything alone when the student declines to replace an existing pr branch",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        git(repo.dir, "branch", "pr/add-arrays", repo.loops);
        const github = makeFakeGitHub();

        const decline = fromPartial<PromptService>({
          confirmContinue: Effect.fn("confirmContinue")(function* () {
            return yield* new PromptCancelledError();
          }),
        });

        const error = yield* run(
          repo.dir,
          "add-arrays",
          decline,
          github.service
        ).pipe(Effect.flip);

        expect(error._tag).toBe("PromptCancelledError");
        expect(originRefs(repo.dir)).toEqual({});
        expect(git(repo.dir, "rev-parse", "pr/add-arrays")).toBe(
          repo.loops
        );
        expect(git(repo.dir, "branch", "--show-current")).toBe(
          "my-branch"
        );
      })
  );
});

describe("toPrCommitMessage", () => {
  it("strips the lesson id and keeps the body", () => {
    expect(
      toPrCommitMessage("add-x", "add-x: Add X\n\nBecause.\n")
    ).toEqual({
      message: "Add X\n\nBecause.",
      title: "Add X",
      body: "Because.",
    });
  });

  it("strips a repeated prefix so the lesson id can't survive", () => {
    expect(
      toPrCommitMessage("add-x", "add-x: add-x: Add X").title
    ).toBe("Add X");
  });

  it("leaves another token-before-colon alone", () => {
    expect(
      toPrCommitMessage("add-x", "add-x: fix: the thing").title
    ).toBe("fix: the thing");
  });

  it("falls back to the bare lesson id when nothing follows the prefix", () => {
    expect(toPrCommitMessage("add-x", "add-x: add-x:")).toEqual({
      message: "add-x",
      title: "add-x",
      body: "",
    });
  });
});

describe("parseGitHubRemoteUrl", () => {
  it.each([
    ["https://github.com/student/course.git", "student/course"],
    ["https://github.com/student/course", "student/course"],
    ["https://user@github.com/student/course.git", "student/course"],
    ["git@github.com:student/course.git", "student/course"],
    ["ssh://git@github.com/student/course.git", "student/course"],
    ["git@ghe.example.com:org/course.git", "ghe.example.com/org/course"],
  ])("%s -> %s", (url, expected) => {
    expect(parseGitHubRemoteUrl(url)).toBe(expected);
  });

  it.each([
    "/srv/git/course.git",
    "../course.git",
    "C:/repos/course",
    "file:///srv/git/course.git",
  ])("rejects %s", (url) => {
    expect(parseGitHubRemoteUrl(url)).toBeNull();
  });
});
