---
"ai-hero-cli": minor
---

Trim the `internal` namespace down to the one authoring command still in active use. The `update-cvm`, `rename`, `upload-to-cloudinary`, `get-diffs`, `diffs-to-repo`, `walk-through`, `init`, `lint`, and `rebase-to-main` commands, plus the inline `upgrade` command, have been removed — `ai-hero internal` now exposes only `edit-commit`. The student-facing commands (`exercise`, `reset`, `cherry-pick`, `pull`) are unchanged.

The dependencies orphaned by those removals (`cloudinary`, `dotenv`) and pre-existing dead dependencies (`@effect/sql`, `@effect/cluster`, `@effect/rpc`) have been dropped, along with the in-repo `sandcastle` agent harness and its `@ai-hero/sandcastle` devDependency.
