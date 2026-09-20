#!/usr/bin/env bash
# docs/probes/forge-issue/probe-issue.sh — WO-0081: the `gh issue` + milestones surface, measured.
# READ-ONLY by construction: every call below is a list/view/api-GET. The script contains NO
# mutation flag (no create/edit/close/comment/label/milestone write, no reaction) — grep-able
# guarantee: nothing here writes to the forge. Rerun to refresh the raw logs.
#
# Usage: probe-issue.sh [owner/repo ...]   (default: the antreo repos observed active for issues)
# Raw logs land in docs/probes/forge-issue/raw/ — one file per measurement. NOTE: the logs the
# WO-0081 report cites (raw/00-…25-…) are the probe's FIRST run, captured interactively; a rerun
# refreshes the same READS under the per-repo names below (1x-<slug>-…), so a rerun APPENDS a
# second set rather than overwriting the cited files.
set -u
cd "$(dirname "$0")"
mkdir -p raw

REPOS=("$@")
[ ${#REPOS[@]} -eq 0 ] && REPOS=(antreo-app/api antreo-app/docs antreo-app/mobile antreo-app/admin-web)
SAMPLE_REPO="${REPOS[0]}"

log() { echo "$@"; } # passthrough; each block tees its own raw file

# --- identity + budget (order Q7) -----------------------------------------
gh --version                                        > raw/00-gh-version.txt 2>&1
gh auth status                                      > raw/02-auth-status.txt 2>&1
gh auth status --json hosts                        >> raw/02-auth-status.txt 2>&1
gh api rate_limit                                   > raw/03-rate-limit.json 2>&1

# --- the org's repos (order Q1) --------------------------------------------
gh api "orgs/antreo-app/repos?per_page=20" --jq 'map({name,description,private,pushed_at})' \
                                                    > raw/01-org-repos.json 2>&1

for repo in "${REPOS[@]}"; do
  slug="${repo#*/}"
  # --- gh issue list: the board-level field set (order Q2) -----------------
  gh issue list -R "$repo" --state all --limit 10 \
    --json number,title,state,labels,milestone,createdAt,updatedAt,closedAt \
                                                    > "raw/1x-${slug}-issue-list-all.json" 2>&1
  # plain human table (the card-cut reference shape)
  gh issue list -R "$repo" --state open             > "raw/1x-${slug}-issue-list-plain.txt" 2>&1
  # open-count only (the board's headline number)
  gh issue list -R "$repo" --state open --json number | python3 -c \
    'import json,sys; print("open issues:", len(json.load(sys.stdin)))' \
                                                    > "raw/1x-${slug}-open-count.txt" 2>&1

  # --- milestones (order Q1 + Q5) ------------------------------------------
  gh api "repos/${repo}/milestones?state=all&per_page=20" \
                                                    > "raw/1x-${slug}-milestones.json" 2>&1

  # --- the link convention probe (order Q6): does the repo carry WO- ids? --
  gh issue list -R "$repo" --state all --search "WO- in:title,body" --json number,title \
                                                    > "raw/1x-${slug}-search-WO.json" 2>&1
done

# --- field-list discovery: an unknown field makes gh print the valid set ---
gh issue list -R "$SAMPLE_REPO" --json bogusfield   > raw/11-issue-list-fieldlist.txt 2>&1

# --- body/comments accepted on LIST? (order Q2/Q3 — cost measurement) ------
gh issue list -R "$SAMPLE_REPO" --state all --limit 2 --json number,title,body,comments \
                                                    > raw/12-issue-list-body-comments.json 2>&1

# --- one real issue: the per-issue shape (order Q3) ------------------------
# SAMPLE_NUMBER below is a real open issue in the sample repo; bump on rerun.
SAMPLE_NUMBER=333
gh issue view "$SAMPLE_NUMBER" -R "$SAMPLE_REPO" \
  --json number,title,state,body,labels,milestone,url,createdAt,closedAt \
                                                    > raw/14-issue-view.json 2>&1

# --- the structured link fields (order Q6) ---------------------------------
gh issue view "$SAMPLE_NUMBER" -R "$SAMPLE_REPO" \
  --json number,state,stateReason,blockedBy,blocking,parent,subIssues,subIssuesSummary,closedByPullRequestsReferences \
                                                    > raw/15-issue-linkfields.json 2>&1

# --- REST shapes (order Q4) -------------------------------------------------
gh api "repos/${SAMPLE_REPO}/issues?state=all&per_page=3"     > raw/16-rest-issues.json 2>&1
gh api -i "repos/${SAMPLE_REPO}/issues?state=all&per_page=3"  > raw/17-rest-issues-headers.txt 2>&1
gh api "repos/${SAMPLE_REPO}/issues/${SAMPLE_NUMBER}"         > raw/18-rest-issue.json 2>&1
gh api "repos/${SAMPLE_REPO}/milestones?state=all&per_page=20" > raw/19-rest-milestones.json 2>&1

# --- search: the two paths agree? (order Q6) --------------------------------
SEARCH_WORD="Netgsm"   # a distinctive word from a real title; bump on rerun
gh issue list -R "$SAMPLE_REPO" --state all --search "${SEARCH_WORD} in:title" --json number,title,state \
                                                    > raw/20-search-gh.txt 2>&1
gh api -X GET search/issues -f q="${SEARCH_WORD} in:title repo:${SAMPLE_REPO} is:issue" \
                                                    > raw/20a-search-rest.json 2>&1
# cross-repo title-ref search (the operator's observed convention)
gh issue list -R antreo-app/mobile --state all --search "api#330 in:title" --json number,title,state \
                                                    > raw/22-search-crossref.json 2>&1
# org-wide search (the scan policy's one call)
gh api -X GET search/issues -f q="${SEARCH_WORD} in:title org:antreo-app is:issue" \
                                                    > raw/22a-search-org.json 2>&1

# --- labels actually used? (ADR-0010 minimalism input) ----------------------
gh api "repos/${SAMPLE_REPO}/labels?per_page=10"    > raw/23-rest-labels.json 2>&1

# --- default page size (order Q2) -------------------------------------------
gh issue list -R antreo-app/docs --state all --json number | python3 -c \
  'import json,sys; print("default rows returned:", len(json.load(sys.stdin)))' \
                                                    > raw/23a-default-pagesize.txt 2>&1

echo "probe complete — raw logs in docs/probes/forge-issue/raw/"
