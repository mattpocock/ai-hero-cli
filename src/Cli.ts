import { Command } from "@effect/cli";
import { exercise } from "./exercise.js";

const internal = Command.make("internal");

const command = Command.make("ai-hero").pipe(
  Command.withSubcommands([internal, exercise])
);

export const run = Command.run(command, {
  name: "AI Hero",
  version: "0.0.0",
});
