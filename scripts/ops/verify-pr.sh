#!/usr/bin/env bash
set -Eeuo pipefail

# verify-pr.sh — Mechanical PR verification for Docket
# Usage: verify-pr.sh <pr> [--ui] [--dry-run] [--allow-busy]

# A silent exit looks like "no result" to merge-pr.sh; every early failure must be loud.
trap 'rc=$?; echo "Aborting: verify-pr.sh line $LINENO failed (rc $rc)" >&2' ERR

pr=""; ui_flag=0; dry_run=0; allow_busy=0

for arg in "$@"; do
  case "$arg" in
    --ui) ui_flag=1 ;;
    --dry-run) dry_run=1 ;;
    --allow-busy) allow_busy=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) [ -z "$pr" ] && pr="$arg" || { echo "Unexpected argument: $arg" >&2; exit 1; } ;;
  esac
done

if [ -z "$pr" ]; then
  echo "Usage: verify-pr.sh <pr> [--ui] [--dry-run] [--allow-busy]" >&2
  exit 1
fi

pr_json=$(gh pr view "$pr" --json headRefName,headRefOid,mergeStateStatus,baseRefName,changedFiles,files)
base_ref=$(printf '%s' "$pr_json" | jq -r '.baseRefName')
[ "$base_ref" = "main" ] || { echo "Aborting: base branch is not main (got $base_ref)" >&2; exit 1; }

head_ref=$(printf '%s' "$pr_json" | jq -r '.headRefName')
head_oid=$(printf '%s' "$pr_json" | jq -r '.headRefOid')
merge_state=$(printf '%s' "$pr_json" | jq -r '.mergeStateStatus')
sha7="${head_oid:0:7}"

ui_mode=$ui_flag
if [ "$ui_mode" -eq 0 ]; then
  # sed drains the whole stream; head -n 1 closes the pipe after line 1, jq dies on
  # SIGPIPE (rc 141) and pipefail aborts the script with no output at all.
  has_ui=$(printf '%s' "$pr_json" | jq -r '
    .files[]?.path | select(startswith("src/presentation/") or startswith("electron/") or startswith("e2e/"))
  ' | sed -n '1p')
  [ -n "$has_ui" ] && ui_mode=1
fi

if [ "$dry_run" -eq 1 ]; then
  printf "typecheck\ntest\ncheck:boundaries\nbuild\n"
  [ "$ui_mode" -eq 1 ] && printf "test:ui\ntest:journeys\ntest:layout\n"
  exit 0
fi

if [ "$ui_mode" -eq 1 ] && [ "$allow_busy" -eq 0 ]; then
  if ps -Ao pid,comm,args | awk -v self="$$" '
    NR > 1 && $1 != self {
      cmd = $2; sub(/^.*\//, "", cmd)
      if (cmd ~ /^(claude-glm|agy-worker|copilot-worker|agy)$/) busy = 1
      if (cmd ~ /^(sh|bash|zsh)$/) {
        for (i = 4; i <= NF; i++) {
          if ($i ~ /^-/) continue
          script = $i; sub(/^.*\//, "", script)
          if (script ~ /^(claude-glm|agy-worker|copilot-worker|agy)$/) busy = 1
          break
        }
      }
    }
    END { if (busy) exit 1 }
  '; then :; else
    echo "BUSY"
    exit 3
  fi
fi

main_checkout=$(git worktree list --porcelain | awk '$1=="worktree" && !seen { print $2; seen = 1 }')
wt=$(git worktree list --porcelain | awk -v target="refs/heads/$head_ref" -v oid="$head_oid" -v main="$main_checkout" '
  $1 == "worktree" { cur = $2 }
  (($1 == "branch" && $2 == target) || ($1 == "HEAD" && $2 == oid && cur != main)) && !done { print cur; done = 1 }
')

if [ -z "$wt" ] || [ ! -d "$wt" ]; then
  wt="$main_checkout/.claude/worktrees/verify-$pr"
  [ -d "$wt" ] || git worktree add --detach "$wt" "$head_oid" >/dev/null 2>&1 || git worktree add "$wt" "$head_oid"
fi

if [ ! -d "$wt/node_modules" ] && [ -d "$main_checkout/node_modules" ]; then
  cp -cR "$main_checkout/node_modules" "$wt/node_modules"
fi

log_dir="$HOME/.hy/state/verify/$pr-$sha7"
mkdir -p "$log_dir"
tmp_steps=$(mktemp)
trap 'rm -f "$tmp_steps"' EXIT

steps="typecheck test check:boundaries build"
[ "$ui_mode" -eq 1 ] && steps="$steps test:ui test:journeys test:layout"

verdict="PASS"

for step in $steps; do
  start_sec=$SECONDS
  exit_code=0
  cmd="npm run $step"
  [ "$step" = "test" ] && cmd="npm test"
  case "$step" in test:*) cmd="DOCKET_E2E_QUIET=1 $cmd" ;; esac

  (cd "$wt" && eval "$cmd") > "$log_dir/$step.log" 2>&1 || exit_code=$?
  dur=$(( SECONDS - start_sec ))
  printf '{"name":"%s","exit":%d,"seconds":%d}\n' "$step" "$exit_code" "$dur" >> "$tmp_steps"

  if [ "$exit_code" -eq 0 ]; then
    echo "PASS $step $dur"
  else
    echo "FAIL $step $dur"
    verdict="FAIL"
    break
  fi
done

if [ "$ui_mode" -eq 1 ] && [ "$verdict" = "PASS" ]; then
  report_file="$wt/e2e/.out/report.json"
  if [ ! -f "$report_file" ]; then
    verdict="FAIL"
  else
    report_commit=$(jq -r '.run.commit // empty' "$report_file" 2>/dev/null)
    fail_count=$(jq '([.checks[]? | select(.status == "FAIL")] | length) + ([.journeys[]? | select(.status == "FAIL")] | length)' "$report_file" 2>/dev/null)
    if [ "$report_commit" != "$head_oid" ] || [ "${fail_count:-1}" -ne 0 ]; then
      verdict="FAIL"
    fi
  fi
fi

behind="no"
[ "$merge_state" = "BEHIND" ] && behind="yes"

if printf '%s\n' "$pr" | grep -E '^[0-9]+$' >/dev/null; then
  pr_arg="--argjson pr $pr"
else
  pr_arg="--arg pr $pr"
fi

# shellcheck disable=SC2086
jq -n \
  $pr_arg \
  --arg sha "$head_oid" \
  --slurpfile steps "$tmp_steps" \
  --arg verdict "$verdict" \
  --arg behind "$behind" \
  '{pr: $pr, sha: $sha, steps: $steps, verdict: $verdict, behind: $behind}' > "$log_dir/result.json"

echo "VERDICT $verdict $pr $sha7 behind=$behind"
[ "$verdict" = "PASS" ] && exit 0 || exit 1
