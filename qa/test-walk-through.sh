# This script is used to test the CLI commands on a local repo
set -e

pnpm run build
(cd ../../ts/zod-mini-course && node ../../ai/ai-hero-cli/dist/bin.cjs internal walk-through --live-branch live-run-through --main-branch main)
