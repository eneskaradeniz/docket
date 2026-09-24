# WO-0102 — plan (the remote console server)

Plan round, 2026-09-24. Static reading only: nothing was built, installed, launched or run. Line
numbers are against `origin/main` @ `626e938` (the branch point). Every order.md anchor was
re-measured this round and held — see §12. **UNVERIFIED** marks a claim not checked in this round.
The orchestrator rulings of 2026-09-24 (fixed port 47654, one code two renderings, on-by-default,
theme joins locale, wave-1 reads stay out → WO-0104, no E2E, `ws` adapters-only) are baked in as
frozen; this plan does not re-open them.

## 1. Summary

- **Commit 1 is the contract** (`src/core/remote.ts` + `remote-contract.ts` + the emitter script +
  the checked-in `contract/endpoints.yaml` + the drift tests), so `docket-mobile` wave 1 can start
  before the rest lands. The endpoint table, the yaml section order, the view-model fields, the
  port signatures and every constant are FROZEN in §2-§7 — the implementation round refines
  nothing about them without a new plan note.
- Every write intent is a thin delegate to an existing call (§2.7); the server computes no gate.
  Pairing is one 6-digit code, two renderings, 5-min TTL, single-use, 5-strike. REST auth is a
  bearer device key (stored SHA-256-hashed); WS auth is a 30 s single-use ticket query param.
- The device store is a core port (`DeviceStore`) with the single-use/TTL/strike machine as PURE
  rules over an injected clock; the same SQLite `Store` implements it (`device` + `pairing_token`
  tables, additive — `CREATE TABLE IF NOT EXISTS` runs at every open, `store/index.ts:2222`).
- `electron/main.ts` gains the boot wiring (on-by-default + `remote:enabled` kill-switch, port
  47654 + ephemeral fallback), one shared spawn-path function extracted from the drive handler
  (`main.ts:728-764`), the per-owner retained inputs the remote intents re-spawn, and three IPC
  channels for WO-0103's screen. No second root; the server adapter is imported by the one
  composition root only (`check-boundaries.mjs:28`).
- The server is OFF under `DOCKET_E2E` (§7.5) and no E2E spec is added (WO-0101's lock governs the
  later dedicated one).

## 2. The frozen contract surface

### 2.1 Constants (`src/core/remote.ts`)

| Constant | Value | Ruling |
|---|---|---|
| `REMOTE_API_VERSION` | `1` | the version stamp every payload carries; docket-mobile pins it |
| `REMOTE_DEFAULT_PORT` | `47654` | fixed default (orchestrator 2026-09-24); `remote:port` overrides |
| `PAIRING_CODE_DIGITS` | `6` | one code, two renderings (QR embeds it + manual typing) |
| `PAIRING_TTL_MS` | `300_000` | 5 minutes |
| `PAIRING_MAX_ATTEMPTS` | `5` | 5 failed exchanges kill the token |
| `WS_TICKET_TTL_MS` | `30_000` | 30 s, single-use, query param (browsers cannot set headers) |
| `REMOTE_TAIL_WINDOW` | `200` | last N events per owner replayed on WS (re)connect |
| `REMOTE_DENY_REASON` | `'Denied by operator'` | byte-parity with the GUI's deny (`WorkOrderDetail.tsx:453`) |

Wire formats: all REST bodies are UTF-8 JSON (`application/json`). The consumer is a native app —
**no CORS headers, no OPTIONS handling** (a browser client is out of scope, named). Request bodies
are capped at 64 KiB (defensive; over-cap → `400 malformed`).

### 2.2 Endpoint table

`{base}` = `http://<host>:<port>` — host/port arrive by QR or manual entry; the server never
assumes them. Path params: `owner` is the owner tag verbatim (`wo:<id>` / `ws:<id>` — `:` is a
legal path char, RFC 3986 pchar; the phone URL-encodes, the server matches decoded-verbatim
against `driveOwnerTag` output). Error body, every non-2xx: `{ "error": "<code>", "message":
"<one-line English diagnostic>" }` (+ the extra fields noted).

| # | Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|---|
| 1 | POST | `/pair` | none (the ONLY unauthenticated route) | `{ "code": "123456", "deviceName": "Pixel 9" }` — name 1-64 chars after trim | `200 { "deviceId": "dv_…", "deviceKey": "dk_…" }` — the key plaintext exists HERE ONLY | `400 malformed` · `401 invalid_code` (+`attemptsLeft`) · `410 token_dead` (+`reason: expired\|used\|struck\|unknown`) |
| 2 | GET | `/console` | bearer | — | `200 RemoteConsoleView` (§2.3) | `401 unknown_bearer` |
| 3 | GET | `/settings` | bearer | — | `200 { "locale": "tr"\|"en"\|null, "theme": "system"\|"light"\|"dark", "workspaces": [ { "id", "label", "cap": { "capUsd", "warnPercent" }? } ] }` | `401` |
| 4 | PUT | `/settings` | bearer | `{ "locale"?, "theme"? }` (at least one key) | `200` the post-write `{ locale, theme }` | `400 invalid_value` · `401` |
| 5 | GET | `/devices` | bearer | — | `200 { "devices": DeviceView[] }` | `401` |
| 6 | DELETE | `/devices/{id}` | bearer | — | `200 { "revoked": "<id>" }` | `401` · `404 unknown_device` |
| 7 | POST | `/asks/{requestId}/answer` | bearer | `RemoteAskAnswer` (§2.7) | `200 { "resolved": "<requestId>" }` | `400 malformed` · `401` · `404 unknown_ask` (no live runner holds it) |
| 8 | POST | `/drives/{owner}/stop` | bearer | — | `200 { "stopped": "<owner>" }` | `401` · `404 unknown_owner` (nothing live under the tag) |
| 9 | POST | `/drives/{owner}/resume` | bearer | — | `200 { "spawned": "<owner>" }` | `401` · `404 no_retained_drive` · `409 drive_running` |
| 10 | POST | `/budget/raise-and-rerun` | bearer | `{ "workspaceId": "…", "capUsd": 25 }` (`capUsd > 0`) | `200 { "raised": true, "rerun": boolean }` — rerun false when no refused input is retained (raise is still a legal settings write, never fabricated into a re-run) | `400 invalid_value` · `401` · `404 unknown_workspace` |
| 11 | POST | `/drafts/{workspaceId}/approve` | bearer | — | `200 { "approved": "<wsId>" }` | `401` · `404 no_draft` · `409 draft_unparsable` (the parse-guard throw) |
| 12 | POST | `/drafts/{workspaceId}/reject` | bearer | — | `200 { "discarded": "<wsId>" }` | `401` · `404 no_draft` |
| 13 | POST | `/ws-ticket` | bearer | — | `200 { "ticket": "wt_…", "expiresAt": "<ISO>" }` | `401` |
| 14 | WS | `/ws?ticket=<ticket>` | ticket (§2.6) | client frames: NONE (any frame is ignored) | the §2.6 stream | upgrade refused `401 ticket_invalid` |

Auth: `Authorization: Bearer <deviceKey>`; the server hashes the bearer (SHA-256, adapter-side
`node:crypto`) and resolves `deviceByKeyHash` — a hit stamps `lastSeenAt`; a miss is `401
unknown_bearer` on every route including the WS upgrade path. Idempotent verbs: DELETE on an
already-revoked id is `404` (the row is gone — honest, not cached-client forgiveness).

### 2.3 `RemoteConsoleView` (`deriveRemoteConsole`, PURE)

The account-wide Konsol read (ADR-0020 #5) — every field derived from facts main already holds or
reads; the server invents nothing:

```ts
export interface RemoteDriveCard {
  owner: string;                    // driveOwnerTag output — 'wo:<id>' | 'ws:<id>'
  kind: 'wo' | 'draft';
  workspaceId: WorkspaceId;         // the drive's workspace (WO join / the draft's own)
  woId?: WorkOrderId;               // kind 'wo'; the phone never parses `owner`
  title?: string;                   // kind 'wo'; undefined while main's lookup is in flight
  role: SessionRole;                // 'implementer' | 'architect' | 'verifier'
  status: 'running' | 'asking';     // asking ⇔ the drive holds ≥1 pending ask
}
export interface RemoteAskCard {
  owner: string;                    // the asking drive's owner tag
  requestId: string;
  tool: string;
  input: Record<string, unknown>;
  title?: string; reason?: string;  // the PermissionAsk optionals, verbatim
  questions?: AskQuestion[];        // core askq.parseAskRequest(tool, input); undefined → the binary form
}
export type RemoteHealthRow =
  | { kind: 'quota'; profile: string; windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' }
  | { kind: 'spend'; workspaceId: WorkspaceId; view: WorkspaceBudgetView };  // core budget.workspaceBudgetView
export interface RemoteConsoleView {
  version: 1;                       // REMOTE_API_VERSION
  drives: RemoteDriveCard[];        // wo cards by woId ascending, then drafts by workspaceId
  asks: RemoteAskCard[];            // by owner then requestId
  health: RemoteHealthRow[];        // quota rows by profile name asc, spend rows by workspaceId
  workspaces: { id: WorkspaceId; label: string }[];  // the label join (the phone's dim-mono card line)
  quiet: boolean;                   // drives and asks both empty — the phone's empty-console state
}
export interface RemoteConsoleFacts {   // what main feeds the pure derivation
  now: string;                       // ISO, caller-supplied (tests control it)
  drives: Array<{ owner: string; kind: 'wo' | 'draft'; workspaceId: WorkspaceId;
                  woId?: WorkOrderId; title?: string; role: SessionRole; asks: PermissionAsk[] }>;
  quota: Array<{ profile: string; windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' }>;
  budgets: Array<{ workspaceId: WorkspaceId; threshold: BudgetThreshold; monthUsd: number; hasUnknown: boolean }>;
  workspaces: ReadonlyArray<{ id: WorkspaceId; label: string }>;
}
export function deriveRemoteConsole(facts: RemoteConsoleFacts): RemoteConsoleView;
```

Derivation rules (each pinned by a §9 test): `status = asks.length > 0 ? 'asking' : 'running'`;
each ask's `questions` is `parseAskRequest(ask.tool, ask.input)` (the same call the GUI card makes,
`StopAndAskCard.tsx:59`); a spend row appears only for a workspace with a configured cap (the
`WorkspaceBudgetView` composition the GUI already renders, `App.tsx:529-531`); a quota row appears
only for a profile that reported windows (presence-derived, ADR-0020 #6 — no invented rows, no
`para|abonelik` mode flag anywhere); `workspaces` lists what main read (labels verbatim operator
data); the input is never mutated.

