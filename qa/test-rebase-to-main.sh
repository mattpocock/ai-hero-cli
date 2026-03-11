# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
(cd ../cohort-003-project && node ../ai-hero-cli/dist/bin.cjs internal rebase-to-main)
