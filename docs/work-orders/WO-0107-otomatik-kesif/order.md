---
id: WO-0107
title: "Agent auto-discovery — PATH plus well-known toolchain dirs, streamed per vendor, behind the <ID>_BIN override"
workspace: docket
status: implementing
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0107 — agent auto-discovery (Faz D)

Issue #108 · Phase D of `docs/research/2026-09-25-multi-cli-provider-architecture.md`.

## Objective

An Electron-launched process's PATH is thinner than a login shell's (no rc-file additions) —
find each known vendor's binary by scanning PATH PLUS well-known toolchain directories (the
open-design lesson: Homebrew both arms, `~/.local/bin`, `~/.bun/bin`, volta, `~/bin`, every
nvm-managed node's bin), with a per-vendor `<ID>_BIN` override as the escape hatch when
detection still misses. Results stream ONE PER VENDOR as each probe finishes — never batched —
the shape the onboarding wizard's "found on this machine" checklist needs. The wizard's VISUALS
stay Figma-gated (2026-10-01, the issue's own note); what lands now is the engine, the shared
try-order (spawn + discovery honor the same override), and the `vendors()` settings read Faz E's
surface and the wizard both consume.

## Frozen decisions

- **The override is shared, not a detection-only trick**: `candidatesOf` (def.ts) puts
  `<ID>_BIN` first for SPAWNS and checks too — a missed install is fixed by one env var, for
  drives and probes alike.
- **PATH order wins before well-known** (the app's own PATH is respected), the well-known set
  dedupes against it; nvm versions probe newest-first.
- **Detection is READ-ONLY knowledge**: it feeds surfaces (the per-vendor row, the wizard); the
  spawn path resolves through child_process's own PATH search + the override — detection never
  writes config, never moves anything.
- **`null` is the honest not-found** (never a guessed install, ADR-0001's absent); a non-unix
  platform carries NO well-known set yet (named — the win32 set rides a later Route V pass,
  TD-064's twin).
- **The full cast is registry + defs**: `vendors()` answers the WIRED entries (from the
  registry) plus every known DEFINITION file not yet wired (status `probe-pending`) — one list,
  each row carrying this machine's detection.

## Scope

In scope:

- `src/adapters/cli-runner/discover.ts` — `pathDirs`, `wellKnownDirs` (injectable listDir, pure
  over its inputs), `detectOne` (override → PATH → well-known, X-bit required),
  `detectVendors` (streamed per vendor, stable input order).
- `def.ts` — `binEnvKey` + `candidatesOf` shared by the engine's spawn path and discovery.
- `VendorInfo` (core/app-settings) + the `vendors()` port method; `docket:vendors:info` IPC;
  `providerBin()` from the SDK adapter (its own binary joins the detection list).
- 10 discovery tests against real temp dirs (X-bit fakes).

Out of scope:

- The onboarding wizard's UI (Figma-gated 2026-10-01 — the issue's own deferral), the
  settings' vendor-grouped surface (Faz E), directory-picker profile flows (the BackendProfile
  mechanism already carries them; the wizard composes it later).

## Acceptance criteria

1. PATH-order priority, well-known fallback, override-first, X-bit enforcement, honest null —
   each pinned by a test against real executables.
2. `detectVendors` streams one result per vendor (unfound vendors stream their null) and the
   resolved array keeps input order.
3. `candidatesOf` carries the override for spawns (the engine's fallback chain unchanged).
4. `vendors()` answers wired + probe-pending rows with per-machine detection; CI green; E2E
   untouched.

## Evidence required

- The four CI checks; the discovery block in `npm test`.
- The wizard's consumption (Figma-gated): a named follow-up under Faz E's order, not here.

## Stop-and-ask gates

- If detection is ever asked to WRITE (a config row, a symlink) — stop and ask: it is knowledge,
  never installation.
- If the win32 well-known set is needed before Route V reaches it — stop and ask (named debt).

## Notes

- `wellKnownDirs` takes `listDir` injected — the nvm tree probe is testable without a real nvm.
- The remote console (ADR-0020) may surface `vendors()` later; nothing here is desktop-bound.
