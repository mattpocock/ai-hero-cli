# ai-hero-cli

## 0.6.1

### Patch Changes

- 3e42f45: `internal edit-commit` no longer stalls on empty commits. The replay now cherry-picks with `--allow-empty --keep-redundant-commits`, and the re-authored target commit is created with `--allow-empty`, so empty placeholder commits (slug + subject, no content) are preserved through an edit instead of halting the replay as a conflict with no conflicted files.

## 0.6.0

### Minor Changes

- 399024d: Add `ai-hero fork` command: turn your course clone into a fresh private GitHub repo you own in one step. It checks the GitHub CLI is installed and authenticated, resets local history to a single commit, creates a private repo, and pushes your files to it as `origin` (GitHub Issues enabled by default). Guides you through the common failure modes (no `gh`, not logged in, repo name already taken, not run from a clone).
- 0812e8d: Make `internal edit-commit` interactive again. It is once more a single prompt-driven command — pick a lesson, edit it, confirm, push — rather than a state machine driven from outside.

  **The `begin`, `continue`, `status`, `abort` and `publish` subcommands are removed**, along with the `.git/ai-hero/edit-commit.json` session file and the JSON output envelope. `edit-commit` is invoked bare: `ai-hero internal edit-commit [--commit <lesson-id>]`. It requires a TTY and exits with an error when it doesn't have one, rather than silently degrading. A session no longer survives its process — there is nothing to resume.

  Carried over from the agent-driven version rather than reverted:

  - **`--commit` still skips the picker**, and now takes a **lesson id** — a slug (`add-settings-json`) or a numeric id (`6.6.1`, normalised to `06.06.01`) — or a SHA prefix, resolved by the same parser `reset` and `cherry-pick` use. Duplicate ids resolve to the latest commit. The old positional selector (`--commit 2` meaning "the second commit") is gone; the picker now lists real lesson ids in teaching order instead of list positions.
  - **Conflict resolution is verified.** Choosing "Continue" re-reads the unmerged files and refuses while conflict markers remain, instead of taking your word for it and committing `<<<<<<<` into a lesson. The "Skip" option is gone — it left the cherry-pick half-applied.
  - **Cancelling unwinds.** Previously, cancelling a prompt printed "Branch left as-is" and abandoned a `matt/edit-commit-*` branch nothing could later find. Now the command aborts any in-flight cherry-pick, restores the branch you started on, and cleans up. Before your edits are committed it asks first, since unwinding discards them; once they are committed it unwinds without asking but keeps the temp branch, so backing out of a force-push never costs you the edit. A hard interrupt still leaves the branch, but prints its name.

- 95406cd: Trim the `internal` namespace down to the one authoring command still in active use. The `update-cvm`, `rename`, `upload-to-cloudinary`, `get-diffs`, `diffs-to-repo`, `walk-through`, `init`, `lint`, and `rebase-to-main` commands, plus the inline `upgrade` command, have been removed — `ai-hero internal` now exposes only `edit-commit`. The student-facing commands (`exercise`, `reset`, `cherry-pick`, `pull`) are unchanged.

  The dependencies orphaned by those removals (`cloudinary`, `dotenv`) and pre-existing dead dependencies (`@effect/sql`, `@effect/cluster`, `@effect/rpc`) have been dropped, along with the in-repo `sandcastle` agent harness and its `@ai-hero/sandcastle` devDependency.

## 0.5.0

### Minor Changes

