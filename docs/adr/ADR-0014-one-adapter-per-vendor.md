# ADR-0014: One adapter per vendor, over a machine-readable mode

Date: 2026-08-23 · Status: accepted · Extends: ADR-0006 (layering and provider independence).

## Context

Docket drives agent sessions through one provider today (the SDK adapter in `src/adapters/runner/`).
The self-hosting goal (WO-0039+) raises the question a second vendor will force anyway: where does a
new vendor plug in, and over what surface? Two shapes were on the table:

1. **A machine-readable mode per vendor** — an SDK where one exists, the vendor's `--output-format
   stream-json` (or equivalent) where it does not — translated into Docket's own event stream.
2. **Terminal scraping** — drive the vendor CLI in a pty, render it, and parse what the terminal
   shows (cost lines, plan submissions, completion).

The 2026-08-23 stabilization session (WO-0039's incident trail, order.md Notes) accumulated direct
evidence about what the machine surface carries that a terminal never shows.

## Decision

**One adapter per vendor, over a machine-readable mode.** The `SessionRunner` port
(`src/core/runner.ts`) is the contract: `RunnerEvent` speaks PRODUCT concepts — `plan_ready`,
`turn_complete`, `permission_request`, `interrupted`, cost as `CostSummary` — never vendor concepts
(ADR-0006's rule, restated as the multi-vendor contract). A vendor adapter may sit on the vendor's
SDK (as today's does) or on the CLI's stream-json mode; both are machine-readable event sources
that can be translated faithfully. The composition root selects the adapter; nothing in `core/` or
`ui/` learns a vendor exists.

**Terminal scraping is REJECTED**, on this session's evidence:

- **Cost rides the result message only.** `total_cost_usd` arrives on the result event; aborting
  before it loses the number (the 2026-08-23 maliyet kaybı incident). A terminal shows a formatted
  cost line — locale-dependent, sometimes absent, never typed. Parsing it would be a guess wearing
  a currency sign.
- **The plan gate emits pseudo-results.** The ExitPlanMode deny ("Plan submitted. STOP") surfaces as
  a tool_result the transcript must classify; the harness's own "User has approved your plan…"
  pseudo-result is a second one (both verified in the wild, 2026-08-23). A pty shows none of this
  structure — the plan gate could not be enforced at all.
- **Gates and fences require interception a pty cannot provide.** The write-scope fence
  (ADR-0002) and the permission cadence run inside the SDK's `canUseTool` callback — deny before
  the tool runs, hold mid-stream for the operator. A terminal only shows what already happened.
- **xterm was retired by operator ruling** (WO-0037): the console renders the Ray transcript, not a
  terminal. Reintroducing a pty to host vendors would resurrect the surface the operator removed.

**On record, not decided: the cheap hybrid** — attaching the RAW vendor transcript (the SDK/jsonl
form, not a terminal) to session cards as a display-only artifact ("kaynak döküm"). It imports no
parsing — the artifact is shown or opened externally, never fed back into folds, gates or cost. If
a vendor's machine surface turns out to miss something Docket's events need, the honest first move
is reading the raw transcript, not scraping a pty.

## Consequences

- A second vendor = a second directory under `src/adapters/runner/`-equivalent + a composition-root
  selector. The vendor name stays inside the adapter (ADR-0006's grep unchanged).
- Vendors with no SDK and no stream-json mode are OUT until they grow one — that is the vendor's
  gap, not a reason to loosen the port.
- `checkProvider`'s per-vendor surface (key env, login dir, handshake) lives in the vendor adapter
  too; settings stays vendor-neutral (`ProviderErrorCode`, `ProviderStatus`).
- The E2E fake runner (`electron/e2e-runner.ts`) remains the port's third implementation — the
  proof the contract is implementable without a vendor at all.

## Alternatives rejected

- **Terminal scraping over a pty** — rejected above; every product-critical fact (cost, plan
  submission, permission holds) is either absent from the terminal or untyped there.
- **A "universal agent protocol" abstraction layer above the port** (e.g. an OpenAI-style tool-loop
  shim): premature — it would design for vendors that do not exist and constrain the ones that do.
  The port absorbs what Docket needs; a shared abstraction can be extracted when there are two
  real adapters to compare.
