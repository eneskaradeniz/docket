---
id: WO-0105
title: "The generic CLI-spawn adapter — one SessionRunner over any vendor's machine-readable stream, parametrized by a per-vendor definition (ADR-0014 addendum)"
workspace: docket
status: implementing
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0105 — the generic CLI-spawn adapter (Faz B)

Issue #106 · Phase B of `docs/research/2026-09-25-multi-cli-provider-architecture.md`.

## Objective

Build the SECOND vendor path ADR-0014 names ("a vendor adapter may sit on the vendor's SDK … or
on the CLI's stream-json mode") — once, GENERICALLY: one adapter under `src/adapters/cli-runner/`
that spawns an arbitrary binary and parses its declared machine-readable stream, parametrized by
a per-vendor definition (`CliRunnerDef`: id, bin, args builder, stream parser, auth probe). Every
subsequent vendor (Faz C onward) is a definition file, not a new adapter. No real vendor lands
here — the engine is proven by its own tests against a scripted fake binary (a real spawn, no
vendor), and the composition root's registry gains the multi-entry SHAPE with the built-in SDK
adapter as its only entry.

## Context

- ADR-0014 — "one adapter per vendor, over a machine-readable mode"; the rejected alternative
  was terminal scraping. This WO adds the addendum: the generic spawn adapter IS the stream-json
  arm of that decision, and the per-vendor SANDBOX stands where the SDK's canUseTool cannot.
- `src/core/runner.ts` — the `SessionRunner` port (ADR-0014's contract): `drive/decide/
  pendingAsks/interrupt/abort`, steer optional ("optional-implementers … simply never support
  steering" — a CLI exec has no mid-turn input channel).
- `src/adapters/runner/` — the SDK adapter (the port's first implementation); `electron/e2e-runner.ts`
  is the third (the no-vendor proof).
- open-design's `RuntimeAgentDef` (`~/source/open-design/apps/daemon/src/runtimes/types.ts`) —
  the reference shape: one `spawn()` call site for 26 CLIs, N definition files, no SDK anywhere.
- WO-0104 — the registry seam this plugs into (`vendors()` + the route-receiving factory).

## Frozen decisions

- **The definition owns the vendor; the engine owns the process.** `CliRunnerDef` carries every
  vendor vocabulary item (bin, flags, the stream parser, the error classifier); the engine
  (spawn, line-split, stdin, signals, exit handling) knows nothing vendor-shaped. A vendor name
  appears ONLY in a def file under `src/adapters/` (ADR-0006's grep untouched).
- **The port is honored honestly, not completely.** A CLI `exec` stream has no permission
  callback: `decide`/`pendingAsks` are NOT implemented (the port's optionals stay absent), and
  the per-vendor SANDBOX arguments are the fence-equivalent the def declares per role — the
  ADR-0014 addendum names this honestly (coarser than the SDK's canUseTool; each vendor's probe
  documents the residual surface before it is wired, Faz C's gate).
- **Machine-readable ONLY.** The engine parses NDJSON event lines through the def's parser. A
  vendor whose only output is plain stdout text is NOT a target (ADR-0014's rejection of
  terminal scraping) and never gets a def.
- **Cost honesty (WO-0026/TD-030 discipline).** The def's parser maps what the vendor actually
  reports: tokens counted when reported, `usd` only when the vendor reports it — never an
  invented $0 claim... except that `CostSummary.usd` is a number, so a vendor reporting tokens
  but no price carries `usd: 0` WITH its tokens (the spend ledger's `hasUnknown` arm exists for
  exactly this; a turn with NOTHING observed carries no event at all).
- **Interrupt = SIGINT, abort = SIGKILL.** An interrupt-requested exit closes CALM (the
  `interrupted` event, WO-0039's discipline — never the fail card for an intentional stop).
- **A clean exit with no terminal event is an ERROR event** (the honest "the stream ended
  without a result"), never a fabricated turn_complete.

## Scope

In scope:

- `src/adapters/cli-runner/def.ts` — the `CliRunnerDef` type + `CliSpawnInput` (role, mode,
  prompt, model, resume, cwd) + shared parser helpers (safe JSON line decode).
- `src/adapters/cli-runner/index.ts` — `createCliRunner(def, opts)`: the engine (AsyncQueue
  reuse pattern, spawn, stdin prompt, line-split stdout, stderr capture, signal handling,
  exit→terminal translation), `checkCliVendor(def, env)` (the zero-prompt version/auth probe).
- `src/adapters/cli-runner/index.test.ts` — engine tests against a SCRIPTED FAKE BINARY (a node
  script emitting NDJSON): started/turn_complete flow, cost mapping, error classification,
  interrupt-calm-close, abort, resume args, the sandbox args per role, env composition.
- ADR-0014 addendum (the generic adapter + the sandbox-as-fence honesty note).
- `electron/main.ts` — the registry widens to the `VendorEntry` shape (id, create, modelOptions,
  providerName); still one entry (the built-in SDK adapter). Unknown-vendor routing for
  `modelOptions`/`providerName` reads the registry instead of the hardcoded providerId check.

Out of scope:

- Any real vendor definition (Faz C, #107 — Codex first, behind its probe), auto-discovery
  (Faz D), settings UI (Faz E).
- Steering (no mid-turn input channel on a CLI exec), structured asks (no permission callback),
  the context/limit live feeds (WO-0046/WO-0053 surfaces are SDK-fed; a def's parser MAY emit
  them when its vendor reports the readings — nothing fabricates them).

## Acceptance criteria

1. The engine passes its spawn tests against the scripted fake binary (real process, real
   signals — no mocks of child_process).
2. `SessionRunner` contract: `drive` yields `started` (sessionId from the def's parser),
   content events, `turn_complete` with the vendor-reported cost; `interrupt()` → SIGINT → an
   `interrupted` event; `abort()` kills; unknown-vendor ids never reach the engine (the
   pipeline's gate, WO-0104).
3. The resume path: a `resume` id reaches the def's args builder verbatim (the Sürdür arm).
4. The role→sandbox mapping: verifier/implementer/architect each build their own args through
   the def (pinned per role).
5. CI green: typecheck ×2, tests, build, boundaries; E2E untouched (the fake runner stays the
   E2E transport — no vendor def is wired).

## Evidence required

- The four CI checks on the PR; the engine's test block visible in `npm test` output.
- Manual scenario (the end-of-wave tour): none possible — no def is wired; Faz C's vendor is
  the first live exercise of this engine.

## Stop-and-ask gates

- If the engine needs vendor vocabulary ANYWHERE outside a def file — stop and ask (ADR-0006).
- If a vendor's stream tempts a plain-stdout parser — stop and ask (ADR-0014's rejection).

## Notes

- The engine composes env exactly like the SDK adapter: `{...process.env, ...(runnerOpts.env),
  ...(input.profile?.env)}` — WO-0098's profile mechanism carries over unchanged.
- `checkCliVendor` is the `checkProvider` twin for def vendors (version probe + auth probe,
  zero tokens); Faz C wires it into the settings surface's per-vendor Test et.
