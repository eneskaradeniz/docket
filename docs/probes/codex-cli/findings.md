# Codex CLI probe — the ADR-0014 bar (WO-0106, 2026-09-25)

The WO-0095 posture (agy), generalized: a vendor is probed against ADR-0014's bar BEFORE a
definition + wiring lands. Target: **Codex CLI** (`@openai/codex`, `codex` binary) — the
"tests written by a different vendor" candidate. Measured on `codex-cli 0.157.0` (npx-run,
macOS arm64), UNAUTHENTICATED (no codex login on this machine — the authenticated arms are
marked UNMEASURED below and the probe script re-runs them in one command when a login exists).

## Method

- `codex --version`, `codex exec --help`, `codex exec resume --help` — the flag surface.
- `codex exec --json --skip-git-repo-check -s read-only -` with a one-line prompt on stdin —
  the live event stream of an auth failure (the full log: `raw/exec-unauth.log`).
- `codex login status` — the auth probe's two states.
- The event/item schema cross-read from the vendor's own SDK types (`sdk/typescript/src/
  events.ts`, `items.ts` in the open-source repo — the exec events are generated from the same
  Rust source that emits them; cited per row below).

## The bar

| ADR-0014 requirement | Verdict | Evidence |
|---|---|---|
| Machine-readable output mode | **PASS (measured)** | `exec --json` emits typed JSONL: `thread.started {thread_id}`, `turn.started`, `item.started/updated/completed {item}`, `turn.completed {usage}`, `turn.failed {error}`, `error {message}` — live-observed in `raw/exec-unauth.log`, schema per `events.ts`. |
| Cost on the terminating message | **PARTIAL (tokens yes, usd never)** | `turn.completed` carries `usage {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens}` — no price field anywhere in the event union. Docket maps the token counts + cache split verbatim; `usd` stays 0-with-real-tokens (the spend ledger's `hasUnknown` arm). CONSEQUENCE (named): a Codex drive's usd is invisible to the budget gate — the month cap counts Claude spend only. |
| Permission / plan-gate signal intercepted or observed | **OBSERVED only (named residual)** | exec mode has NO approval callback (`--approve-for-me` exists precisely because exec cannot ask). Tool work surfaces POST-HOC as items (`command_execution {command, aggregated_output, exit_code, status}`, `file_change {changes[], status}`, `mcp_tool_call`) — no hold is possible. The SANDBOX is the fence: `-s read-only` (verifier), `-s workspace-write` (implementer/architect). RESIDUAL: a workspace-write sandbox cannot distinguish the decision store from the repo (the architect's ADR-0002 write-scope is coarser here). The plan gate works Docket-side: no plan mode exists in exec, so the engine's plan fallback (the final message IS the plan, the SDK adapter's own fallback arm) + Docket's approvePlan gate carry it — the vendor never self-approves. |
| Quota / usage windows | **ABSENT (honest)** | The exec event union carries no rate-limit surface (the TUI/app-server surfaces them, not `--json`). No `limit_windows` events for Codex drives — the warn line and limit card render absent, never fabricated. |

## Resume (Sürdür)

`codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` — the id is the `thread.started.thread_id`
captured from the stream (capture-style), the prompt rides stdin as `-`. Resume carries `--json`
and `-m` but NOT `-C`/`-s`: the thread's own cwd and sandbox stand (confirmed against
open-design's independent measurement of the same CLI, `runtimes/defs/codex.ts:380-402`).

## Auth probe

`codex login status` → `Not logged in` (exit 0) measured; the logged-in arm prints
`Logged in using <mode>` (documented shape). Zero tokens, no side effects — the def's
`authProbe` maps both.

## UNMEASURED (needs one authenticated run)

1. `turn.completed`'s live usage numbers (shape is documented; values never observed here).
2. Live item payload shapes (`agent_message.text` with real content, `file_change.changes`).
3. SIGINT behavior mid-turn (the interrupt-calm-close arm of the engine is generic; codex's own
   interrupted-turn event, if any, is unobserved).

**Probe script**: `probe.mjs` (this directory) runs all three against a logged-in codex and
prints the verdict. Flip `CODEX_PROBE_PASSED` in `src/adapters/cli-runner/defs/codex.ts` to
`true` when it passes — that constant is the wiring gate (the registry refuses the vendor until
then; the settings surface shows it as «henüz değil»).

## Verdict

**PASS with named residuals** on the measurable bar: the machine-readable mode is real and
typed, tokens+cache arrive on the terminating message, the sandbox + Docket-side approval carry
the fence/plan duties with the architect's coarse-sandbox residual NAMED, and the missing
usd/quota surfaces are honest absences, not fabrications. The def ships **pending** the one
authenticated spot-check the operator can run in a minute.