### 2.4 Pairing (ADR-0020 #3 — desktop shows, phone scans)

```ts
export interface PairingGrantView { code: string; expiresAt: string; attemptsLeft: number; }
export interface PairEndpoint { host: string; port: number; }   // port = the ACTUAL bound port
export interface PairingStartView extends PairingGrantView { endpoint: PairEndpoint; qr: string; }
export type PairingExchangeResult =
  | { kind: 'paired'; deviceId: string; deviceKey: string }     // key plaintext, this response only
  | { kind: 'invalid_code'; attemptsLeft: number }              // → 401
  | { kind: 'token_dead'; reason: 'expired' | 'used' | 'struck' | 'unknown' };  // → 410
// the PURE verdict the adapter applies (test-first):
export interface StoredGrant { code: string; expiresAt: string; attemptsLeft: number; used: boolean; }
export function pairingVerdict(grant: StoredGrant | undefined, code: string, now: string):
  { kind: 'ok' } | { kind: 'wrong_code'; attemptsLeft: number } | { kind: 'dead'; reason: 'expired' | 'used' | 'struck' | 'unknown' };
```

- **QR grammar (frozen, both directions in core):** `docket-pair://<host>:<port>?v=1&code=<6 digits>`
  via `serializePairingQr(payload): string` and a STRICT `parsePairingQr(text): { version: 1;
  endpoint: PairEndpoint; code: string } | undefined` (the `askq.ts` posture: any malformed shape
  is `undefined`, never a throw). The manual fallback types host:port + the same code.
