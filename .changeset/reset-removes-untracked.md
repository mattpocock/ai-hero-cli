---
"ai-hero-cli": patch
---

`ai-hero reset` now removes untracked files once you confirm losing uncommitted work — previously they were listed in the warning but survived the reset. The warning now lists every untracked file (including ones inside untracked folders), and files are only removed after the reset itself succeeds. Gitignored files (like `node_modules` or a local database) and nested git repos are left alone.
