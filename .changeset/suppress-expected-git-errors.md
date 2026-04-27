---
"ai-hero-cli": patch
---

Suppress confusing `error: No such remote 'upstream'` and `error: branch '<name>' not found` messages that previously leaked to stderr during `reset`, `cherry-pick`, and `pull`. These came from probing git commands whose failure was expected and handled internally, but looked like real errors to users.
