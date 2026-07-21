# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
# `internal edit-commit` is interactive: it needs a TTY and prompts for the
# lesson to edit. Pass `--commit <lesson-id>` to skip the picker.
(cd ../ralph-tutorial && node ../ai-hero-cli/dist/bin.cjs internal edit-commit)
