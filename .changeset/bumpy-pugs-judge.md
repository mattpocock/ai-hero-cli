---
"ai-hero-cli": patch
---

Made it so that the cherry-pick and reset commands automatically detect the upstream branch. This prevents an issue where hard-coding the git repo can cause authentication issues.
