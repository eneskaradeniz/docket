---
id: WO-0081
title: "Probe — the gh issue surface (the antreo bridge's first WO)"
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0081 — probe: the `gh issue` surface

## Objective

The operator tracks antreo through GitHub issues + milestones (and notes teams also live in
Jira/Odoo). The ruled direction (2026-09-20 discussion): **link-and-observe, never sync** — the
tracking truth stays in Docket's spine (WO + roadmap), an external issue becomes a LINKED,
OBSERVED fact (`issue:` front-matter, the `task:` pattern; a board/detail state line; at most a
gated single write at WO closure later). Before any port work: MEASURE the surface (the WO-0062
forge-probe discipline; TD-061 keeps unmeasured surfaces shut).

## The measured questions (each answered with a verbatim log line)

1. **The repo reality.** Which antreo repo(s) exist under the operator's account, which are in
   active use for issues — counts (open/closed), a sample issue title, and whether MILESTONES
   are actually in use (any milestone with issues).
2. **`gh issue list`** — the exact `--json` field names available (number, title, state,
   labels, milestone, assignees, createdAt, updatedAt, closedAt…), state filters, the default
   and max page size, and the flags that matter for a Docket read (limit/search).
3. **`gh issue view`** — the per-issue JSON shape (body? comments? url?) and what Docket should
   NOT read (ADR-0010 minimalism: lift only what a card renders).
4. **The REST shape** — `gh api repos/o/n/issues` (list + one issue): field names at the API
   level, pagination headers/`perPage`, and anything the gh wrapper hides.
5. **Milestones** — `gh api repos/o/n/milestones`: shape (number/title/state/open_issues/
   due_on) and whether reading them is worth a port surface at all (the roadmap fazlar remain
   the planning truth — the probe only measures, decides stay for WO-0082).
6. **The link question** — can Docket find the issue(s) for a WO WITHOUT front-matter? Measure
   `gh issue list --search "WO-NNNN"` (title/body search, the WO-0065 title-rule precedent)
   against a real WO-numbered title if antreo has one; otherwise record the search mechanics on
   any test issue-like string.
7. **Identity + limits** — `gh auth status` (the same identity the forge adapter uses) and
   `gh api rate_limit` (what a scan/watch policy can afford).

## Method

`docs/probes/forge-issue/probe-issue.sh` (the forge-probe sibling — gh calls, not SDK), raw logs
under `docs/probes/forge-issue/raw/`, findings in `report.md` (the WO-0062 pattern: field-by-
field, verbatim quotes, then "WO-0082 design consequences" — the proposed port shapes, the
search strategy, pagination policy, and the minimal-read cut). Subagent-run; the orchestrator
verifies against the raw logs before any commit.

## Scope

In scope: the probe script, raw logs, report.md. Out of scope: ANY src/ or electron/ change
(WO-0082's), any write to the antreo repos, creating issues/comments/labels (READ-ONLY probe).

## Acceptance

1. Every question above has a verbatim-log answer or an honest "not in use / not exposed".
2. The probe is read-only end-to-end (no mutation flags anywhere in the script).
3. report.md's design-consequences section names WO-0082's contract explicitly.

## Notes

- The other WO-0082 numbering decision: issues-port work follows as WO-0082 (probe → port).
- Real repos touched READ-ONLY; the operator authorized the subagent pipeline (2026-09-20).
