import { Command as CLICommand } from "@effect/cli";
import { editCommit } from "./edit-commit/command.js";

export const internal = CLICommand.make("internal").pipe(
  CLICommand.withSubcommands([editCommit]),
  CLICommand.withDescription("Internal commands for AI Hero"),
);
