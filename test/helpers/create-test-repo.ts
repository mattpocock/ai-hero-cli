import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type CommitDef = {
  message: string;
  files: Record<string, string>;
};

export const commit = (
  message: string,
  files: Record<string, string>
): CommitDef => ({ message, files });

type BranchDef = {
  name: string;
  commits: Array<CommitDef>;
};

type WorkingBranchDef = {
  name: string;
  from: string;
  atCommit: number;
};

type TestRepoBuilder = {
  withRemote: (name: string) => TestRepoBuilder;
  withBranch: (
    name: string,
    commits: Array<CommitDef>
  ) => TestRepoBuilder;
  withWorkingBranch: (
    name: string,
    opts: { from: string; atCommit: number }
  ) => TestRepoBuilder;
  build: () => { workingDir: string; cleanup: () => void };
};

const git = (cwd: string, ...args: Array<string>) => {
  return execFileSync("git", args, {
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
};

export const createTestRepo = (): TestRepoBuilder => {
  let remoteName = "upstream";
  const branches: Array<BranchDef> = [];
  const workingBranches: Array<WorkingBranchDef> = [];

  const builder: TestRepoBuilder = {
    withRemote(name: string) {
      remoteName = name;
      return builder;
    },
    withBranch(name: string, commits: Array<CommitDef>) {
      branches.push({ name, commits });
      return builder;
    },
    withWorkingBranch(
      name: string,
      opts: { from: string; atCommit: number }
    ) {
      workingBranches.push({ name, ...opts });
      return builder;
    },
    build() {
      const tmpRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "test-repo-")
      );
      const bareDir = path.join(tmpRoot, "bare.git");
      const workDir = path.join(tmpRoot, "work");

      // Create bare repo as the "remote"
      fs.mkdirSync(bareDir);
      git(bareDir, "init", "--bare");

      // Create working repo and add remote
      fs.mkdirSync(workDir);
      git(workDir, "init");
      git(workDir, "config", "user.name", "Test");
      git(workDir, "config", "user.email", "test@test.com");
      git(workDir, "remote", "add", remoteName, bareDir);

      // Track commit SHAs per branch for withWorkingBranch
      const branchCommitShas: Record<string, Array<string>> = {};

      // Create each branch with its commits
      for (const branch of branches) {
        // Check if this is the first branch
        const isFirstBranch =
          branches.indexOf(branch) === 0;

        if (isFirstBranch) {
          // For the first branch, we might need an initial commit
          // Create it directly on whatever branch we're on, then rename
          // Make an initial commit so we have a HEAD
          const readmePath = path.join(
            workDir,
            ".gitkeep"
          );
          fs.writeFileSync(readmePath, "");
          git(workDir, "add", ".");
          git(workDir, "commit", "-m", "initial");
          // Rename current branch to the desired name
          git(workDir, "branch", "-M", branch.name);
        } else {
          // For subsequent branches, create from the first branch's initial commit
          const firstBranch = branches[0]!.name;
          git(
            workDir,
            "checkout",
            "-b",
            branch.name,
            firstBranch
          );
        }

        branchCommitShas[branch.name] = [];

        for (const commitDef of branch.commits) {
          for (const [filePath, content] of Object.entries(
            commitDef.files
          )) {
            const fullPath = path.join(workDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), {
              recursive: true,
            });
            fs.writeFileSync(fullPath, content);
          }
          git(workDir, "add", ".");
          git(
            workDir,
            "commit",
            "-m",
            commitDef.message
          );
          const sha = git(workDir, "rev-parse", "HEAD");
          branchCommitShas[branch.name]!.push(sha);
        }

        // Push branch to the bare remote
        git(
          workDir,
          "push",
          remoteName,
          `${branch.name}:${branch.name}`
        );
      }

      // Create working branches
      for (const wb of workingBranches) {
        const sourceShas = branchCommitShas[wb.from];
        if (!sourceShas) {
          throw new Error(
            `withWorkingBranch: source branch "${wb.from}" not found`
          );
        }
        // atCommit is the index into the commits array (0-based)
        // We need the SHA at that commit index
        const targetSha = sourceShas[wb.atCommit];
        if (targetSha === undefined) {
          throw new Error(
            `withWorkingBranch: commit index ${wb.atCommit} out of range for branch "${wb.from}" (has ${sourceShas.length} commits)`
          );
        }
        git(
          workDir,
          "checkout",
          "-b",
          wb.name,
          targetSha
        );
      }

      // If there are working branches, we're already on the last one.
      // Otherwise, checkout the first branch.
      if (
        workingBranches.length === 0 &&
        branches.length > 0
      ) {
        git(workDir, "checkout", branches[0]!.name);
      }

      return {
        workingDir: workDir,
        cleanup: () => {
          fs.rmSync(tmpRoot, {
            recursive: true,
            force: true,
          });
        },
      };
    },
  };

  return builder;
};
