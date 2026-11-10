---
"ai-hero-cli": patch
---

`ai-hero reset` now stops before resetting when a tracked path carries a hidden git flag (assume-unchanged or skip-worktree, outside a sparse checkout). It names the paths and prints the `git update-index` command that clears the flag, instead of failing with "Entry '…' not uptodate. Cannot merge." It never clears the flag itself.

`ai-hero fork` now warns before wiping history when `core.symlinks=false`, naming the course's symlinks and how to restore them, since they would otherwise be published to your new repo as plain files.
