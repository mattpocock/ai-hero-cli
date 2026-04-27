---
"ai-hero-cli": patch
---

Clean up the upstream remote and local tracking branch when CLI commands finish. Only cleans up resources that the CLI added -- if the user already had an upstream remote configured, it is left untouched.
