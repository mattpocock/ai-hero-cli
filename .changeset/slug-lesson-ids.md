---
"ai-hero-cli": minor
---

Accept lesson **slugs** (not just numeric `NN.NN.NN` ids) in `reset` and `cherry-pick`. A lesson id is now "the token before the first `": "` in a commit message", so a slug (`add-settings-json`), a numeric id (`06.06.01`), and anything else are handled by one generic parser — numeric is just a slug that happens to have dots.

To keep base and conventional-commit lines (`chore: …`, `fix: …`) from masquerading as lessons now that any `token: message` prefix is an id, the candidate set is scoped to the lesson stack `upstream/main..<branch>` instead of the branch's full history — a structural fence, no denylist or slug-shape heuristic. Repos without an `upstream/main` to anchor on fall back to full-branch history (the base `initial` commit has no `": "` and drops out anyway).

Candidates now list in commit order (teaching order carried by the stack) rather than sorted by id, and duplicate-slug resolution picks the latest (newest) matching commit. Numeric ids keep their existing ergonomics — `1.1.1` still normalizes to `01.01.01`.

Known limitation: a non-lesson commit deliberately stacked *inside* `main..<branch>` (e.g. a stray `chore:` reconcile commit) will still surface as a lesson — the fence removes base commits, not stray commits living on the stack. Keep the stack a clean set of lesson slugs.
