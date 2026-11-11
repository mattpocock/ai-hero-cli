---
"ai-hero-cli": minor
---

`ai-hero fork` now keeps the course's git history instead of squashing it into a single "Initial commit". It removes the course's `origin` remote, creates your GitHub repo, and pushes your `main` branch, with its history, to it as `origin`. Only `main` is pushed: other branches and tags stay on your machine. Because your `main` now shares history with the course, a later `reset` or `pull` lines up with it instead of reporting that the branches have diverged.

`fork` now stops, changing nothing, if you're not on `main`, if you have uncommitted changes to tracked files, or if the clone is shallow, and says how to fix each. The symlink warning is gone: the push publishes the course's commits, which record symlinks as symlinks even where they're checked out as plain files.
