---
"ai-hero-cli": minor
---

`reset` now warns when a lesson's symlinks won't check out correctly. On Windows, without Developer Mode or admin rights, Git falls back to `core.symlinks=false` and writes symlinked paths (e.g. `.claude/skills`) as plain text files instead of real links. If the selected lesson has git-tracked symlinks and that fallback is active, `reset` prints how to fix it (enable Developer Mode or run as Administrator, `git config core.symlinks true`, then reset again) before proceeding.
