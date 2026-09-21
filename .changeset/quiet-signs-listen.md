---
"ai-hero-cli": patch
---

Commands that create a commit no longer hang when git commit signing is enabled. `fork`, `cherry-pick`, `pull` and the internal `add-commit`/`edit-commit`/`rename-commit`/`delete-commit` flows now inherit stdin, so a GPG or SSH signing tool can prompt for your key's passphrase on your terminal instead of blocking forever on a disconnected pipe. The same fix applies to the `gh repo create --push` step of `fork`, which could hang if the push needed an SSH key passphrase.
