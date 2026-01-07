set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

for ((i=1; i<=$1; i++)); do
  result=$(docker sandbox run claude -p "@plans/test-coverage-plan.md @.claude/skills/what-to-test/SKILL.md @test-coverage-progress.txt \
PROCESS: \
1. Run pnpm coverage to see which files have low coverage. \
2. Read the uncovered lines and identify the most important USER-FACING FEATURE that lacks tests. \
3. Write ONE meaningful test that validates the feature works correctly for users. \
4. Run pnpm coverage again - coverage should increase as a side effect of testing real behavior. \
5. Run pnpm typecheck to verify types are correct. \
6. Append super-concise notes to test-coverage-progress.txt: what you tested, coverage %, any learnings. \
7. Commit with message: test(<file>): <describe the user behavior being tested> \
\
ONLY WRITE ONE TEST PER ITERATION. \
If statement coverage on the entire codebase reaches 100% and types check, output <promise>COMPLETE</promise>. \
")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "100% coverage reached, exiting."
    tt notify "AI Hero CLI: 100% coverage after $i iterations"
    exit 0
  fi
done
