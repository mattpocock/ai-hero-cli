# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
cd ../../throwaway
rm -rf cohort-002-project
git clone git@github.com:ai-hero-dev/cohort-002-project.git
cd cohort-002-project
node ../../ai/ai-hero-cli/dist/bin.cjs cherry-pick --branch live-run-through
