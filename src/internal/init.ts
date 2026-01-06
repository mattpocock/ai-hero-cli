import { Command as CLICommand, Options } from "@effect/cli";
import { Command, FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Console, Data, Effect } from "effect";
import * as os from "node:os";
import { PromptService } from "../prompt-service.js";

class DirectoryExistsError extends Data.TaggedError(
  "DirectoryExistsError"
)<{
  path: string;
}> {}

class NoSubdirectoriesError extends Data.TaggedError(
  "NoSubdirectoriesError"
)<{
  path: string;
}> {}

const TSCONFIG = `{
  /* From https://www.totaltypescript.com/tsconfig-cheat-sheet */
  "compilerOptions": {
    /* Base Options: */
    "esModuleInterop": true,
    "skipLibCheck": true,
    "target": "es2022",
    "allowJs": true,
    "resolveJsonModule": true,
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,

    /* Strictness */
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    "module": "NodeNext",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react",

    "lib": ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"]
  }
}
`;

const GITIGNORE = `node_modules
`;

const PRETTIERIGNORE = `pnpm-lock.yaml
node_modules
`;

const createPackageJson = (name: string) => `{
  "name": "${name}",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "cherry-pick": "ai-hero-cli cherry-pick --branch=live-run-through",
    "reset": "ai-hero-cli reset --branch=live-run-through",
    "pull": "ai-hero-cli pull",
    "dev": "echo 'Not implemented yet'"
  },
  "prettier": {
    "semi": true,
    "trailingComma": "es5",
    "singleQuote": false,
    "printWidth": 80,
    "tabWidth": 2
  }
}
`;

export const init = CLICommand.make(
  "init",
  {
    base: Options.text("base").pipe(
      Options.withDescription(
        "Base directory to list subdirectories from"
      ),
      Options.withDefault(os.homedir() + "/repos")
    ),
  },
  ({ base }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const promptService = yield* PromptService;

      // Get subdirectories from base
      const entries = yield* fs.readDirectory(base);
      const subdirs: Array<string> = [];

      for (const entry of entries) {
        const fullPath = path.join(base, entry);
        const stat = yield* fs.stat(fullPath);
        if (stat.type === "Directory") {
          subdirs.push(entry);
        }
      }

      if (subdirs.length === 0) {
        return yield* new NoSubdirectoriesError({ path: base });
      }

      // Prompt for subdirectory selection
      const subdirectory = yield* promptService.selectSubdirectory(
        subdirs,
        "Select subdirectory:"
      );

      // Prompt for repo name
      const repoName = yield* promptService.inputText("Enter repo name:");

      const repoPath = path.join(base, subdirectory, repoName);

      // Check if directory already exists
      const exists = yield* fs.exists(repoPath);
      if (exists) {
        return yield* new DirectoryExistsError({ path: repoPath });
      }

      // Create directory
      yield* fs.makeDirectory(repoPath, { recursive: true });
      yield* Console.log(`Created directory: ${repoPath}`);

      // Write files
      yield* fs.writeFileString(
        path.join(repoPath, "package.json"),
        createPackageJson(repoName)
      );
      yield* Console.log("Created package.json");

      yield* fs.writeFileString(
        path.join(repoPath, "tsconfig.json"),
        TSCONFIG
      );
      yield* Console.log("Created tsconfig.json");

      yield* fs.writeFileString(
        path.join(repoPath, ".gitignore"),
        GITIGNORE
      );
      yield* Console.log("Created .gitignore");

      yield* fs.writeFileString(
        path.join(repoPath, ".prettierignore"),
        PRETTIERIGNORE
      );
      yield* Console.log("Created .prettierignore");

      // Install packages via pnpm
      yield* Console.log("\nInstalling packages...");
      const pnpmAdd = Command.make(
        "pnpm",
        "add",
        "-D",
        "typescript",
        "prettier",
        "@types/node",
        "ai-hero-cli"
      ).pipe(
        Command.workingDirectory(repoPath),
        Command.stdout("inherit"),
        Command.stderr("inherit")
      );

      const pnpmExitCode = yield* Command.exitCode(pnpmAdd);
      if (pnpmExitCode !== 0) {
        yield* Console.error("Failed to install packages");
        process.exitCode = 1;
        return;
      }
      yield* Console.log("Packages installed");

      // Initialize git
      yield* Console.log("\nInitializing git...");
      const gitInit = Command.make("git", "init").pipe(
        Command.workingDirectory(repoPath),
        Command.stdout("pipe"),
        Command.stderr("pipe")
      );
      yield* Command.exitCode(gitInit);

      // Git add all
      const gitAdd = Command.make("git", "add", ".").pipe(
        Command.workingDirectory(repoPath),
        Command.stdout("pipe"),
        Command.stderr("pipe")
      );
      yield* Command.exitCode(gitAdd);

      // Git commit
      const gitCommit = Command.make(
        "git",
        "commit",
        "-m",
        "Initial commit"
      ).pipe(
        Command.workingDirectory(repoPath),
        Command.stdout("pipe"),
        Command.stderr("pipe")
      );
      yield* Command.exitCode(gitCommit);

      yield* Console.log("Git initialized with initial commit");

      yield* Console.log(`\n✓ Project created at ${repoPath}`);
      yield* Console.log(`\nNext steps:`);
      yield* Console.log(`  cd ${repoPath}`);
      yield* Console.log(`  # Start building your course!`);
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.catchTags({
        PromptCancelledError: () =>
          Effect.gen(function* () {
            // Silent exit on cancel
          }),
        DirectoryExistsError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(
              `Error: Directory already exists: ${error.path}`
            );
            process.exitCode = 1;
          }),
        NoSubdirectoriesError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(
              `Error: No subdirectories found in ${error.path}`
            );
            process.exitCode = 1;
          }),
        SystemError: (error) =>
          Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          }),
        BadArgument: (error) =>
          Effect.gen(function* () {
            yield* Console.error(`Error: ${error.message}`);
            process.exitCode = 1;
          }),
      }),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Console.error(`Unexpected error: ${error}`);
          process.exitCode = 1;
        })
      )
    )
).pipe(CLICommand.withDescription("Initialize a new course project"));
