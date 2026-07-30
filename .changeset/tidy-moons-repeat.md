---
"ai-hero-cli": patch
---

Add `add-commit`, `rename-commit` and `delete-commit` to the `internal` namespace, and open a menu on a bare `internal`.

`internal` was a namespace of one. Editing a lesson's contents was the only history rewrite the CLI could do — creating, renaming or removing a lesson meant dropping to an interactive rebase by hand.

- **`add-commit`** prompts for a slug and a title, composes the `slug: Title` subject, and asks where the lesson goes: at the start, after any existing lesson, or at the end. It commits an empty stub for `edit-commit` to fill in later. Alone among the four it tolerates an empty stack, so it can create a repo's first lesson.
- **`rename-commit`** changes a lesson's slug and title, each prompt prefilled with the current value. It amends in place, so a rename can never alter a lesson's contents.
- **`delete-commit`** removes a lesson and replays the rest onto its parent. It shows the diffstat and takes a `backup/` branch before touching anything — it's the only command that destroys authored work rather than moving it.

All three inherit `edit-commit`'s ceremony: a temp branch, the cherry-pick conflict loop that refuses to commit conflict markers, an explicit confirmation before the live branch moves and again before the force-push, and an unwind that restores the repository on cancel.

Slugs are now validated where they're written: kebab-case, no `": "` (the parse boundary), and unique within the stack, since a duplicate silently redirects `reset`.

A bare `ai-hero internal` now opens a menu of the four rather than printing help — outside a TTY it still prints the command list.

Internally, the temp-branch → replay → apply → publish → unwind spine moves into `src/internal/stack/` and all four commands share it, `edit-commit` included. One `unwind` rather than four.
