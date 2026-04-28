/* v8 ignore start - CLI entry point, no business logic */
import { Command } from "@effect/cli";
import { cherryPick } from "./cherry-pick.js";
import { exercise } from "./exercise.js";
import { internal } from "./internal/internal.js";
import { pull } from "./pull.js";
import { reset } from "./reset.js";

const command = Command.make("ai-hero").pipe(
  Command.withSubcommands([internal, exercise, reset, cherryPick, pull])
);

export const run = Command.run(command, {
  name: "AI zero",
  version: "0.0.0",
});
/* v8 ignore stop */
