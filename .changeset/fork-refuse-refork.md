---
"ai-hero-cli": patch
---

`ai-hero fork` now refuses, changing nothing, when the folder is already forked (its `origin` is a GitHub repo you own), and says which repo it's forked to. Before, it offered to "disconnect this folder from the course repo" when `origin` was really your own repo. The "already exists" error no longer suggests `gh repo delete`: the repo it names isn't this folder's, and may be your work from another folder.
