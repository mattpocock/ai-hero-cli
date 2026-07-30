import { Command as CLICommand } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { PromptService } from "../prompt-service.js";
import { addCommit, runAddCommit } from "./add-commit/command.js";
import {
  deleteCommit,
  runDeleteCommit,
} from "./delete-commit/command.js";
import { editCommit, runEditCommit } from "./edit-commit/command.js";
import {
  renameCommit,
  runRenameCommit,
} from "./rename-commit/command.js";
import {
  branchOption,
  mainBranchOption,
  reportErrors,
} from "./stack/options.js";

/**
 * A bare `internal` opens a menu of the four commands.
 *
 * `@effect/cli` runs a parent's own handler when it is invoked without a
 * subcommand, so this costs no restructuring — naming a subcommand still
 * dispatches straight to it.
 *
 * The picker calls the same exported `run*` functions the subcommands do, so
 * there is exactly one implementation of each and the picker never re-enters
 * the argument parser.
 */
const runInternalPicker = (opts: {
  branch: string;
  mainBranch: string;
}) =>
  Effect.gen(function* () {
    // The menu is the entry point, so a caller with no TTY has most likely
    // just typed the wrong thing. Show them what's here rather than refusing —
    // and printing help is what bare `internal` did before the menu existed.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      yield* Console.log(
        [
          "Internal commands for AI Hero:",
          "",
          "  edit-commit     Edit a lesson's contents and replay the commits after it",
          "  add-commit      Add an empty stub lesson to fill in later",
          "  rename-commit   Change a lesson's slug and title",
          "  delete-commit   Remove a lesson from the history entirely",
          "",
          "Run `ai-hero internal <command> --help` for details.",
          "Run `ai-hero internal` in a terminal to pick from a menu.",
        ].join("\n")
      );
      return;
    }

    const prompts = yield* PromptService;
    const choice = yield* prompts.selectInternalCommand();

    // `--commit` is deliberately not hoisted onto the menu: picking the lesson
    // interactively is the whole point of arriving here.
    const shared = {
      commit: Option.none<string>(),
      branch: opts.branch,
      mainBranch: opts.mainBranch,
    };

    // One command, then exit. Looping back would invite a second rewrite
    // against a repo state that has just been force-pushed and not re-read.
    switch (choice) {
      case "edit-commit":
        return yield* runEditCommit(shared);
      case "add-commit":
        return yield* runAddCommit({
          branch: opts.branch,
          mainBranch: opts.mainBranch,
        });
      case "rename-commit":
        return yield* runRenameCommit(shared);
      case "delete-commit":
        return yield* runDeleteCommit(shared);
    }
  }).pipe(reportErrors);

export const internal = CLICommand.make(
  "internal",
  {
    branch: branchOption,
    mainBranch: mainBranchOption,
  },
  runInternalPicker
).pipe(
  CLICommand.withSubcommands([
    editCommit,
    addCommit,
    renameCommit,
    deleteCommit,
  ]),
  CLICommand.withDescription("Internal commands for AI Hero")
);
