---
id: WO-0076
title: "Probe — the structured-question surface (AskUserQuestion) through the SDK"
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0076 — probe: the structured-question surface through the SDK

## Objective

The operator wants the architect to ask questions THE WAY Claude Code does: options to pick
(radio single-select / checkbox multi-select), an "Other" free answer, and the agent's own
recommendation marked. Docket's ask card today is binary (İzin ver / Reddet) + free-text steer —
no structured questions. Before any port/card work: MEASURE whether the SDK exposes this surface
(TD-016 discipline — the SDK is a version-pinned surface, never assumed).

## The measured questions (each answered with a quoted raw-log line)

1. **Offered?** Does a plain SDK session (0.3.221, `canUseTool` attached, no allowlist games)
   let the model call `AskUserQuestion` — or is it harness-internal and absent?
2. **The payload.** When it fires: the EXACT tool name the fence sees; the `input` shape
   (questions array? option label/description fields? a multiSelect flag? how the recommendation
   is carried — a `(Recommended)` label suffix or a field?); anything else harness-shaped.
3. **The answer path.** Can the host resolve it via the permission response (`behavior: 'allow'`
   with the SELECTION folded into `updatedInput`)? What exactly does the model receive back, and
   does the turn continue coherently with the selection honored?
4. **The transcript.** What the stream records (tool_use / tool_result / user-message echo) —
   what Docket's ledger would render for it.
5. **The deny path.** Refusing a question — what the model does next (re-asks? proceeds?).

## Method

`docs/probes/cc-surface/probe-askq.mjs` (the probe-steer.mjs sibling): scenario-driven, real
session (ambient CLI auth), EVERYTHING logged to `raw/askq.log` — the canUseTool calls verbatim,
the stream events, the model's continuation. Scenarios at minimum:
- a1 single-select (3 options, one recommended) → answered with the recommended option
- a2 multi-select (3 options, two chosen) → answered with the pair
- a3 "Other" — a free-text answer instead of any option
- a4 denied question
Subagent-run; orchestrator-verified against the raw log before any commit.

## Scope

In scope: the probe script, the raw log, `report.md` (field-by-field findings, the WO-0062
pattern). Out of scope: ANY src/ or electron/ change (that is WO-0077's, on this evidence).

## Acceptance

1. Every question above has a verbatim-log answer or an honest "the surface does not expose it".
2. No production code touched; the probe script runs standalone (`node probe-askq.mjs a1 out.log`).
3. The report names the WO-0077 design consequences explicitly (what the card can render, what
   the answer path is, what stays impossible on 0.3.221).

## Notes

- Real token spend authorized by the operator (the subagent pipeline ruling, 2026-09-20).
- The report's "design consequences" section is WO-0077's contract — written so the implementer
  never guesses.
