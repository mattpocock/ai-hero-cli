import { Command } from "@effect/cli";
import { cherryPick } from "./cherry-pick.js";
import { exercise } from "./exercise.js";
import { internal } from "./internal/internal.js";
import { reset } from "./reset.js";

const command = Command.make("ai-hero").pipe(
  Command.withSubcommands([internal, exercise, reset, cherryPick])
);

export const run = Command.run(command, {
  name: "AI Hero",
  version: "0.0.0",
});
