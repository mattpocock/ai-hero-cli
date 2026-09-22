---
"ai-hero-cli": minor
---

**Breaking:** `reset --demo` is now `reset --unstaged` (short alias `-u`, was `-d`). The old name is removed, not aliased.

The flag does the same thing — it leaves the lesson's diff in the working tree as unstaged changes, with `HEAD` on the parent commit — but it is now named for its effect rather than for who was expected to run it.

`--unstaged` also stops skipping the safety checks. It begins with a hard reset, so it discards uncommitted work and unreachable commits like any other reset; it now warns and asks for confirmation first.
