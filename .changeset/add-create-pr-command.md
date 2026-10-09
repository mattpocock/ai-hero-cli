---
"ai-hero-cli": minor
---

Add `create-pr`: opens a draft PR on your GitHub repo (`origin`) containing only one lesson's diff.

```sh
ai-hero create-pr <lesson-id> --branch=live-run-through --upstream=<url>
```

It resolves the lesson commit exactly as `reset` does, pushes the lesson's parent to `origin` as `pr-base/<lesson-id>`, and builds `pr/<lesson-id>` as a single commit on top of it carrying the lesson's tree (message with the `<lesson-id>: ` prefix stripped). Both branches are owned by the CLI and are force-pushed, so retakes work after the course stack is rewritten. If an open PR for `pr/<lesson-id>` already exists, its title, body and base are reset and it is turned back into a draft; otherwise a new draft PR is created with `gh pr create --fill`.

It refuses to run with uncommitted changes, needs the GitHub CLI installed and logged in, needs `origin` to be a GitHub repository, and asks before replacing an existing local `pr/<lesson-id>` branch.
