# This script is used to test the CLI commands on a local repo
set -e

pnpm run build

# Every `internal` command is interactive: each needs a TTY and prompts for the
# lesson to act on. Pass `--commit <lesson-id>` to skip the picker where the
# command accepts one (add-commit asks for its insertion point instead).
#
# Pass a command name to run just that one, e.g. `./qa/test-edit-commit.sh add`.
# With no argument you get the menu that a bare `internal` opens.
COMMAND="${1:-menu}"

case "$COMMAND" in
  menu)   ARGS="" ;;
  edit)   ARGS="edit-commit" ;;
  add)    ARGS="add-commit" ;;
  rename) ARGS="rename-commit" ;;
  delete) ARGS="delete-commit" ;;
  *)
    echo "Unknown command: $COMMAND (expected menu|edit|add|rename|delete)" >&2
    exit 1
    ;;
esac

# shellcheck disable=SC2086
(cd ../ralph-tutorial && node ../ai-hero-cli/dist/bin.cjs internal $ARGS)
