---
"ai-hero-cli": minor
---

`reset`, `cherry-pick` and `pull` no longer redirect you off `main` onto a fresh branch — `main` is now a regular working branch, same as any other, since a fork's default branch already lands you there. `reset` now warns before discarding any commit that isn't recoverable from the reset target or the lesson stack (this used to be moot for `main`, which never carried extra commits of its own — now it can). `pull` no longer merges with `--allow-unrelated-histories` when the target is `main`, since it shares real ancestry with `upstream/main` — a genuinely wrong `--upstream` now fails loudly instead of silently two-root-merging.

This is opt-in per repo: bump the pinned `ai-hero-cli` version in `package.json` when you're ready to adopt it. Live courses (`ai-coding-crash-course`) are unaffected until you do.
