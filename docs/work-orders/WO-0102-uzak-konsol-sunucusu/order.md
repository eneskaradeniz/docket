---
id: WO-0102
title: "The remote console server — an embedded HTTP+WS endpoint in the one composition root: pairing, the account-wide Konsol read, and write intents that only delegate"
workspace: docket
status: open
mode: plan # the contract is cross-repo load-bearing (docket-mobile wave 1 builds on it) — the plan round freezes the surface before implementation
review: full # auth + secrets + the composition root
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0102 — the remote console server

## Objective

ADR-0020 (accepted 2026-09-24, `7a3b220`) makes the phone a thin client over an embedded
HTTP+WS server: the desktop app stays open at home, the phone renders state and posts intents,
every gate stays core-enforced. The machine already carries the whole load — this WO adds the
wire. Five pieces in a FIXED landing order: the core contract types first (their own commit, so
`docket-mobile` wave 1 can start before the rest lands), then the `contract/endpoints.yaml`
generation, the device store, the HTTP+WS adapter, and the wiring in the one composition root.

## Context (measured 2026-09-24)

- The one composition root is `electron/main.ts` (`scripts/check-boundaries.mjs:28`); the drive
  loop is host-agnostic over ports (`createPipeline`, `src/core/pipeline.ts`, wired at
  `electron/main.ts:699`).
- The live facts main already keeps: the owner-tagged `activeDrives` / `liveRunnerInstances` /
  `driveOwners` maps (`electron/main.ts:715-720`; `RunningOwner` in `src/core/tray-menu.ts:23`)
  and the pending-asks aggregate (`electron/main.ts:889`). The Konsol read derives from THESE —
  a second source of running-drive truth is the defect ADR-0020 #1 exists to prevent.
- Every write path already exists as a call: ask answer (`pipeline.decide` with
  `PermissionDecision` — binary, or structured `updatedInput.answers` per WO-0077; the
  timeline twin `recordPermissionDecision`, `src/core/source.ts:272`), stop (`interrupt`),
  resume (a `resume` DriveInput through the spawn path at `electron/main.ts:728` — the
  cwd/model/profile fills apply to every host alike), budget raise-and-rerun
  (`AppSettings.setBudget`, `src/core/app-settings.ts:86`), draft approve/reject
  (`approveRoadmapDraft`/`discardRoadmapDraft`, `src/core/source.ts:224/219`), locale
  (`getLocale`/`setLocale`, `src/core/app-settings.ts:54-55`).
- Theme is renderer-local localStorage today (WO-0040; main cannot read it — TD-045 residue).
  This WO gives theme a server-readable home (Frozen decisions).
- App home db: `~/.docket/docket.db` (WO-0075) — the device tables join the same store.

## Frozen decisions (this order; the plan round may refine, never silently drop one)

- **The server NEVER re-derives a verdict.** Every write-intent endpoint is a thin delegate to
  an existing call (list above); plan-approval, budget and profile gates stay enforced in
  `src/core/` exactly as for the GUI host. An endpoint that computes a gate itself is a defect.
- **Pairing is ONE 6-digit code, two renderings** (ADR-0020 #3's QR direction stands: desktop
  shows, phone scans). The QR payload embeds endpoint + the code; the manual fallback types
  host:port + the same code. TTL 5 minutes, single-use, 5 failed exchanges kill the token.
  Entropy tradeoff accepted for the LAN threat model — revisit only by addendum.
- **On by default at boot, with a kill-switch**: `app_setting` key `remote:enabled` (default
  on). Rationale: ADR-0020 #2's "the desktop app is open" IS the deployment assumption, and a
  server with no outstanding pairing token refuses everything anyway; the macOS Local Network
  prompt on first listen is an accepted setup fact (ADR Consequences). The switch gets its UI
  with WO-0103's follow-up, not here.
- **Fixed default port** (`app_setting` `remote:port` override; ephemeral fallback on conflict,
  the QR then carries the actual port). A fixed port is what keeps a paired phone's saved
  endpoint alive across reboots.
