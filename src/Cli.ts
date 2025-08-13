import { Args, Command, Options } from "@effect/cli";
import { Console } from "effect";

const prefix = Options.boolean("prefix").pipe(
  Options.withDescription("Apply a prefix to the message")
);

const log = Command.make(
  "log",
  { message: Args.text(), prefix },
  ({ message, prefix }) =>
    Console.log(prefix ? `[${message}]` : message)
);

const internal = Command.make("internal").pipe(
  Command.withSubcommands([log])
);

const command = Command.make("ai-hero").pipe(
  Command.withSubcommands([internal])
);

export const run = Command.run(command, {
  name: "AI Hero",
  version: "0.0.0"
});
