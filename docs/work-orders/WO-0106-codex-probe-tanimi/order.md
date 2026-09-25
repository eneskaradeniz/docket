---
id: WO-0106
title: "The Codex CLI probe + vendor definition — the ADR-0014 bar measured, the def shipped behind its verdict"
workspace: docket
status: implementing
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0106 — the Codex probe + definition (Faz C)

Issue #107 · Phase C of `docs/research/2026-09-25-multi-cli-provider-architecture.md`.

## Objective

Probe Codex CLI against ADR-0014's bar (the WO-0095 agy posture, generalized) BEFORE writing the
definition + wiring; ship the def behind the probe's verdict. Measured on `codex-cli 0.157.0`
(npx-run): the flag surface (`exec --json`, `-s read-only|workspace-write`, `-C`, `-m`,
`exec resume <id>`, stdin prompts), the live unauthenticated event stream (`thread.started` →
`turn.started` → typed `error`s → `turn.failed`, exit 1), and `login status`'s two states. The
event/item schema cross-read from the vendor's own SDK types. The authenticated arms (live usage
numbers, real item payloads, the SIGINT close shape) were UNMEASURABLE here (no codex login) —
the probe script (`docs/probes/codex-cli/probe.mjs`) measures them in one command when the
operator has a login.

## Frozen decisions

- **The probe's verdict is the wiring gate.** `CODEX_PROBE_PASSED` in the def file is `false`
  until the authenticated spot-check prints PASS — the registry does not carry the vendor, a
  route naming it refuses with `vendorRefusal`, and the settings surface (Faz E) lists it under
  «henüz değil». Flipping the constant is a commit with findings.md's PASS in hand.
- **PASS with named residuals** (findings.md's table): tokens + the cache split arrive on
  `turn.completed` (never a price — `usd` stays 0-with-real-tokens, the ledger's `hasUnknown`
  arm; the budget gate therefore does not see Codex spend — TD-067); the sandbox is the fence
  (no approval interception in exec mode; the architect's workspace-write row is the named
  coarse-fence residual); no quota windows in the exec stream (honest absent — no limit cards).
- **The map is total over the terminal events, deliberately partial over items**: agent_message,
  command_execution, file_change, mcp_tool_call map; reasoning/web_search/todo_list and the
  non-fatal error item stay unmapped in v1 (nothing fabricates them). The reconnect-noise
  `error` events map to NOTHING (turn.failed / the engine's exit rules carry the truth).

## Scope

In scope:

- `docs/probes/codex-cli/` — findings.md (the bar table, measured/documented/unmeasured rows),
  probe.mjs (the authenticated one-command spot-check), raw/ (the measured unauth stream).
- `src/adapters/cli-runner/defs/codex.ts` — the def: spawn grammar (fresh: `exec --json
  --skip-git-repo-check -C <cwd> -s <role sandbox> -`; resume: `exec resume --json [-m] <id> -`
  WITHOUT -C/-s — the thread carries them), the parser (the measured/documented union), the
  error classifier, the auth probe, `CODEX_PROBE_PASSED`.
- The registry conditional + `checkProvider(profileName?, vendor?)` (the vendor axis scopes the
  zero-token check to the right adapter's probe; an unwired id answers not-ok naming it).
- 13 def tests (measured fixture lines + documented shapes).

Out of scope:

- Flipping `CODEX_PROBE_PASSED` (the operator's authenticated run decides), the settings
  surfaces (Faz E), auto-discovery (Faz D), any second def.

## Acceptance criteria

1. findings.md's table distinguishes measured / documented-cited / unmeasured rows; the raw log
   backs every measured claim.
2. The def's tests pin: thread.started→started, the noise→nothing, turn.failed→error, the
   item mappings (agent_message/command_execution/file_change/mcp_tool_call), the
   usage-without-price cost mapping (+ the zero-cache absent arm), the resume grammar (no
   -C/-s), the role sandbox, both auth-probe states, the pending gate constant.
3. The registry carries Codex ONLY behind CODEX_PROBE_PASSED (compile-time conditional, pinned
   by the constant's test); checkProvider routes by vendor.
4. CI green; E2E untouched (nothing new is wired).

## Evidence required

- The four CI checks; `npm test` showing the codex block.
- The operator's follow-up (end-of-wave tour): run `codex login`, then
  `node docs/probes/codex-cli/probe.mjs` — attach its verdict to findings.md and flip the
  constant when it prints PASS.

## Stop-and-ask gates

- If a wired-but-unprobed posture is ever requested — stop and ask (the issue's own rule).
- If the authenticated probe reveals a shape the parser cannot map honestly — stop and ask
  (the def is amended, never papered over).

## Notes

- TD-067 records the budget-gate blind spot (Codex spend carries no usd). When the vendor is
  enabled, the workspace budget card's sentence should learn to say "Codex spend not counted"
  — a Faz E refinement.
