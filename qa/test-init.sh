# This script is used to test the init command
set -e

pnpm run build
node dist/bin.cjs internal init --base ~/repos
