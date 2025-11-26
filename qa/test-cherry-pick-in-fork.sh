# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
(cd ../cohort-002-project-fork && node ../ai-hero-cli/dist/bin.cjs cherry-pick --branch live-run-through)
