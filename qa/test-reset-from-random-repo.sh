# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
cd ../../throwaway
rm -rf cohort-003-project
git clone git@github.com:ai-hero-dev/cohort-003-project.git
cd cohort-003-project
rm -rf .git
git init
git add .
git commit -m "Initial commit"
node ../../ai/ai-hero-cli/dist/bin.cjs reset --branch live-run-through --upstream https://github.com/ai-hero-dev/cohort-003-project.git
