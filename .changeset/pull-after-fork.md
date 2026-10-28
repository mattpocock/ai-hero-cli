---
"ai-hero-cli": patch
---

`ai-hero pull` now works on `main` straight after `ai-hero fork`. Forking starts a fresh history with a single root commit, so the first pull used to fail with "refusing to merge unrelated histories". `pull` now allows unrelated histories when the current branch shares no common ancestor with `upstream/main`; when it does share history, `main` keeps refusing unrelated merges as before.
