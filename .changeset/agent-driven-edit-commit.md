---
"ai-hero-cli": minor
---

Make `internal edit-commit` agent-drivable. The previously interactive, single-session command is now a resumable state machine split into five non-interactive subcommands — `begin`, `continue`, `status`, `abort`, and `publish` — backed by a session file under `.git/ai-hero/`. Each verb emits a single JSON envelope on stdout (phase, target commit, following count, conflicted files, and the suggested next step) and reports typed error codes (`session_exists`, `no_session`, `commit_not_found`, `unresolved_conflicts`, `lease_rejected`), so an agent can drive the whole edit → recompose → force-push flow without a TTY. `continue` is phase-aware (re-authors the commit, replays following commits, and refuses to proceed while conflict markers remain); `publish` is a separate, re-runnable step guarded by `--force-with-lease`.
