# TEST ALL OF THESE:

`internal edit-commit` - src/internal/edit-commit/

The rest of the `internal` namespace was removed in "chore: trim internal
namespace to edit-commit only"; `edit-commit` is the only surviving command.
Its git layer (`session.ts`) is covered by `test/edit-commit.test.ts`; the
interactive shell (`command.ts`) is prompt-driven and excluded from coverage.
