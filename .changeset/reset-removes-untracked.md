---
"ai-hero-cli": patch
---

`ai-hero reset` now removes untracked files once you confirm losing uncommitted work — previously they were listed in the warning but survived the reset. Gitignored files (like `node_modules` or a local database) are still left alone.
