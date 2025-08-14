import { Command } from "@effect/cli";
import { exercise } from "./exercise.js";
import { internal } from "./internal/internal.js";

const command = Command.make("ai-hero").pipe(
  Command.withSubcommands([internal, exercise])
);

export const run = Command.run(command, {
  name: "AI Hero",
  version: "0.0.0",
});