- **v1 trusts the LAN — no TLS.** The bearer key crosses in cleartext on the LAN; the
  Tailscale path (ADR-0020 #4) is the encrypted transport when it comes. Named risk, not an
  oversight.
- **Keys are secrets in the Records & PRs sense extended by ADR-0020 #3**: the device key's
  plaintext exists only in the /pair response and on the phone; the store keeps a SHA-256 hash;
  no key, token or hash ever enters an event, a log line, or `wo_event.detail`.
- **WS auth is a one-time ticket** (minted by an authenticated REST call, 30 s TTL, single
  use, carried as a query param): browser WebSocket cannot set Authorization headers.
- **Theme joins locale in `app_setting`** (`AppSettings.getTheme/setTheme`,
  `'system' | 'light' | 'dark'`) so the remote settings surface can read+write it. The desktop
  renderer KEEPS its localStorage behavior this WO — desktop adoption is a named tech-debt
  entry, never smuggled work. "Sistem" follows each device's own OS at render time regardless
  of where the row lives.

## Scope — in landing order

### Step 1 — core contract types (FIRST deliverable, its own commit)

`src/core/remote.ts`, test-first, deriving FROM existing core types (ADR-0020 #11 — the
contract's source is the code):

- Pairing: the pairing-grant shape (code, expiresAt, attempt budget), the exchange
  request/response, the device row view (`id`, operator-given `name`, `createdAt`,
  `lastSeenAt`).
- Device registry: list/revoke shapes.
- `RemoteConsoleView` — the account-wide Konsol view-model: every workspace's running drives
  (owner tag, WO title/workspace label, role, status) + pending asks (BOTH shapes: the binary
  `PermissionAsk` and the structured AskUserQuestion view `src/core/askq.ts` already parses) +
  the composite health rows ADR-0020 #6 names (per-profile quota windows — the
  `AppbarDriveChip` `limitWarn` facts — and per-capped-workspace month spend). A pure
  `deriveRemoteConsole(...)` assembles it from the facts main already holds; the server never
  invents a field the core types lack.
- Write intents (v1 scope, ADR-0020 #9): ask answer (both shapes), drive stop, drive resume,
  budget raise-and-rerun, draft approve/reject, settings write (locale + theme). Steer notes
  are NOT in v1 (ADR-0020 #9 defers nothing about them — they were never in scope).
- A `version` stamp on the whole contract — `docket-mobile` pins it.

### Step 2 — `contract/endpoints.yaml` generation

- `src/core/remote-contract.ts`: `emitEndpointsYaml(): string` — PURE, emit-only (a
  hand-rolled deterministic serializer; NO yaml parser dependency ever), stable key order, the
  endpoints, the auth scheme, the error taxonomy (401 unknown bearer, 410 dead/expired token),
  the WS event taxonomy and the tail-window contract.
- `scripts/emit-contract.mjs` + `npm run contract` write `contract/endpoints.yaml` at the repo
  root (checked in; tsx stays a devDep per WO-0073's own note).
- Drift guard: a vitest test regenerates in-memory and asserts byte-equality with the
  checked-in file. Hand-editing the yaml goes red — demonstrated in the PR.

### Step 3 — device store

- `src/core/device-store.ts`: the `DeviceStore` port (createPairingGrant, exchange — the
  single-use/TTL/attempt-cap state machine as PURE rules over an injected clock, adapter
  randomness), listDevices, revokeDevice, findByKeyHash. Core sees key HASHES only.
- The same `Store` adapter implements it (the `WorkOrderSource` + `SessionStore` precedent):
  `device` + `pairing_token` tables in `src/adapters/store/schema.ts`, PRAGMA-guarded additive
  migration, `~/.docket/docket.db`.

### Step 4 — the HTTP+WS adapter (new)

`src/adapters/remote/` (server + tests). `ws` is the one new runtime dependency and lives only
here. Transport-agnostic — zero Tailscale-specific code, zero QR code (the server supplies
endpoint + token; the screen renders).

- `POST /pair` (code + deviceName → device key; one-time; 5-strike; 410 shapes) — the ONLY
  unauthenticated route.
- Bearer-device-key auth on everything else; unknown bearers refused 401; `lastSeenAt` stamped.
- Reads: the Konsol view-model, settings (locale, theme, per-workspace cap), devices.
- Write intents mapped to the existing calls (Frozen decisions list). The ask answer also
  writes `recordPermissionDecision` — the timeline stays honest no matter which surface
  answered.
- WS: `POST /ws-ticket`, then the upgrade with the ticket; on (re)connect the server sends the
  TAIL WINDOW (the last N events per owner — the constant named in core; ADR-0020 #8's
  "never full history"), then the live stream — the SAME RunnerEvent stream main forwards over
  `docket:runner:event` today, re-wrapped with the owner tag. Reconnect is a designed state on
  the phone, not an error here.

### Step 5 — wiring (electron/main.ts ONLY)

- The server starts at boot when `remote:enabled` (default on), fixed port + fallback; one log
  line naming host:port.
- The resume / raise-and-rerun intents re-enter the SAME spawn path the IPC handler uses:
  extract the drive-start fill logic (`electron/main.ts:728-764`) into a function both callers
  share — a refactor inside main.ts, no second root, no behavior change to the GUI path.
- Main retains the LAST-REFUSED drive input per owner (the `lastResolvedDriveInput` posture,
  `electron/main.ts:724-726`) so raise-and-rerun can re-spawn from either surface.
- IPC channels for WO-0103's screen: mint pairing grant, list devices, revoke device.

## Test-first plan (core; adapters per CLAUDE.md)

- `src/core/__tests__/remote.test.ts` — `deriveRemoteConsole` over builder fixtures: the
  multi-workspace drive/ask fan-out, both ask shapes, health-row presence derivation, the
  absent-case honesty rules.
- `src/core/__tests__/remote-contract.test.ts` — byte-stability + the drift guard (red on a
  hand-edited yaml).
- `src/core/__tests__/device-store.test.ts` — the grant state machine over a `FakeDeviceStore`
  + injected clock: single-use, TTL expiry, 5-strike kill, revoke-then-refuse.
- `src/adapters/remote/server.test.ts` — the real server on `127.0.0.1:0` against the core
  fakes: pair→read→write happy path, every refusal shape (unknown bearer, dead token,
  expired token, struck-out token), the WS tail window + live event, ticket single-use.

## Acceptance

1. The contract is commit 1 (core types + emitter + checked-in yaml + drift test); `npm run
   contract` is idempotent; the drift test fails on a hand edit.
2. A pairing grant exchanges exactly once; expired/struck grants refuse with the named error;
   unknown bearers get 401 on every route including the WS upgrade.
3. The Konsol read returns every workspace's running drives + pending asks + health rows,
   derived from the maps at `electron/main.ts:715-720`/`:889` — provable by the adapter test
   seeding exactly those facts.
4. Each write intent reaches the EXISTING call (asserted on the fakes): decide (both shapes +
   the timeline twin), interrupt, the shared spawn path (the fills apply), setBudget +
   re-spawn of the retained refused input, approveRoadmapDraft/discardRoadmapDraft, locale +
   theme writes. No endpoint computes a gate.
5. The WS stream carries the tail window then live events, keyed by owner tag; no key, token
   or hash appears in any event payload (pinned by test).
6. The ladder is green and the E2E baseline is untouched (no new spec — see Out).

## Mechanical verification (the CI set)

`npm run typecheck` (both configs) · `npm test` · `npm run build` · `npm run check:boundaries`
(10/10 — the new adapter sits under `src/adapters/`, which c3/c4 already exempt; core stays
pure) · `npm run contract` byte-stable.

## Closure requirements

- ROADMAP.md M10 entry accurate; every knowingly-taken debt recorded in `docs/tech-debt.md`
  before close: (a) desktop theme adoption of the app_setting row, (b) the deferred E2E spec
  (the WO-0101 lock governs when it comes), (c) win/linux listen verification if unverified,
  (d) the wave-1 read-surface extension if not pulled into this WO (see Out).
- Closure sha; the PR body carries the "Model Used" line at the top (Records & PRs rule).

## Manual scenario (DEFERRED — build-first; the operator runs it in the final tour phase)

1. `npm run dev` → the log line names the listening host:port; the macOS Local Network prompt
   appears once and is accepted.
2. `npm run contract` → git status shows no diff.
3. `curl -H "Authorization: Bearer bogus" http://127.0.0.1:<port>/<any read>` → 401.
4. The live pairing tour (mint → scan/typed code → Konsol on a device) rides WO-0103's
   scenario — it needs the screen; the mechanical path is covered by the adapter tests.

## Out (non-goals)

- The desktop Cihazlar → Eşleştir screen (WO-0103) and any UI for the kill-switch.
- Any mobile code, push, FCM (ADR-0020 #8), QR RENDERING (server supplies endpoint+token),
  Tailscale-specific anything, mDNS/zeroconf discovery, TLS.
- Steer notes over remote (not in ADR-0020 #9's v1 write scope).
- NO new E2E spec: the WO-0101 one-suite-per-host lock governs any future spec that drives
  the server; recommended home is a dedicated WO after docket-mobile wave 1 proves the
  contract live — not this one.
- The wave-1 read surfaces BEYOND Konsol (WO list/detail, roadmap/TASLAK reads): NOT in this
  draft. The emitter is additive; either the plan round pulls them in or a fast-follow WO
  lands them before docket-mobile wave 1's read screens — the plan round names which.

## DUR conditions

- Stop and ask if pairing needs any operator-visible surface beyond the IPC channels (a debug
  mint path is a second composition root — banned, WO-0073).
- Stop and ask if the contract emitter seems to need a YAML PARSER (emit-only stands), or if
  `ws` cannot be packed by electron-builder.
- Stop and ask if any write intent cannot be expressed as a delegate to an existing call.