- f5d43fc: Make `internal edit-commit` agent-drivable. The previously interactive, single-session command is now a resumable state machine split into five non-interactive subcommands — `begin`, `continue`, `status`, `abort`, and `publish` — backed by a session file under `.git/ai-hero/`. Each verb emits a single JSON envelope on stdout (phase, target commit, following count, conflicted files, and the suggested next step) and reports typed error codes (`session_exists`, `no_session`, `commit_not_found`, `unresolved_conflicts`, `lease_rejected`, `invalid_phase`, `state_diverged`), so an agent can drive the whole edit → recompose → force-push flow without a TTY. Verbs are phase-guarded (e.g. `continue` only from `editing`/`conflict`, `publish` only from `ready`) and validate the recorded session against git reality (the temp branch still exists and the working tree is parked on it) before mutating anything. `continue` is phase-aware (re-authors the commit, replays following commits, and refuses to proceed while conflict markers remain); `publish` is a separate, re-runnable step guarded by `--force-with-lease`.
- e1583b2: Accept lesson **slugs** (not just numeric `NN.NN.NN` ids) in `reset` and `cherry-pick`. A lesson id is now "the token before the first `": "` in a commit message", so a slug (`add-settings-json`), a numeric id (`06.06.01`), and anything else are handled by one generic parser — numeric is just a slug that happens to have dots.

  To keep base and conventional-commit lines (`chore: …`, `fix: …`) from masquerading as lessons now that any `token: message` prefix is an id, the candidate set is scoped to the lesson stack `upstream/main..<branch>` instead of the branch's full history — a structural fence, no denylist or slug-shape heuristic. Repos without an `upstream/main` to anchor on fall back to full-branch history (the base `initial` commit has no `": "` and drops out anyway).

  Candidates now list in commit order (teaching order carried by the stack) rather than sorted by id, and duplicate-slug resolution picks the latest (newest) matching commit. Numeric ids keep their existing ergonomics — `1.1.1` still normalizes to `01.01.01`.

  Known limitation: a non-lesson commit deliberately stacked _inside_ `main..<branch>` (e.g. a stray `chore:` reconcile commit) will still surface as a lesson — the fence removes base commits, not stray commits living on the stack. Keep the stack a clean set of lesson slugs.

## 0.4.1

### Patch Changes

- a2e01f0: Clean up the upstream remote and local tracking branch when CLI commands finish. Only cleans up resources that the CLI added -- if the user already had an upstream remote configured, it is left untouched.
- 4e6a0ac: Prevent reset, cherry-pick, and pull commands from running while on the live-run-through branch. This branch contains exercise data and should not be modified directly.
- 9e0df15: Suppress confusing `error: No such remote 'upstream'` and `error: branch '<name>' not found` messages that previously leaked to stderr during `reset`, `cherry-pick`, and `pull`. These came from probing git commands whose failure was expected and handled internally, but looked like real errors to users.

## 0.4.0

### Minor Changes

- f3bfb2d: When running `pnpm pull` on the main branch, prompt the user to create a dev branch instead of erroring. The pull then proceeds on the new branch.
- e073dc7: Add "reset to main" feature to reset current branch to upstream/main. Run `pnpm reset main` or select "main" from the interactive prompt.

## 0.3.1

### Patch Changes

- efc43a4: Fixed TypeError when selecting the first subfolder (index 0) in exercises. The `prompts` library treats `0` as falsy and returns the title string instead, causing `path.join` to receive `undefined`. Now uses subfolder names as values instead of numeric indices.

## 0.3.0

### Minor Changes

- 9a90250: Added a new --upstream flag, required for reset, cherry-pick and pull, to target a specific remote
- 9a90250: Removed the --problem and --solution flags from reset and cherry-pick

## 0.2.15

### Patch Changes

- 73a190f: Added init script
- 0912ded: Added @modelcontextprotocol/sdk to upgrade cmd
- f7115a4: Made edit-commit use a temporary branch

## 0.2.14

### Patch Changes

- ccf2c0f: Made it so that the cherry-pick and reset commands automatically detect the upstream branch. This prevents an issue where hard-coding the git repo can cause authentication issues.
- 6e57ece: Added a pull command for pulling the latest changes into your working project.
- 59ffe5e: cherry-pick now offers you the chance to create a new branch

## 0.2.13

### Patch Changes

- 091fd79: Improved fuzzy matching for exercise CLI

## 0.2.12

### Patch Changes

- 2d6ba17: Fixed a bug in cherry-picking where the live-run-through branch was not being pulled in locally

## 0.2.11

### Patch Changes

- 2fa60d5: Fixed a bug where a failed update in the CVM would not fail the commit
- 1b35c15: Added diffs-to-repo command on internal
- bbd505d: Fixed a bug where styleText was not exported by node:util

## 0.2.10

### Patch Changes

- ca698ff: Added an internal rebase-to-main command

## 0.2.9

### Patch Changes

- 60295bf: fixed a bug where if you were on a fork, you could not reset or cherry-pick.

## 0.2.8

### Patch Changes

- be29e32: Support exercises with only README.md (no main.ts). Linting now skips main.ts errors if readme.md exists in a subfolder, and exercise execution displays the readme path instead of failing.

## 0.2.7

### Patch Changes

- 6e99337: Fixed bug where upload to cloudinary would error if there were no images

## 0.2.6

### Patch Changes

