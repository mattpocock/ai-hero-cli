---
"ai-hero-cli": minor
---

Add `ai-hero fork` command: turn your course clone into a fresh private GitHub repo you own in one step. It checks the GitHub CLI is installed and authenticated, resets local history to a single commit, creates a private repo, and pushes your files to it as `origin` (GitHub Issues enabled by default). Guides you through the common failure modes (no `gh`, not logged in, repo name already taken, not run from a clone).