- Exactly ONE live grant: minting deletes every prior `pairing_token` row (supersede).
- Minting is main-side only (IPC, §7.4) — no debug mint path, no second root (DUR condition).
- Ids/keys (adapter randomness, formats frozen for the phone's storage): device id `dv_` + 16 hex;
  device key `dk_` + 64 hex (32 random bytes); ws ticket `wt_` + 32 hex. The store keeps only
  `sha256(deviceKey)` hex (64 chars) — the plaintext exists in the /pair response and on the phone
  (Records & PRs extended by ADR-0020 #3: no key, token or hash ever enters an event, log line, or
  `wo_event.detail`; pinned by §9 test).

### 2.5 The `DeviceStore` port (`src/core/device-store.ts`)

```ts
export interface DeviceStore {
  /** Mint the one live grant (adapter randomness for the code; core TTL/attempt constants). */
  mintGrant(now: string): Promise<PairingGrantView>;
  /** The single-use / TTL / attempt-cap exchange. Applies core's pairingVerdict; on 'paired'
   *  inserts the device row (hashed key) and marks the grant used. */
  exchange(code: string, deviceName: string, now: string): Promise<PairingExchangeResult>;
  listDevices(): Promise<DeviceView[]>;                 // createdAt asc
  revokeDevice(id: string): Promise<boolean>;           // false = unknown id
  /** Auth lookup by key hash; a hit stamps lastSeenAt (= now). */
  deviceByKeyHash(keyHash: string, now: string): Promise<DeviceView | undefined>;
}
export interface DeviceView { id: string; name: string; createdAt: string; lastSeenAt: string | null; }
```

The pure state machine is `pairingVerdict` (§2.4) — `mintGrant`/`exchange`/`revoke`/lookup are
adapter persistence around it. Core sees key HASHES only; SHA-256 and the random minting live in
adapters (`node:crypto`; c3 never scans `src/adapters/`).

**Schema additions** (`src/adapters/store/schema.ts`, appended to `SCHEMA_SQL` — additive; the
PRAGMA-guarded `migrate()` pattern at `store/index.ts:852+` is for column adds on EXISTING tables,
which these are not):

```sql
CREATE TABLE IF NOT EXISTS device (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS pairing_token (
  code TEXT PRIMARY KEY,
  attempts_left INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Both are OWNED rows (the `Store extends … DeviceStore` clause joins `WorkOrderSource`,
`SessionStore`, `AppSettingsData` at `store/index.ts:73`); neither enters `OBSERVED_TABLES`. The
WS ticket store is adapter-internal memory (30 s single-use — nothing durable).

### 2.6 WebSocket stream

- Handshake: `POST /ws-ticket` (bearer) → `{ ticket, expiresAt }` → connect
  `ws://<host>:<port>/ws?ticket=<ticket>`. The ticket is single-use and TTL-bounded; a bad ticket
  refuses the upgrade with HTTP 401 `ticket_invalid`. Reconnect is the phone's designed state, not
  an error here (ADR-0020 Consequences).
- Envelope (server→client only; `type` discriminates):

```ts
export type RemoteWsMessage =
  | { type: 'hello'; version: 1; tailWindow: 200 }        // first frame, once
  | { type: 'tail'; owner: string; events: RunnerEvent[] } // one per owner with buffered history, right after hello
  | { type: 'event'; owner: string; event: RunnerEvent };  // live, in stream order
```

  `RunnerEvent` is the core union verbatim (`src/core/runner.ts:19`) — the SAME stream main
  forwards over `docket:runner:event` today (`main.ts:823-825`), re-wrapped with the owner tag.
- Tail window: the last `REMOTE_TAIL_WINDOW` (200) events per owner, replayed on every
  (re)connect — never full history (ADR-0020 #8). Main keeps a per-owner ring
  (`Map<string, RunnerEvent[]>`, push+shift at 200) fed inside the existing forward loop; the
  ring resets when a new drive starts under the tag and outlives the drive's end (a reconnecting
  phone still sees the just-ended drive's last events).
- Liveness: protocol-level ping every 30 s; a failed ping closes the socket. No app-level ping
  message. Client frames are ignored (read-only stream in v1).

### 2.7 Write intents — the thin-delegate map (frozen decision: no endpoint computes a gate)

| Intent | Existing call it delegates to | Notes |
|---|---|---|
| ask answer (binary) | `pipeline.decide(requestId, { allow } \| { allow: false, reason: REMOTE_DENY_REASON })` (`main.ts:841-843`) | + the timeline twin `store.recordPermissionDecision(woId, { allowed, tool, target: summarizeToolInput(input) })` — mirroring `WorkOrderDetail.tsx:452-455`; a DRAFT owner writes no wo_event (the `recordAuditEvent` D15 posture — a draft has no timeline home) |
| ask answer (structured) | `askDecisionAll`-shaped fold via `remoteAskDecision` (below) → `pipeline.decide` | + one `recordPermissionDecision` per answered question, target `"<header>: <labels/text>"` (mirroring `WorkOrderDetail.tsx:462-475`); the same declined-arm deny-whole / all-skipped bare-allow rules |
| drive stop | `pipeline.interrupt(owner)` (`main.ts:845-847`) | 404 when nothing is live under the tag |
| drive resume | the shared spawn-path fn (§7.2) over main's retained per-owner input + `resume: <providerSessionId>` | the fills (cwd, permissionRule, decisionStoreRoot, model) re-apply — "the fills apply to every host alike" |
| budget raise-and-rerun | `settings.setBudget(wsId, { capUsd, warnPercent: prior ?? DEFAULT_WARN_PERCENT })` (the `App.tsx:613-619` write) + re-spawn of main's retained REFUSED input | refusal retention: `error` events carrying `refusal` (`runner.ts:124`) retain the owner's input; cleared by the next start under the tag |
| draft approve | `store.approveRoadmapDraft(wsId)` (`source.ts:224`) | the parse-guard throw maps to 409 `draft_unparsable` |
| draft reject | `store.discardRoadmapDraft(wsId)` (`source.ts:219`) | |
| settings write | `settings.setLocale` / `settings.setTheme` (`app-settings.ts:54-55` + the new theme pair) | |

```ts
export type RemoteAskAnswer =
  | { kind: 'binary'; allow: boolean }
  | { kind: 'structured'; answered: Array<{ question: string; answer: AskAnswer }> };
```

`remoteAskDecision(input, answered)` (pure, core) reuses `askDecisionAll` (`askq.ts:135`) by
wrapping each `{question: string}` into the minimal question object — `askDecisionAll` reads only
`question.question`, so the measured fold applies verbatim; parity is pinned by a §9 test against
`askDecisionAll` on the same input. requestId→WO attribution comes from main's per-owner pending
ask registry (§7.3) — never from the phone.

**Server-nevers (test-pinned):** no endpoint reads `planApprovedFor`/`budgetBlockFor`/
`backendProfileFor`; gates fire inside the pipeline exactly as for the GUI host — a refused remote
drive surfaces as an `error` event on the WS stream, the same event the GUI folds.

### 2.8 Settings surface additions (core port + adapter)

`AppSettings` (`src/core/app-settings.ts:43`) gains — test-first, adapter over `app_setting`
rows (the `locale` pattern, `store/index.ts:1457/2720`):

```ts
export type Theme = 'system' | 'light' | 'dark';
getTheme(): Promise<Theme | undefined>;      // undefined = nothing stored; GET /settings renders 'system'
setTheme(theme: Theme): Promise<void>;
getRemoteEnabled(): Promise<boolean>;        // remote:enabled — default TRUE (frozen decision)
setRemoteEnabled(enabled: boolean): Promise<void>;
getRemotePort(): Promise<number | undefined>; // remote:port — undefined = REMOTE_DEFAULT_PORT
```

The desktop renderer KEEPS its localStorage theme this WO (WO-0040 posture; TD-065 carries desktop
adoption — a named debt entry, never smuggled work). "Sistem" follows each device's own OS at
render time regardless of where the row lives (frozen decision). The kill-switch UI is WO-0103's;
the read/write surface ships here because WO-0103's order binds itself to "NO new core surface"
(§12 finding 2).

## 3. `contract/endpoints.yaml` — emitter + drift guard

- `src/core/remote-contract.ts`: `emitEndpointsYaml(): string` — PURE, emit-only, a hand-rolled
  deterministic serializer (NO yaml parser dependency ever — DUR condition holds: emitting needs
  none). Every value is emitted FROM the §2 constants and types; the file is a projection of the
  code (ADR-0020 #11).
- `scripts/emit-contract.mjs` (tsx, the existing devDep `package.json:59`) + `"contract": "tsx
  scripts/emit-contract.mjs"` write `contract/endpoints.yaml` at the repo root, checked in.
  Idempotent by construction. Header line: `# generated by npm run contract — do not edit by hand
  (WO-0102 drift test pins the bytes)`.
- **Exact section order (frozen):** `version` → `server` (defaultPort, auth, transport, tls:false)
  → `pairing` (codeDigits, ttlSeconds, maxAttempts, qrGrammar, the exchange error taxonomy) →
  `errors` (the REST taxonomy: code → status list) → `endpoints` (one block per route, IN THE §2.2
  TABLE ORDER 1-13: method, path, auth, request, success, errors) → `websocket` (path, ticket
  auth + ttlSeconds, envelope kinds, tailWindow, pingSeconds, clientFrames: none) → `models`
  (field lists: RemoteConsoleView and friends, DeviceView, RemoteAskAnswer, the settings shapes;
  optional fields marked `?`).
- Serializer mechanics (frozen for byte-stability): 2-space indent; keys in the fixed order above;
  double-quoted strings; bare numbers/booleans; lists as `- ` blocks; no anchors/aliases/comments
  beyond the header; exactly one trailing newline; LF endings.

## 4. Landing order (commits; each leaves the ladder green)

0. **This round:** plan.md only.
1. **The contract commit** (FIRST deliverable — docket-mobile wave 1 unblocks here): `src/core/remote.ts` · `src/core/remote-contract.ts` · `src/core/__tests__/remote.test.ts` · `src/core/__tests__/remote-contract.test.ts` · `src/adapters/remote/contract-drift.test.ts` · `scripts/emit-contract.mjs` · `contract/endpoints.yaml` · the `contract` script in `package.json`.
2. **Device store:** `src/core/device-store.ts` (+ §2.8 AppSettings additions) · their tests · `src/adapters/store/schema.ts` tables · the `Store implements DeviceStore` block (+ an adapter-side store test) · `src/adapters/store/store.test.ts` additions.
3. **HTTP+WS adapter:** `src/adapters/remote/server.ts` + `src/adapters/remote/server.test.ts` · `ws` runtime dep + `@types/ws` devDep (§12 finding 6).
4. **Wiring:** `electron/main.ts` (boot, shared spawn fn, retained inputs, rings, intents, IPC) · `electron/preload.ts` + `src/renderer/preload.d.ts` (the `remote` group + the four settings methods) · docs (tech-debt TD-065/066 notes at closure; ROADMAP check at closure).

## 5. The adapter (`src/adapters/remote/server.ts`)

`createRemoteServer(deps: RemoteServerDeps)` — deps ALL defined in `src/core/remote.ts` (the
adapter is dumb transport; main is the fact-holder):

```ts
export interface RemoteServerDeps {
  now(): string;                                  // ISO clock, injected
  devices: DeviceStore;
  consoleView(): Promise<RemoteConsoleView>;
  readSettings(): Promise<RemoteSettingsRead>;    // §2.2 #3 shape
  writeSettings(patch: { locale?: Locale; theme?: Theme }): Promise<RemoteSettingsRead>;
  intents: {
    answerAsk(requestId: string, answer: RemoteAskAnswer): Promise<'resolved' | 'unknown'>;
    stopDrive(owner: string): Promise<boolean>;
    resumeDrive(owner: string): Promise<'spawned' | 'no_retained' | 'running'>;
    raiseBudget(workspaceId: WorkspaceId, capUsd: number): Promise<{ raised: boolean; rerun: boolean } | 'unknown_workspace'>;
    approveDraft(workspaceId: WorkspaceId): Promise<'approved' | 'no_draft' | 'unparsable'>;
    rejectDraft(workspaceId: WorkspaceId): Promise<'discarded' | 'no_draft'>;
  };
  stream: { tail(): Array<{ owner: string; events: RunnerEvent[] }>; tap(fn: (owner: string, ev: RunnerEvent) => void): () => void };
  ids: { code(): string; deviceKey(): string; deviceId(): string; ticket(): string; keyHash(key: string): string };
  log(line: string): void;
}
// returns { listen(port: number, host: string): Promise<{ port: number; close(): Promise<void> }> }
```

`node:http` + `ws` only; zero Tailscale/QR/discovery code (frozen non-goals). The §2.2 table is
the whole routing surface; unknown paths → `404 unknown_route`, unknown methods → `405`.

## 6. The device store adapter half

The SQLite block implements `DeviceStore` beside the existing ports: `mintGrant` deletes prior
rows then inserts (`code`/`attemptsLeft`/`expiresAt` from core constants + adapter random code);
`exchange` loads the row, applies `pairingVerdict`, and on `wrong_code` decrements +
re-checks (0 → the row is deleted, `dead/struck`), on `ok` inserts the device (hashed key),
marks `used`, deletes the grant, and returns the plaintext once; `deviceByKeyHash` selects by the
UNIQUE hash and stamps `lastSeenAt`. A crashed-stale grant row is inert (expired reads as dead).
A small adapter test block (temp db, the `db-path.test.ts` posture) pins mint→exchange→list→
revoke→refuse.

## 7. Wiring (`electron/main.ts` ONLY — no second root)

### 7.1 Boot

In `whenReady` (`main.ts:920`), after `createWindow()`: when `!process.env.DOCKET_E2E &&
await settings.getRemoteEnabled()` — listen `0.0.0.0`, port `await settings.getRemotePort() ??
REMOTE_DEFAULT_PORT`; on `EADDRINUSE` retry once with port `0` (ephemeral fallback — the QR then
carries the actual port, frozen decision). One log line: `[remote] listening on <host>:<port>`
(host = the QR host resolution below). A listen failure logs `[remote] unavailable: <message>`
and the app runs on (WO-0103's Eşleştir renders absent+reason off `pairMint() → null`).

### 7.2 The shared spawn-path function

Extract `main.ts:737-764` (permissionRule resolution, `decisionStoreRoot`, model fill, cwd fill —
the block the order's anchor names) into `resolveDriveInput(input: DriveInput): Promise<DriveInput>`;
the IPC handler and the remote resume/raise-rerun both call it. Then factor the handler's
post-fill body (the one-drive guard at `769-775`, worktree prep at `784-796`, spawn + owner-map
maintenance at `797-821`, the forward loop at `822-838`) into `startDrive(driveInput: DriveInput,
sink?: (tag: string, ev: RunnerEvent) => void): Promise<'started' | 'refused-running' | 'refused-prep'>`
where `sink` defaults to today's `event.sender.send('docket:runner:event', …)` and the remote path
passes a sink that ALSO feeds the WS ring/tap. Refusals return as values instead of IPC sends (the
IPC handler translates its own refusal to the same error event it sends today — byte-identical
behavior for the GUI path; no behavior change is the acceptance bar for this refactor).

### 7.3 Remote-side retention (main)

- `lastInputs: Map<string, DriveInput>` — the resolved input per owner, set where
  `lastResolvedDriveInput` is set today (`main.ts:797`), cleared never (latest-wins, bounded by
  live owner count; the `drive-store.ts:304-309` restart posture).
- `lastSessionIds: Map<string, string>` — the provider session id per owner, captured from the
  `started` event in the forward loop (resume needs it).
- `refusedInputs: Map<string, DriveInput>` — set when an `error` event carrying `refusal`
  (`runner.ts:124`) passes the sink for that owner; cleared by the next start under the tag
  (raise-and-rerun re-spawns from EITHER surface).
- `remoteRings: Map<string, RunnerEvent[]>` — the §2.6 tail rings, fed in the same sink.
- `remotePending: Map<string, PermissionAsk[]>` — refreshed per-owner from
  `[...liveRunnerInstances.entries()].map(([tag, r]) => [tag, await r.pendingAsks()])` on each
  `/console` read + `answerAsk` lookup (the SAME map the flat aggregate at `main.ts:888-891`
  iterates — §12 finding 3).
- quota facts: `remoteQuota: Map<string, { windows: LimitWindow[]; status?: … }>` keyed by profile
  name (the retained input's `profile?.name ?? DEFAULT_PROFILE` = `'default'`), folded from
  `limit_windows` events in the sink — the renderer folds these today (`drive-store.ts:202-208`);
  main folding them server-side is the one NEW main-side fact (§12 finding 4, flagged).

### 7.4 IPC for WO-0103 (frozen names; consumed by its order)

- `docket:remote:pair-mint` → `PairingStartView | null` (null when not listening) — mint + the QR
  string + endpoint (host = first non-internal IPv4 from `os.networkInterfaces()`, fallback
  `127.0.0.1`; port = the actual bound port).
- `docket:remote:devices` → `DeviceView[]`; `docket:remote:device-revoke` (id) → `boolean`.
- Preload: a `remote` group + the four §2.8 settings methods in the settings group; the
  `preload.d.ts` declarations type-only.

### 7.5 E2E guard

The server never starts under `DOCKET_E2E` (§7.1's first clause) — the fixed port across the
suite's app launches is a hazard the E2E suite does not need, and the WO-0101 lock governs any
future spec that wants it. No spec, no guard channel, no e2e file touched.

## 8. Test plan (core test-first; adapters per CLAUDE.md)

**`src/core/__tests__/remote.test.ts`** — `deriveRemoteConsole` over builder fixtures:
1. Multi-workspace fan-out: ws A with a WO drive, ws B with a WO drive + the ws-B draft → 3
   cards, ordered wo-by-woId then drafts; each card carries owner/kind/workspaceId/role.
2. `asking`: a drive whose `asks` array is non-empty → `status:'asking'` AND its `RemoteAskCard`
   sits in `asks[]` with the owner attribution.
3. Both ask shapes: an `AskUserQuestion` tool+input → `questions` parsed (the askq fixture
   shapes); any other tool → `questions` undefined (binary).
4. Health presence: quota rows only for reported profiles; spend rows only for capped
   workspaces; `workspaceBudgetView` composition (a warn-line spend → `status:'warn'`); no caps
   → no spend rows; `workspaces` labels verbatim.
5. Honesty: `quiet` true iff drives and asks are both empty; `version === REMOTE_API_VERSION`;
   the facts object is not mutated; identical facts → identical view (determinism).
6. `remoteAskDecision` parity: on the same input+answers it returns exactly what `askDecisionAll`
   returns (allow/deny/bare-allow arms).
7. `pairingVerdict` is exercised here too (or in device-store.test.ts — see below): ok /
   wrong-code (attempts decrement) / expired / used / struck (attempts hit 0) / unknown grant.
8. `serializePairingQr`/`parsePairingQr` round-trip + strict refusal (missing v, non-6-digit
   code, garbage scheme → undefined).

**`src/core/__tests__/remote-contract.test.ts`** — pure (no fs; §12 finding 1):
1. `emitEndpointsYaml()` twice → byte-identical strings.
2. Section order: `indexOf` monotonic for version/server/pairing/errors/endpoints/websocket/models.
3. Endpoint order: the 13 REST paths appear in the §2.2 order.
4. Constant echo: the output contains `String(REMOTE_DEFAULT_PORT)`, `String(REMOTE_TAIL_WINDOW)`,
   the QR grammar string, ttl/max-attempt values — emitted FROM the constants (change a constant
   → the test's expectation derived from the same constant still passes, but §9's drift test
   forces the checked-in file to regenerate — that is the guard).
5. Trailing newline exactly one; no tabs; LF only.

**`src/adapters/remote/contract-drift.test.ts`** — the on-disk guard (adapter-side because c3
has no test exemption — §12 finding 1): regenerate in memory, read `contract/endpoints.yaml`
(`node:fs`), assert byte-equality. **Hand-editing the yaml goes red** — demonstrated in the PR by
a temporary edit + failing run + revert (the order's acceptance 1).

**`src/core/__tests__/device-store.test.ts`** — the state machine over a `FakeDeviceStore`
driven by an injected clock (the fake applies `pairingVerdict` exactly as the SQLite half will):
single-use (second exchange → dead/used), TTL expiry (clock past `expiresAt` → dead/expired),
5-strike (five wrong codes → dead/struck; the fourth → invalid_code with attemptsLeft 1),
revoke-then-refuse (`deviceByKeyHash` misses after revoke), lastSeen stamping, mint-supersedes
(one live grant).

**`src/adapters/remote/server.test.ts`** — the real server on `127.0.0.1:0` against core fakes:
1. pair→read→write happy path: mint (fake devices), `/pair` → key; `GET /console` with it; `PUT
   /settings` locale+theme; `DELETE /devices/{id}` → the key stops authenticating (401 after).
2. Every refusal shape: unknown bearer (401 on every route), dead token (410 + each reason),
   expired token, struck-out token, malformed bodies (400), unknown route (404), unknown ask
   (404), stop unknown owner (404), resume with no retained input (404) / while running (409),
   draft approve with no draft (404) / unparsable (409), raise on unknown workspace (404).
3. WS: ticket single-use (second connect with the same ticket → upgrade refused 401); the tail
   window then live event order (`hello` → `tail` per buffered owner → `event` on tap), keyed by
   owner tag; `REMOTE_TAIL_WINDOW` bound respected (seed 250 events → 200 arrive).
4. Secrets: JSON-stringify every event/frame/response in the captured run → no `dk_`, no code
   value, no key-hash substring appears in any WS payload or error body (acceptance 5).
5. Delegate-only: the fake intents record every call with the exact arguments (the §2.7 map);
   no route ever consults a gate (the fakes throw if a gate method is called — the §2.7
   server-nevers pin).

**`src/adapters/store/store.test.ts`** (additive block) — the SQLite half: temp db, mint →
exchange → list → revoke → `deviceByKeyHash` miss; the `used` row refuses a second exchange;
`app_setting` theme/remote rows round-trip through the new port methods.

## 9. Mechanical verification (the ladder)

1. `npm run typecheck` (both configs — the new adapter dir rides the transitive `worktree.ts`
   precedent, no tsconfig change; §12 finding 7)
2. `npm test` — baseline 1222+ per ROADMAP's WO-0100 closure line (grep counts ~1281 declarations
   incl. `.each` variance; re-based at implementation start), + the §8 files
3. `npm run check:boundaries` — 10/10 (the adapter sits under `src/adapters/`, c3/c4 exempt;
   core stays pure — the drift test lives adapter-side for exactly this)
4. `npm run build`
5. `npm run contract` — idempotent (run twice, `git status` clean); the drift test red on a hand
   edit (demonstrated once, reverted)
6. `npm run test:ui` — 105/105, untouched (no spec added; server OFF under DOCKET_E2E)

## 10. Risks

| Risk | Exposure | Mitigation / owner |
|---|---|---|
| LAN cleartext (no TLS, v1-trusts-LAN is a frozen decision) | a LAN sniffer sees the bearer key | named in the order + ADR; Tailscale is the encrypted path when it comes; revoke exists |
| 6-digit code entropy | ~10^6, brute-forceable within TTL | 5-strike + single-use + 5-min TTL + one-live-grant; LAN threat model; revisit only by addendum (frozen) |
| `ws` under electron-builder/asar | pack failure would kill the packaged server | pure-JS dep, packs with prod deps; DUR condition stands (stop and ask if the pack breaks) |
| fixed port collision at boot | another app on 47654 | ephemeral fallback + the QR carries the actual port (frozen) |
| the `startDrive` refactor regresses the GUI path | drive-start behavior change | the refactor is behavior-identical by construction (refusals become return values the handler re-sends as the SAME events); the E2E suite (105) is the regression net; no GUI code changes |
| main-side quota fold drifts from the renderer's | two folds of one stream | both fold the same `limit_windows` events; the Konsol read's fold is presence-derived and tested; consolidation is a §11 follow-up if it ever matters |
| a phone-started drive is invisible to the desktop pane | operator confusion (tray + Konsol DO show it) | the renderer subscribes per-start (`preload.ts:112-117`); named as a follow-up (§11), out of scope here |
| `contract/endpoints.yaml` checked in but stale | the phone builds on a lie | the drift test goes red in CI on any un-regenerated change (acceptance 1) |

## 11. Follow-ups (named, not built)

- **WO-0104** (orchestrator ruling 2026-09-24): the wave-1 read surfaces BEYOND Konsol — WO
  list/detail, roadmap/TASLAK reads — land there, before docket-mobile wave 1's read screens. The
  emitter is additive; nothing in this WO precludes them.
- The dedicated remote-server E2E spec, under the WO-0101 one-suite-per-host lock, after
  docket-mobile wave 1 proves the contract live (order's Out).
- Desktop adoption of the `app_setting` theme row (TD-065 at closure) and the deferred E2E spec
  (TD-066 at closure). Win/linux listen verification rides TD-064's Route V pass when a machine
  exists (order closure item c).
- The desktop pane seeing phone-started drives (a broadcast fold or a re-attach read); and the
  quota-fold consolidation named in §10.

## 12. Findings vs the order's measured anchors (flagged, nothing silently adapted)

1. **The drift test cannot live in `src/core/__tests__/`**: c3 (`check-boundaries.mjs:107-119`)
   bans Node imports under `src/core/` with NO test exemption (verified: zero `node:` imports in
   existing core tests). The on-disk byte-compare moved to `src/adapters/remote/contract-drift.test.ts`;
   the pure byte-stability/order/constant tests stay at the order's named path. **Deviation from
   the order's test-file plan — architect confirms.**
2. **WO-0103 reconciliation**: its order says it "adds NO new core surface" while its kill-switch
   reads/writes `remote:enabled` — so the read/write surface (§2.8) ships in THIS WO. Consistent
   with both orders; stated so the review sees why the settings port grows here.
3. **The pending-asks aggregate is FLAT** (`main.ts:888-891` — `all.flat()`): owner attribution
   needs the per-owner iteration of the same `liveRunnerInstances` map (§7.3). The IPC handler
   itself is untouched.
4. **Main holds no per-profile limit-window facts today** — the renderer folds them
   (`drive-store.ts:202-208`). The Konsol health rows need a small main-side fold of the same
   events (§7.3). This is the one place "derives from the facts main already holds" needs a NEW
   (small, pure-input) fact; flagged rather than assumed away.
5. All other anchors verified exact: `main.ts:699/715-720/724-726/728-764/889`,
   `tray-menu.ts:23`, `app-settings.ts:54-55/86`, `source.ts:168/219/224/272`,
   `schema.ts`, `check-boundaries.mjs:28`, `package.json` (tsx at :59). No line drift, no renamed
   symbols.
6. **`@types/ws`** joins as a devDependency (`ws` ships no types; the order names `ws` as the one
   new RUNTIME dep — the types package is compile-only). **Deviation-ish; architect confirms.**
7. **tsconfig**: `tsconfig.electron.json` includes `electron` + named adapter dirs; the new
   `src/adapters/remote/` enters transitively via `electron/main.ts` (the `worktree.ts`/
   `gate-runner.ts` precedent, which import `node:fs` and pass both configs today). No tsconfig
   change expected; if typecheck disagrees, adding the dir to `include`/`exclude` is the fix
   (mechanical, named here).
8. **E2E-off ruling**: the order is silent on `DOCKET_E2E`; this plan never starts the server
   there (§7.5). Stated for confirmation since the manual scenario's `npm run dev` path is
   unaffected (dev ≠ E2E).

## 13. Open points needing the architect

1. §12.1 — the drift test's adapter-side home (c3 constraint): confirm.
2. §12.6 — `@types/ws` as a compile-only devDep beside the ruled `ws` runtime dep: confirm.
3. §2.2 #10 — raise-and-rerun returning `{ raised: true, rerun: false }` when no refused input is
   retained (raise stays legal; the re-run is never fabricated): confirm the shape.
4. §2.6 — `REMOTE_TAIL_WINDOW = 200` (per owner): confirm the value (it is the one constant the
   order left to this plan).
5. §12.8 — server OFF under `DOCKET_E2E`: confirm.

## 14. Manual scenario (DEFERRED — build-first; the operator runs it in the final tour phase)

Per the order: `npm run dev` shows the `[remote] listening` line + the macOS Local Network
prompt; `npm run contract` leaves `git status` clean; `curl -H "Authorization: Bearer bogus"
http://127.0.0.1:<port>/console` → 401. The live pairing tour rides WO-0103's scenario (it needs
the screen); the mechanical path is the adapter tests.
