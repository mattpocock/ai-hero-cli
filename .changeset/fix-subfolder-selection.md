---
"ai-hero-cli": patch
---

Fixed TypeError when selecting the first subfolder (index 0) in exercises. The `prompts` library treats `0` as falsy and returns the title string instead, causing `path.join` to receive `undefined`. Now uses subfolder names as values instead of numeric indices.
