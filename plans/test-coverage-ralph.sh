set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

for ((i=1; i<=$1; i++)); do
  result=$(docker sandbox run claude -p "@test-coverage-progress.txt \
WHAT MAKES A GREAT TEST: \
A great test covers behavior users depend on. It tests a feature that, if broken, would frustrate or block users. \
It validates real workflows - not implementation details. It catches regressions before users do. \
Do NOT write tests just to increase coverage. Use coverage as a guide to find UNTESTED USER-FACING BEHAVIOR. \
If uncovered code is not worth testing (boilerplate, unreachable error branches, internal plumbing), \
add /* v8 ignore next */ or /* v8 ignore start */ comments instead of writing low-value tests. \
\
PROCESS: \
1. Run pnpm coverage to see which files have low coverage. \
2. Read the uncovered lines and identify the most important USER-FACING FEATURE that lacks tests. \
   Prioritize: error handling users will hit, CLI commands, git operations, file parsing. \
   Deprioritize: internal utilities, edge cases users won't encounter, boilerplate. \
3. Write ONE meaningful test that validates the feature works correctly for users. \
4. Run pnpm coverage again - coverage should increase as a side effect of testing real behavior. \
5. Run pnpm typecheck to verify the types are correct. \  
6. Append super-concise notes to test-coverage-progress.txt: what you tested, coverage %, any learnings. \
7. Commit with message: test(<file>): <describe the user behavior being tested> \
\
ONLY WRITE ONE TEST PER ITERATION. \
If statement coverage reaches 100% and the types check, output <promise>COMPLETE</promise>. \
")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "100% coverage reached, exiting."
    tt notify "AI Hero CLI: 100% coverage after $i iterations"
    exit 0
  fi
done
