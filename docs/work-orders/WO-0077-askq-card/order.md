---
id: WO-0077
title: "The structured ask card — radio/checkbox questions, Diğer, the recommended badge"
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0077 — the structured ask card

## Objective

When the agent calls `AskUserQuestion`, Docket's ask card renders the QUESTION STRUCTURED —
options to pick (radio for single-select, checkbox for multiSelect), a free-text "Diğer" answer,
and the agent's recommendation marked — and the operator's answer folds back into the drive, which
continues without a restart. WO-0076 measured every load-bearing fact; this order freezes the
contract. **The probe report (`docs/work-orders/WO-0076-askq-probe/report.md`) is the source of
truth — read it first, never guess a field.**

## The contract (all measured, WO-0076)

1. The question arrives as an ordinary permission ask: `PermissionAsk { requestId, tool:
   'AskUserQuestion', input: { questions: [...] } }` — NO new event kind, NO pipeline change is
   expected; the card parses.
2. Parse (core, pure, test-first — NEVER trust the payload): `questions` array (≥1), each question
   `question: string` (THE ANSWER KEY), `header: string` (≤12 chars), `options` (≥2, each
   `label` + `description` string), `multiSelect: boolean`. ANY malformed shape → the parse
   returns undefined and the card falls back to today's binary form (fail-open, the risky-ask
   path is untouched). V1: one question per call renders; a multi-question payload renders its
   FIRST question only (honest + scoped) — or renders all, implementer's call, pinned in the PR.
3. The recommendation: `/\(Recommended\)\s*$/` on an option label — parsed OFF for display and
   rendered as a small "önerilen" badge on that option. The stored/sent label keeps the suffix
   verbatim (measured: the CLI does not strip it).
4. The answer folds back through the EXISTING permission decision channel — the decision the UI
   sends must reach the runner's held callback as the measured response:
   - selection → `{ behavior: 'allow', updatedInput: { ...input, answers: { [question]: labels.join(', ') } } }`
   - other → same shape, value = the free text (matches no label — the CLI's follow-what-they-say template)
   - dismissed → `{ behavior: 'allow' }` (the "did not answer" arm)
   - declined → `{ behavior: 'deny', message }`
   Extend the core decision type minimally so this crosses the port verbatim (vendor-neutral —
   no SDK type names in core; the adapter passes it through). If the existing channel already
   carries it, zero adapter change — VERIFY, do not assume.
5. Card UX (ADR-0001/0012): `header` as the chip, `question` as the head line; options as rows —
   RADIO (single-select) or CHECKBOX (multiSelect); each row = label + dim description; the
   recommended row wears the badge; a "Diğer" row with a text input (free answer, exclusive —
   when non-empty it IS the answer; mixing with selections is not supported in v1); buttons:
   **Cevapla** (primary — disabled-by-absence rules do NOT apply here: the buttons live on the
   ask card which is the guarded form already; enable Cevapla only when an answer exists),
   **Boş geç** (ghost = dismissed), **Reddet** (ghost = declined) — the binary card's economy.
   The question/options text is MODEL DATA rendered through props (ADR-0007's border: only the
   card's fixed chrome — Cevapla, Boş geç, Reddet, önerilen — lives in the tr/en bundles).
6. The transcript/ledger: v1 keeps the generic tool-block rendering of the tool_use/tool_result
   pair (WO-0076 §Q4 — it IS the record). No new event kind. (A structured question rendering is
   a future polish, not here.)

## Acceptance criteria

1. Core parse/fold pinned by tests: every measured arm (selection single + multi join, other,
   dismissed, declined) + malformed payloads (missing questions, <2 options, non-string fields,
   empty question key) → parse undefined, never a throw.
2. The card renders structured for a parsed ask (radio/checkbox/Diğer/badge/labels from bundles)
   and the binary form for an unparseable one; Cevapla sends the measured fold; Boş geç sends the
   bare allow; Reddet sends deny+message.
3. E2E (scripted, the risky-ask spec's emit channel): a structured ask renders, the operator
   answers, the drive continues — the resumed transcript records the resolution.
4. Full ladder green: typecheck ×2, unit, build, boundaries; E2E suite stays green.

## Evidence required

- plan_approval: mode `direct` — the contract IS WO-0076's measured report; the operator ordered
  the subagent pipeline (implement → review → test → PR → merge) 2026-09-20.
- implementer: subagent (test-first; commits on this branch); reviewer: a SEPARATE reviewer
  subagent over the diff before the PR; orchestrator runs the ladder + E2E and merges.
- operator_checkpoint: DEFERRED (BUILD-FIRST) — joins the deferred tours.
- ci_green: RESOLVED — green, 2026-09-20: typecheck (both tsconfigs), **1100 unit tests** (+39:
  35 core parse/fold pins over the probe's verbatim payloads, 4 adapter settle pins with red→green
  proof), build, `check:boundaries`, **E2E 98/98** ("all UI specs green", +2 scripted
  structured-ask specs).
- review: RESOLVED — a separate reviewer subagent returned REVISE (0 blocker / 2 major: the
  useId radio-group collision across parallel ask cards; the unpinned adapter settle crossing);
  both folded with red→green proof (`3cef1e8`), minors included.
- pr_open / closure: RESOLVED — PR #82 (`https://github.com/eneskaradeniz/docket/pull/82`),
  head `3cef1e8`, merged `d81a696` (the operator's subagent-pipeline merge order); closed at the
  commit carrying this line.

## Stop-and-ask gates

- Inventing a `recommended` FIELD (the marker is a label-suffix convention — parse, never store).
- A new event kind or a store migration for this (none is needed — WO-0076 §Q4).
- Weakening the binary path (a malformed payload must fall back, never break the permission flow).
- Vendor vocabulary outside `src/adapters/` (ADR-0006) — core owns shapes with neutral names.
