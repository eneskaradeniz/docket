#!/usr/bin/env bash
set -euo pipefail

# merge-pr.sh — Guarded PR squash-merge for Docket
# Usage: merge-pr.sh <pr> [--yes]

pr=""
yes_flag=0

for arg in "$@"; do
  case "$arg" in
    --yes) yes_flag=1 ;;
    -*)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
    *)
      if [ -z "$pr" ]; then
        pr="$arg"
      else
        echo "Unexpected argument: $arg" >&2
        exit 1
      fi
      ;;
  esac
done

if [ -z "$pr" ]; then
  echo "Usage: merge-pr.sh <pr> [--yes]" >&2
  exit 1
fi

pr_json=$(gh pr view "$pr" --json headRefOid,mergeStateStatus)
if [ -z "$pr_json" ]; then
  echo "Failed to view PR $pr" >&2
  exit 1
fi

head_oid=$(printf '%s' "$pr_json" | jq -r '.headRefOid')
merge_state=$(printf '%s' "$pr_json" | jq -r '.mergeStateStatus')
sha7="${head_oid:0:7}"

result_file="$HOME/.hy/state/verify/$pr-$sha7/result.json"

if [ ! -f "$result_file" ]; then
  echo "Refused: missing verification result for PR $pr ($sha7)" >&2
  exit 2
fi

saved_verdict=$(jq -r '.verdict // empty' "$result_file" 2>/dev/null)
saved_sha=$(jq -r '.sha // empty' "$result_file" 2>/dev/null)

if [ "$saved_verdict" != "PASS" ]; then
  echo "Refused: verification verdict is $saved_verdict" >&2
  exit 2
fi

if [ "$saved_sha" != "$head_oid" ] && [ "$saved_sha" != "$sha7" ]; then
  echo "Refused: verification result is stale for PR $pr" >&2
  exit 2
fi

if [ "$merge_state" != "CLEAN" ]; then
  echo "Refused: $merge_state" >&2
  exit 1
fi

if ! gh pr checks "$pr" >/dev/null 2>&1; then
  echo "Refused: checks not passing" >&2
  exit 1
fi

if [ "$yes_flag" -eq 0 ]; then
  echo "gh pr merge $pr --squash"
  exit 0
fi

gh pr merge "$pr" --squash
gh pr view "$pr" --json state,mergedAt,mergeCommit
