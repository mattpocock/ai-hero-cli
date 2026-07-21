---
"ai-hero-cli": minor
---

Make `internal edit-commit` interactive again. It is once more a single prompt-driven command — pick a lesson, edit it, confirm, push — rather than a state machine driven from outside.

**The `begin`, `continue`, `status`, `abort` and `publish` subcommands are removed**, along with the `.git/ai-hero/edit-commit.json` session file and the JSON output envelope. `edit-commit` is invoked bare: `ai-hero internal edit-commit [--commit <lesson-id>]`. It requires a TTY and exits with an error when it doesn't have one, rather than silently degrading. A session no longer survives its process — there is nothing to resume.

Carried over from the agent-driven version rather than reverted:

- **`--commit` still skips the picker**, and now takes a **lesson id** — a slug (`add-settings-json`) or a numeric id (`6.6.1`, normalised to `06.06.01`) — or a SHA prefix, resolved by the same parser `reset` and `cherry-pick` use. Duplicate ids resolve to the latest commit. The old positional selector (`--commit 2` meaning "the second commit") is gone; the picker now lists real lesson ids in teaching order instead of list positions.
- **Conflict resolution is verified.** Choosing "Continue" re-reads the unmerged files and refuses while conflict markers remain, instead of taking your word for it and committing `<<<<<<<` into a lesson. The "Skip" option is gone — it left the cherry-pick half-applied.
- **Cancelling unwinds.** Previously, cancelling a prompt printed "Branch left as-is" and abandoned a `matt/edit-commit-*` branch nothing could later find. Now the command aborts any in-flight cherry-pick, restores the branch you started on, and cleans up. Before your edits are committed it asks first, since unwinding discards them; once they are committed it unwinds without asking but keeps the temp branch, so backing out of a force-push never costs you the edit. A hard interrupt still leaves the branch, but prints its name.
