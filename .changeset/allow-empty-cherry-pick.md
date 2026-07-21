---
"ai-hero-cli": patch
---

`internal edit-commit` no longer stalls on empty commits. The replay now cherry-picks with `--allow-empty --keep-redundant-commits`, and the re-authored target commit is created with `--allow-empty`, so empty placeholder commits (slug + subject, no content) are preserved through an edit instead of halting the replay as a conflict with no conflicted files.
