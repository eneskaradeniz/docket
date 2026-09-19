---
id: WO-0067
title: "Agent git actions — the implementer commits, pushes and opens the PR (ADR-0017); the observed track link"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0067 — Agent git actions (ADR-0017)

## Objective

M3's agent-git-actions line, carrying ADR-0017's ruling: the implementer session commits its own
work on a `wo-NNNN-*` branch, pushes (operator-witnessed — push stays risky), and opens the PR
whose title carries the WO number (convention becomes rule). Docket itself gains NO git or forge
write surface; the WO→PR link lands the honest way — the reconciliation scan matches open PRs to
open work orders by the title rule and writes the observed link into the track rows' NULL-since-
birth `pr_url` / `pr_head_sha` columns. The prompt carries the discipline; the permission
machinery already governs the acts; the fence review pins them.

## Context

- **ADR-0017 (this branch) supersedes the operator-commits floor** (ADR-0009's M2 addendum) on
  the WORK repos only; the decision store stays operator-committed, and ADR-0010's ownership
  table stands: git owns the record, the forge owns PR existence, Docket owns pointers.
- **The machinery is already shaped right (verified in the fence review):**
  `classifyCommandLine` rules `git commit`/`add`/`branch`/`checkout` as writes (GIT_WRITE_SUBS);
  `git push` is in the risky set (core/risky.ts) — asked under every rule but full_auto;
  `gh pr create` is ambiguous → ask. The ADR pins this classification AS THE RULING. The
  review's job here is tests, not fence surgery.
- **The columns waited since the fixture era:** `track.pr_url` / `pr_head_sha` are written NULL
  at creation and never filled (store/index.ts:1445-1452). The scan (WO-0064) already holds the
  open PR page per connected repo — matching by title closes the loop with zero new surfaces.
- **The prompt is the discipline's home** (the prompt-overrides M3.5 item will make it editable;
  today it is the compile-time `implementerPrompt`). The agent reads order.md (it has the path)
  and knows its WO id — the prompt needs no pipeline ripple.
- **The Depo section already shows open PRs** (WO-0064) — the observed link becomes visible
  there at the next scan. No detail-screen change in this WO (ADR-0013's scroll stays as is).

## Scope

In scope:

- **ADR-0017** in `docs/adr/` (the ruling: agent commits; feature branches only; push/PR-create
  operator-witnessed; the title rule; the observed link; git still owns the record).
- **Prompt (core, test-first):** `implementerPrompt` gains the git-discipline paragraph — work
  on `wo-NNNN-<slug>` derived from the WO id in order.md; commit the step's work; push; open
  the PR titled `WO-NNNN — …` if none is open; never touch `main`. Verifier/architect prompts
  stay read-only (unchanged, pinned by their existing tests' assertions).
- **Fence review (tests):** pin `classifyCommandLine` for `git commit`/`git push`/`gh pr create`
  (write+in-scope / risky write / ambiguous) and `isRisky` for the same three — the ADR's
  classification as regression-tested fact.
- **The observed link (store, test-first):** `recordForgeScan` (the WO-0064 transaction) also
  matches the scanned open PRs against the workspace's OPEN work orders (title contains the WO
  id) and updates the matching track rows' `pr_url` / `pr_head_sha` / `observed_at`; a PR that
  falls off the page leaves the stale link in place until the scan that replaces the page — the
  page replace already wipes `forge_pr`, and the track link follows the same scan's match (a
  closed PR stops matching: the next scan with no hit clears nothing — the link keeps its last
  observation until a NEW link replaces it; honest-latest-wins, tested). Store pins: match on
  one WO, no false match on a different WO's number substring (WO-006 vs WO-0067 — match on the
  id with a word boundary), closed WOs never match.
- **Docs:** ROADMAP's two-line note (agent git actions delivered; the operator console stays
  open) at closure.

Out of scope:

- The operator git console (the Changes surface with one-click commit/PR/merge) — its own M3
  line; ADR-0017 explicitly leaves merging to the operator.
- Any forge WRITE method; any Docket-side git spawn; prompt-override UI (M3.5).
- The detail screen's record scroll; TD-008's stage derivation; closure-gate changes.

## Acceptance criteria

1. ADR-0017 accepted in `docs/adr/`; its classification claims are pinned by the new fence tests
   (commit/push/gh-create through both `classifyCommandLine` and `isRisky`).
2. `implementerPrompt` carries the discipline (branch, commit, push, PR-create, title rule,
   never-main); the verifier/architect prompts assert unchanged.
3. The scan writes the observed link: a scanned PR titled with an open WO's id fills that WO's
   track row (url + head sha + observed_at); a different WO's number does not false-match; a
   closed WO never matches; a scan without a hit keeps the prior link (latest-wins).
4. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries`.

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the continuing
  BUILD-FIRST delegation, 2026-09-19); ADR-0017 is the ruling this session's operator delegated
  ("devam" on the queue whose next item required it).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) — the
  scenario joins the deferred tour: run a step on a scratch repo, watch the agent's push ask,
  approve, see the PR appear in the Depo section at the next scan.
- ci_green: PENDING — the ladder at the working tree, recorded at PR time.

## Stop-and-ask gates

- Any Docket-side git/forge write surface (the ADR's rejected alternative — stop if the plan
  drifts there).
- `git push` leaving the risky set, or PR-create auto-approving under risky_excluded.
- An agent-asserted (unobserved) PR url reaching any table.
- A `main`-touching instruction anywhere in the prompt (feature branches only).
- Match-widening beyond the title rule without a measured basis.

## Notes

- Chain position: probe → port → observation → closure evidence → health → **agent git actions
  (this)** → operator console (Changes surface) → TD-008/009 + gate engine → M3.5 → M4 → M5.
- The first live exercise of the whole chain (agent pushes → PR opens → scan observes → Depo
  shows → closure evidence matches) is the deferred tour's crown scenario.
