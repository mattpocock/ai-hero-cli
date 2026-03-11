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
node ../../ai/ai-hero-cli/dist/bin.cjs cherry-pick --branch live-run-through --upstream https://github.com/ai-hero-dev/cohort-003-project.git

# Test it twice to see if the first cherry-pick is correctly removed from the list of commits to cherry-pick
node ../../ai/ai-hero-cli/dist/bin.cjs cherry-pick --branch live-run-through --upstream https://github.com/ai-hero-dev/cohort-003-project.git
