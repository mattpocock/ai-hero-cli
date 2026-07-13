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
import * as os from "node:os";
import * as path from "node:path";
import { runFork, sanitizeRepoName } from "../src/fork.js";
import {
  GitService,
  GitServiceConfig,
  makeGitService,
} from "../src/git-service.js";
import {
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
 * Uses the REAL GitService against a temp repo — so the destructive
 * history-reset flow (rm .git / init / commit / rename) actually runs —
 * with a FAKE GitHubService (no network) and a mocked PromptService.
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
    onCreate?: (name: string) => void;
  }) => {
    const {
      authenticated = true,
      existingRepos = [],
      installed = true,
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
      createPrivateRepoFromCwd: Effect.fn(
        "createPrivateRepoFromCwd"
      )(function* (name: string) {
        onCreate?.(name);
      }),
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

  const buildRepo = () => {
    const repo = createTestRepo()
      .withBranch("main", [
        commit("01.01 - Lesson", {
          "src/01.ts": "// original",
          "README.md": "# Course",
        }),
      ])
      .build();
    cleanup = repo.cleanup;
    return repo;
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
    "creates a fresh single-commit main branch and creates the private repo",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();

        // Sanity: the clone starts with the course history.
        expect(
          git(repo.workingDir, "log", "--oneline")
        ).toContain("01.01 - Lesson");

        const created: Array<string> = [];

        yield* runFork({
          name: Option.some("my-agent-repo"),
        }).pipe(
          Effect.provide(
            makeLayer(
              repo.workingDir,
              confirmingPrompt(),
              makeFakeGitHub({
                user: "student",
                onCreate: (name) => created.push(name),
              })
            )
          )
        );

        // History was reset to a single "Initial commit" on main.
        expect(
          git(repo.workingDir, "branch", "--show-current")
        ).toBe("main");
        expect(
          git(repo.workingDir, "rev-list", "--count", "HEAD")
        ).toBe("1");
        expect(
          git(repo.workingDir, "log", "-1", "--format=%s")
        ).toBe("Initial commit");

        // The old course history is gone.
        expect(
          git(repo.workingDir, "log", "--oneline")
        ).not.toContain("01.01 - Lesson");

        // Files are preserved.
        expect(
          fs.existsSync(
            path.join(repo.workingDir, "src/01.ts")
          )
        ).toBe(true);

        // The repo was created with the requested name.
        expect(created).toEqual(["my-agent-repo"]);
      })
  );

  it.effect(
    "commits successfully even with no configured git identity",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();

        // Simulate a fresh machine with no global/system git identity
        // (as in CI, or a student who never ran `git config --global`).
        const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
        const prevSystem = process.env.GIT_CONFIG_SYSTEM;
        process.env.GIT_CONFIG_GLOBAL = "/dev/null";
        process.env.GIT_CONFIG_SYSTEM = "/dev/null";

        try {
          yield* runFork({
            name: Option.some("no-identity-repo"),
          }).pipe(
            Effect.provide(
              makeLayer(
                repo.workingDir,
                confirmingPrompt(),
                makeFakeGitHub({ user: "octocat" })
              )
            )
          );

          // The commit landed and picked up the fallback identity.
          expect(
            git(repo.workingDir, "rev-list", "--count", "HEAD")
          ).toBe("1");
          expect(
            git(repo.workingDir, "log", "-1", "--format=%an")
          ).toBe("octocat");
          expect(
            git(repo.workingDir, "log", "-1", "--format=%ae")
          ).toBe("octocat@users.noreply.github.com");
        } finally {
          if (prevGlobal === undefined) {
            delete process.env.GIT_CONFIG_GLOBAL;
          } else {
            process.env.GIT_CONFIG_GLOBAL = prevGlobal;
          }
          if (prevSystem === undefined) {
            delete process.env.GIT_CONFIG_SYSTEM;
          } else {
            process.env.GIT_CONFIG_SYSTEM = prevSystem;
          }
        }
      })
  );

  it.effect(
    "uses the name from the prompt when no arg is given",
    () =>
      Effect.gen(function* () {
        const repo = buildRepo();
        const created: Array<string> = [];

        yield* runFork({ name: Option.none() }).pipe(
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
