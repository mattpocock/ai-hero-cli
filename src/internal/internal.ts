import { Command as CLICommand, Options } from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Effect } from "effect";

const upgradePackages = CLICommand.make(
  "upgrade",
  {
    cwd: Options.text("cwd").pipe(
      Options.withDescription(
        "The directory to run the upgrade command in"
      ),
      Options.withDefault(process.cwd())
    ),
    verbose: Options.boolean("verbose").pipe(
      Options.withDescription(
        "Whether or not to pipe the output of the upgrade command to the terminal"
      ),
      Options.withDefault(false)
    ),
  },
  ({ cwd, verbose }) =>
    Effect.gen(function* () {
      yield* Console.log("Upgrading AI SDK packages...");

      const updateCommand = Command.make(
        "pnpm",
        "upgrade",
        "ai@latest",
        "@ai-sdk/*@latest",
        "ai-hero-cli@latest"
      ).pipe(
        verbose
          ? Command.stdout("inherit")
          : Command.stdout("pipe"),
        verbose
          ? Command.stderr("inherit")
          : Command.stderr("pipe"),
        Command.workingDirectory(cwd)
      );

      const exitCode = yield* Command.exitCode(updateCommand);

      if (exitCode === 0) {
        yield* Console.log("Successfully upgraded");
      } else {
        yield* Console.log(
          "Failed to upgrade. Please try again."
        );
      }
    })
).pipe(
  CLICommand.withDescription("Upgrade the AI SDK packages")
);

export const internal = CLICommand.make("internal").pipe(
  CLICommand.withSubcommands([upgradePackages]),
  CLICommand.withDescription("Internal commands for AI Hero")
);
