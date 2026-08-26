#!/bin/sh
# Snapshots the four generated artifacts onto the `prd-history` branch, one commit
# per run, so each /prd cycle survives the next one overwriting it.
#
# It never touches HEAD, the working tree or the real index. It builds a tree
# containing only the four artifacts in a temporary index and commits that
# directly, so a snapshot cannot sweep up in-progress code changes and cannot
# interrupt whatever branch you are on.
#
# Read the history with:
#   git log --oneline prd-history
#   git diff prd-history~1 prd-history

set -eu

BRANCH=refs/heads/prd-history
ARTIFACTS='SUBMISSION.md LAUNCH.md SUBMISSION.html LAUNCH.html'

cd "$(git rev-parse --show-toplevel)"

INDEX=$(mktemp)
rm -f "$INDEX"
export GIT_INDEX_FILE="$INDEX"
trap 'rm -f "$INDEX"' EXIT

git read-tree --empty
# shellcheck disable=SC2086
git update-index --add -- $ARTIFACTS
tree=$(git write-tree)

parent=$(git rev-parse -q --verify "$BRANCH" || true)
if [ -n "$parent" ] && [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
  echo "prd-history: no change since $(git rev-parse --short "$parent")"
  exit 0
fi

stamp=$(date '+%Y-%m-%d %H:%M')
if [ -n "$parent" ]; then
  commit=$(git commit-tree "$tree" -p "$parent" -m "PRD cycle $stamp")
else
  commit=$(git commit-tree "$tree" -m "PRD cycle $stamp")
fi

git update-ref "$BRANCH" "$commit"
echo "prd-history: $(git rev-parse --short "$commit") PRD cycle $stamp"