- 05cc815: Fixed unhandled PromptCancelled error when exiting exercises with Ctrl+C
- 349cecf: Made it so edit-commit takes you back to the original branch
- a613420: Made the upgrade script update Evalite to beta.

## 0.2.5

### Patch Changes

- 8b294a1: Added internal edit commit for working with project history
- ba10d66: Added a default to --branch

## 0.2.4

### Patch Changes

- 4cb4202: Added branch protection to reset and cherry-pick commands. Prevents resetting current branch or cherry-picking when on target branch or main branch.
- ceb92ce: Add the ability to choose the commit to cherrypick or reset to
- d6e1b24: Fixed a bug where cancelled prompts were not being properly cancelled
- 8c7a4f6: Fixed a bug with get-diffs
- eb09a76: Cherry-picking a commit now hides commits that have already been added to this branch.

## 0.2.3

### Patch Changes

- 743a54d: Fixed bugs with reset and cherrypick

## 0.2.2

### Patch Changes

- 47dd3b0: Made all git commands report their output

## 0.2.1

### Patch Changes

- 26d8957: Added cherry-pick and reset commands

## 0.2.0

### Minor Changes

- 26e77f3: Added get-diffs internal script

## 0.1.1

### Patch Changes

- 772134a: Added the 'next exercise' dialog back to the exercise script.

## 0.1.0

### Minor Changes

- 6fbdbed: Simple mode is now default and only mode. --simple flag throws error message.

## 0.0.26

### Patch Changes

- 1f4d455: Upgrade script now updates vitest to latest version.
- 544e585: Improved exercise search to accept more intuitive formats - users can now search for "03.02" using "3.2"
- 8b70c08: Fix .env file not found error by using correct tsx --env-file flag syntax with equals sign and quotes
- b80b85b: Added lint rule for speaker notes

## 0.0.25

### Patch Changes

- 7a321fe: Made the upload to cloudinary script work on the entire repo
- 621a483: Added evalite to the packages

## 0.0.24

### Patch Changes

- b60fe11: Added upload to cloudinary script

## 0.0.23

### Patch Changes

- f5f5756: Fixed a bug where reading the main file would cause an error because it did not exist.

## 0.0.22

### Patch Changes

- b9a3afd: Added a lint rule that checks for unreferenced reference material.
- 6562f70: Added a lint rule for empty main.ts files

## 0.0.21

### Patch Changes

- 8ce3ec3: Made the kill logic only run if the process is still running

## 0.0.20

### Patch Changes

- d83df9a: Added a debug option
- dddbc44: Another attempted fix for subprocess hanging by explicitly handling SIGINT and SIGTERM.

## 0.0.19

### Patch Changes

- 7b20d9b: Fixed an issue where erroring commands would erroneously log

## 0.0.18

### Patch Changes

- 5844963: Fixed an issue where the exercise subprocess was not being killed

## 0.0.17

### Patch Changes

- 800a9a3: Fixed advanced branch

## 0.0.16

### Patch Changes

- fd8d32d: Wrapped tsx in quotes to work on windows

## 0.0.15

### Patch Changes

- 0f56305: Fixed a bug where it would always show explainer executed
- 23cd2f3: Made the update cvm script error properly

## 0.0.14

### Patch Changes

- 2426351: Choosing the next exercise now shows the name of the exercise.
- 2426351: Made it so that the success and failure text for explainers is clearer.

## 0.0.13

### Patch Changes

- 9492726: Added rename script to AI Hero CLI
- 3c60eb1: Added relative link checking
- e75c29e: Added a rule that checks for PMPM run exercise.

## 0.0.12

### Patch Changes

- 5d9633f: Added internal/lint exercise

## 0.0.11

### Patch Changes

- 868cd1c: I fixed an issue where you couldn't query for exercises if you began the query with a zero.
- 93b1da6: Readme tweak

## 0.0.10

### Patch Changes

- 766960b: Made it so if you pick to run the same exercise again, you won't be prompted for the subfolder
- 766960b: Fixed an issue where invalid subfolders would be offered as selections when running exercises
- 623859c: Added a --simple flag for maximum compatibility on certain systems.

## 0.0.9

### Patch Changes

- 165ff7f: Fixed upgrade script
- 00f6953: Added update-cvm internal script

## 0.0.8

### Patch Changes

- 67dbe64: Made the output CJS

## 0.0.7

### Patch Changes

- e185eb2: Added readme
