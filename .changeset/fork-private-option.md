---
"ai-hero-cli": minor
---

`ai-hero fork --private` creates a private GitHub repo instead of a public one, for students whose account or employer only allows private repos. Public is still the default: the course's GitHub Actions are free only on public repos. If creating the repo fails after your local history was reset, `fork` now prints the `gh repo create … --source=. --remote=origin --push` command that finishes the job by hand.
