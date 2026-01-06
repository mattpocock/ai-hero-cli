# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
(cd ../ralph-tutorial && node ../ai-hero-cli/dist/bin.cjs internal edit-commit)
