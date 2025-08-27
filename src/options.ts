import { Options } from "@effect/cli";
import * as path from "path";

export const rootOption = Options.text("root").pipe(
  Options.withDescription("The directory to look for lessons"),
  Options.withDefault(path.join(process.cwd(), "exercises"))
);

export const cwdOption = Options.text("cwd").pipe(
  Options.withDescription(
    "The working directory to run the command in"
  ),
  Options.withDefault(process.cwd())
);

export const envFilePathOption = Options.text("env-file").pipe(
  Options.withDescription(
    "The path to the environment file to use"
  ),
  Options.withDefault(path.join(process.cwd(), ".env"))
);
