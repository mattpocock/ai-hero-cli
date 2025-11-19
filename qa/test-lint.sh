# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
(cd ../cohort-002-skill-building && node ../ai-hero-cli/dist/bin.cjs internal lint)
