---
name: what-to-test
description: Use when writing tests, improving coverage, or deciding what to test in this CLI
version: 1.0.0
---

# What to Test

## Philosophy

Test user-facing behavior. If a user would notice it's broken, it needs a test.

All CLI commands must be tested - including commands marked "internal". Internal commands are still user-facing (Matt uses them daily).

## What Makes a Good Test

- Tests behavior users depend on
- Validates real workflows, not implementation details
- Catches regressions before users do

Do NOT write tests just to increase coverage numbers. Use coverage as a guide to find untested user-facing behavior.

## What NOT to Test

Use `/* v8 ignore start */` for:

- Integration boundaries (actual git calls, shell execution, filesystem)
- Service layers that get mocked in tests
- Entry points and DI wiring
- Boilerplate, unreachable error branches

## Testing Pattern

1. Export a `runX()` function from command files for testability
2. Mock external services (GitService, PromptService)
3. Test error paths users will actually hit
4. Use v8 ignore for CLI formatting/presentation code
