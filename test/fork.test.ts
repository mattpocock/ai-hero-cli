import {
  NodeContext,
  NodeFileSystem,
} from "@effect/platform-node";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runFork, sanitizeRepoName } from "../src/fork.js";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import {
  FailedToCreateRepoError,
  GhNotAuthenticatedError,
  GhNotInstalledError,
  GitHubService,
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

/**
 * E2E tests for the fork command.
 *
 * Uses the REAL GitService against a temp clone of a course repo, with
 * a FAKE GitHubService (no network) whose `createRepoFromCwd` does what
 * `gh repo create --source=. --remote=origin --push` does to the local
 * repo: add the new repo as "origin" (failing if that remote exists)
 * and `git push --set-upstream origin HEAD`, here to a local bare repo.
 * The PromptService is mocked.
 */
describe("fork (e2e)", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const makeFakeGitHub = (opts: {
    installed?: boolean;
    authenticated?: boolean;
    user?: string;
    existingRepos?: Array<string>;
    onCreate?: (
      name: string,
      visibility: "public" | "private"
    ) => void;
    failCreate?: boolean;
    /** Bare repo standing in for the new GitHub repo. */
    newRepoDir?: string;
  }) => {
    const {
      authenticated = true,
      existingRepos = [],
      failCreate = false,
      installed = true,
      newRepoDir,
      onCreate,
      user = "student",
    } = opts;

    return fromPartial<GitHubService>({
      ensureInstalled: Effect.fn("ensureInstalled")(
        function* () {
          if (!installed) {
            return yield* new GhNotInstalledError({
              message: "gh not installed",
            });
          }
        }
      ),
      ensureAuthenticated: Effect.fn("ensureAuthenticated")(
        function* () {
          if (!authenticated) {
            return yield* new GhNotAuthenticatedError({
              message: "gh not authenticated",
            });
          }
        }
      ),
      getAuthenticatedUser: Effect.fn("getAuthenticatedUser")(
        function* () {
          return user;
        }
      ),
      repoExists: Effect.fn("repoExists")(function* (
        fullName: string
      ) {
        return existingRepos.includes(fullName);
      }),
      createRepoFromCwd: Effect.fn("createRepoFromCwd")(
        function* (
          name: string,
          visibility: "public" | "private"
        ) {
          onCreate?.(name, visibility);
          if (failCreate) {
            return yield* new FailedToCreateRepoError({
              name,
              message: `Failed to create the GitHub repository "${name}" (exit code: 1).`,
            });
          }
          if (newRepoDir !== undefined) {
            const cwd = yield* GitServiceConfig;
            fs.mkdirSync(newRepoDir);
            git(newRepoDir, "init", "--bare");
            git(cwd.cwd, "remote", "add", "origin", newRepoDir);
            git(
              cwd.cwd,
              "push",
              "--set-upstream",
              "origin",
              "HEAD"
            );
          }
        }
      ),
    });
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
      Layer.succeed(GitServiceConfig, { cwd: workingDir }),
      NodeContext.layer
    );
  };

  /**
   * A student's clone of the course: `origin` is the course repo, `main`
   * is checked out, and there's another course branch, a local backup
   * branch and a tag that must not be published.
   */
  const buildRepo = () => {
    const repo = createTestRepo()
      .withRemote("origin")
      .withBranch("main", [
        commit("01.01 - Lesson", {
          "src/01.ts": "// original",
          "README.md": "# Course",
        }),
        commit("01.02 - Lesson", {
          "src/02.ts": "// second",
        }),
      ])
      .withBranch("live-run-through", [
        commit("01.01.01 - Live", { "src/live.ts": "// live" }),
      ])
      .build();
    git(repo.workingDir, "branch", "backup/main", "main");
    git(repo.workingDir, "tag", "v1", "main");
    const newRepoDir = path.join(
      path.dirname(repo.workingDir),
      "new-repo.git"
    );
    cleanup = repo.cleanup;
    return {
      ...repo,
      newRepoDir,
      courseUrl: git(repo.workingDir, "remote", "get-url", "origin"),
    };
  };

  const confirmingPrompt = (repoName?: string) =>
    fromPartial<PromptService>({
      inputRepoName: Effect.fn("inputRepoName")(function* (
        defaultName: string
      ) {
        return repoName ?? defaultName;
      }),
      confirmContinue: Effect.fn("confirmContinue")(
        function* () {
          // user says yes → resolves with no error
        }
      ),
    });

  it.effect(
    "keeps main's history and pushes only main to the new repo as origin",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const mainSha = git(repo.workingDir, "rev-parse", "main");
        const created: Array<string> = [];

        yield* runFork({
          name: Option.some("my-agent-repo"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({
                user: "student",
                newRepoDir: repo.newRepoDir,
                onCreate: (name) => created.push(name),
              })
            )
          )
        );

        expect(created).toEqual(["my-agent-repo"]);

        // Local main is untouched: same commit, course history intact,
        // no fresh "Initial commit".
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
        expect(git(repo.workingDir, "rev-parse", "HEAD")).toBe(
          mainSha
        );
        expect(
          git(repo.workingDir, "log", "--format=%s", "main")
        ).toBe("01.02 - Lesson\n01.01 - Lesson\ninitial");

        // The new repo has main, at the same commit, and nothing else:
        // no other course branch, no backup branch, no tags.
        expect(
          git(
            repo.newRepoDir,
            "for-each-ref",
            "--format=%(refname) %(objectname)"
          )
        ).toBe(`refs/heads/main ${mainSha}`);

        // origin is the new repo; the course remote is gone; main
        // tracks the new repo.
        expect(git(repo.workingDir, "remote")).toBe("origin");
        expect(
          git(repo.workingDir, "remote", "get-url", "origin")
        ).toBe(repo.newRepoDir);
        expect(
          git(repo.workingDir, "rev-parse", "--abbrev-ref", "main@{upstream}")
        ).toBe("origin/main");

        // Other local branches and tags are left alone, locally.
        expect(
          git(
            repo.workingDir,
            "branch",
            "--format=%(refname:short)"
          )
            .split("\n")
            .sort()
        ).toEqual(["backup/main", "live-run-through", "main"]);
        expect(git(repo.workingDir, "tag")).toBe("v1");
      })
  );

  it.effect(
    "publishes untracked files nowhere, and doesn't refuse over them",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        fs.writeFileSync(
          path.join(repo.workingDir, "notes.txt"),
          "scratch"
        );

        yield* runFork({
          name: Option.some("repo"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({ newRepoDir: repo.newRepoDir })
            )
          )
        );

        expect(
          git(repo.newRepoDir, "ls-tree", "-r", "--name-only", "main")
        ).not.toContain("notes.txt");
        expect(
          fs.existsSync(path.join(repo.workingDir, "notes.txt"))
        ).toBe(true);
      })
  );

  describe("refuses, changing nothing, when main can't be published as-is", () => {
    const expectRefused = (
      repo: ReturnType<typeof buildRepo>,
      messageParts: Array<string>
    ) =>
      Effect.gen(function* () {
        const created: Array<string> = [];
        const prompted: Array<string> = [];

        const result = yield* runFork({
          name: Option.none(),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              fromPartial<PromptService>({
                inputRepoName: Effect.fn("inputRepoName")(
                  function* (defaultName: string) {
                    prompted.push("name");
                    return defaultName;
                  }
                ),
                confirmContinue: Effect.fn("confirmContinue")(
                  function* () {
                    prompted.push("confirm");
                  }
                ),
              }),
              makeFakeGitHub({
                newRepoDir: repo.newRepoDir,
                onCreate: (name) => created.push(name),
              })
            )
          ),
          Effect.flip
        );

        expect(result._tag).toBe("ForkNotReadyError");
        for (const part of messageParts) {
          expect(result.message).toContain(part);
        }
        // Refused before asking anything or creating anything, and
        // still connected to the course.
        expect(prompted).toEqual([]);
        expect(created).toEqual([]);
        expect(
          git(repo.workingDir, "remote", "get-url", "origin")
        ).toBe(repo.courseUrl);
      });

    it.effect("on a branch other than main", () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        git(repo.workingDir, "checkout", "live-run-through");

        yield* expectRefused(repo, [
          'You\'re on "live-run-through"',
          "git checkout main",
        ]);
      })
    );

    it.effect("on a detached HEAD", () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        git(repo.workingDir, "checkout", "--detach", "main");

        yield* expectRefused(repo, [
          "You're not on a branch",
          "git checkout main",
        ]);
      })
    );

    it.effect("with uncommitted changes to tracked files", () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        fs.writeFileSync(
          path.join(repo.workingDir, "src/01.ts"),
          "// edited"
        );
        fs.writeFileSync(
          path.join(repo.workingDir, "src/new.ts"),
          "// staged"
        );
        git(repo.workingDir, "add", "src/new.ts");

        yield* expectRefused(repo, [
          "uncommitted changes",
          "src/01.ts",
          "src/new.ts",
        ]);
        // The changes are still there.
        expect(
          fs.readFileSync(
            path.join(repo.workingDir, "src/01.ts"),
            "utf8"
          )
        ).toBe("// edited");
      })
    );

    it.effect("in a shallow clone", () =>
      Effect.gen(function* () {
        const course = buildRepo();
        const shallowDir = path.join(
          path.dirname(course.workingDir),
          "shallow"
        );
        execFileSync(
          "git",
          [
            "clone",
            "--depth",
            "1",
            `file://${course.courseUrl}`,
            shallowDir,
          ],
          { stdio: "pipe" }
        );

        yield* expectRefused(
          {
            ...course,
            workingDir: shallowDir,
            courseUrl: `file://${course.courseUrl}`,
          },
          ["shallow clone", "git fetch --unshallow"]
        );
      })
    );
  });

  it.effect(
    "uses the name from the prompt when no arg is given",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const created: Array<string> = [];

        yield* runFork({ name: Option.none(), private: false }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt("prompted-name"),
              makeFakeGitHub({
                onCreate: (name) => created.push(name),
              })
            )
          )
        );

        expect(created).toEqual(["prompted-name"]);
      })
  );

  it.effect(
    "fails with GhNotInstalledError and leaves history untouched",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const created: Array<string> = [];

        const result = yield* runFork({
          name: Option.some("x"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({
                installed: false,
                onCreate: (name) => created.push(name),
              })
            )
          ),
          Effect.flip
        );

        expect(result._tag).toBe("GhNotInstalledError");
        expect(created).toEqual([]);
        // Original history is intact.
        expect(
          git(repo.workingDir, "log", "--oneline")
        ).toContain("01.01 - Lesson");
      })
  );

  it.effect(
    "fails with GhNotAuthenticatedError and leaves history untouched",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();

        const result = yield* runFork({
          name: Option.some("x"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({ authenticated: false })
            )
          ),
          Effect.flip
        );

        expect(result._tag).toBe("GhNotAuthenticatedError");
        expect(
          git(repo.workingDir, "log", "--oneline")
        ).toContain("01.01 - Lesson");
      })
  );

  it.effect(
    "fails with NotAGitRepoError when not run from a clone",
    () =>
      Effect.gen(function* () {
        // A plain directory that is NOT a git repo.
        const dir = fs.mkdtempSync(
          path.join(os.tmpdir(), "fork-nogit-")
        );
        cleanup = () =>
          fs.rmSync(dir, { recursive: true, force: true });

        const result = yield* runFork({
          name: Option.some("x"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              dir,
              confirmingPrompt(),
              makeFakeGitHub({})
            )
          ),
          Effect.flip
        );

        expect(result._tag).toBe("NotAGitRepoError");
      })
  );

  it.effect(
    "fails with GhRepoAlreadyExistsError when the repo name is taken",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const created: Array<string> = [];

        const result = yield* runFork({
          name: Option.some("taken"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({
                user: "student",
                existingRepos: ["student/taken"],
                onCreate: (name) => created.push(name),
              })
            )
          ),
          Effect.flip
        );

        expect(result._tag).toBe("GhRepoAlreadyExistsError");
        // Nothing was created and history is untouched.
        expect(created).toEqual([]);
        expect(
          git(repo.workingDir, "log", "--oneline")
        ).toContain("01.01 - Lesson");
      })
  );

  it.effect(
    "publishes the course's symlinks as symlinks even with core.symlinks=false",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        fs.mkdirSync(path.join(repo.workingDir, ".claude"));
        fs.symlinkSync(
          "../.agents/skills",
          path.join(repo.workingDir, ".claude/skills")
        );
        git(repo.workingDir, "add", ".claude/skills");
        git(repo.workingDir, "commit", "-m", "01.03 - Skills");

        // As on Windows without Developer Mode: the link is checked out
        // as a plain text file.
        git(repo.workingDir, "config", "core.symlinks", "false");
        fs.rmSync(path.join(repo.workingDir, ".claude/skills"));
        git(repo.workingDir, "checkout", "--", ".claude/skills");
        expect(
          fs
            .lstatSync(path.join(repo.workingDir, ".claude/skills"))
            .isSymbolicLink()
        ).toBe(false);

        yield* runFork({
          name: Option.some("repo"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({ newRepoDir: repo.newRepoDir })
            )
          )
        );

        // The pushed commit still records it as a symlink (mode 120000).
        expect(
          git(repo.newRepoDir, "ls-tree", "main", ".claude/skills")
        ).toMatch(/^120000 /);
      })
  );

  describe("visibility", () => {
    const captureLogs = () => {
      const lines: Array<string> = [];
      const spy = vi
        .spyOn(console, "log")
        .mockImplementation((line: unknown) => {
          lines.push(String(line));
        });
      return { lines, restore: () => spy.mockRestore() };
    };

    it.effect("creates a public repo by default", () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const created: Array<[string, string]> = [];
        const logs = captureLogs();

        yield* runFork({
          name: Option.some("course"),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({
                onCreate: (name, visibility) =>
                  created.push([name, visibility]),
              })
            )
          )
        );
        logs.restore();

        expect(created).toEqual([["course", "public"]]);
        expect(logs.lines.join("\n")).toContain(
          "create a new PUBLIC GitHub repo"
        );
      })
    );

    it.effect(
      "creates a private repo with --private, and says so",
      () =>
        Effect.gen(function* () {
          const repo = buildRepo();
          const created: Array<[string, string]> = [];
          const logs = captureLogs();

          yield* runFork({
            name: Option.some("course"),
            private: true,
          }).pipe(
            Effect.provide(
              makeLayer(
                repo.workingDir,
                confirmingPrompt(),
                makeFakeGitHub({
                  onCreate: (name, visibility) =>
                    created.push([name, visibility]),
                })
              )
            )
          );
          logs.restore();

          expect(created).toEqual([["course", "private"]]);
          const output = logs.lines.join("\n");
          expect(output).toContain(
            "create a new PRIVATE GitHub repo"
          );
          expect(output).toContain("Your private repo is ready");
          expect(output).not.toMatch(/public/i);
        })
    );

    it.effect(
      "says how to finish by hand when the create fails after the course remote was removed",
      () =>
        Effect.gen(function* () {
          const repo = buildRepo();

          const result = yield* runFork({
            name: Option.some("course"),
            private: true,
          }).pipe(
            Effect.provide(
              makeLayer(
                repo.workingDir,
                confirmingPrompt(),
                makeFakeGitHub({ failCreate: true })
              )
            ),
            Effect.flip
          );

          expect(result._tag).toBe("FailedToCreateRepoError");
          expect(result.message).toContain(
            "gh repo create course --private --source=. --remote=origin --push"
          );
          expect(result.message).toContain(
            "git history are untouched"
          );

          // History is untouched and origin is free for the gh command.
          expect(
            git(repo.workingDir, "log", "-1", "--format=%s")
          ).toBe("01.02 - Lesson");
          expect(git(repo.workingDir, "remote")).toBe("");
        })
    );
  });

  it.effect(
    "stops without touching history when the user declines confirmation",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const created: Array<string> = [];

        const declining = fromPartial<PromptService>({
          inputRepoName: Effect.fn("inputRepoName")(
            function* () {
              return "repo";
            }
          ),
          confirmContinue: Effect.fn("confirmContinue")(
            function* () {
              return yield* new PromptCancelledError();
            }
          ),
        });

        const result = yield* runFork({
          name: Option.none(),
          private: false,
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              declining,
              makeFakeGitHub({
                onCreate: (name) => created.push(name),
              })
            )
          ),
          Effect.flip
        );

        expect(result._tag).toBe("PromptCancelledError");
        expect(created).toEqual([]);
        expect(
          git(repo.workingDir, "log", "--oneline")
        ).toContain("01.01 - Lesson");
      })
  );
});

describe("sanitizeRepoName", () => {
  it.each([
    ["my-course-repo", "my-course-repo"],
    ["cohort 004 project", "cohort-004-project"],
    ["  spaced  ", "spaced"],
    ["weird!!name", "weird-name"],
    ["--leading-trailing--", "leading-trailing"],
    ["keeps.dots_and-dashes", "keeps.dots_and-dashes"],
  ])("normalises %j to %j", (input, expected) => {
    expect(sanitizeRepoName(input)).toBe(expected);
  });

  it("falls back to a default for empty input", () => {
    expect(sanitizeRepoName("")).toBe("my-course-repo");
    expect(sanitizeRepoName("   ")).toBe("my-course-repo");
    expect(sanitizeRepoName("!!!")).toBe("my-course-repo");
  });
});
