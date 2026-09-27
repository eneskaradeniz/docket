# UI — presentation layer (Phase 4)

The presentation layer is React + Tailwind over the API boundary
([architecture.md](architecture.md) → "API boundary"). It contains **no business logic**:
every decision comes from `src/api/` (commands, queries, events) or the domain's types. The
stack (React, Tailwind, Radix primitives, dnd-kit, vite-plugin-electron) is already in
`package.json` — Phase 4 adds **no new dependencies**.

## Shape

```
src/presentation/
  labels/       tr.ts · en.ts · keys.ts (typed keys) · t.ts (resolver)
  stores/       cockpit · board · work-order-detail · live-pane · settings · wizard · results
  screens/      shell · cockpit · board · detail · settings · wizard
  components/   shared presentational components (no stores, props only)
```

- Stores are plain TypeScript modules (no React imports): they hold view state, call the API
  ports, and expose intents. Components subscribe and render. Every **U-n** rule lives in a
  store, label, or pure helper — unit-testable without a DOM (`vitest`, node environment).
- Components carry no rules: they are verified by the E2E smoke (`e2e/`) and the operator's
  numbered manual scenario (the operator gate — [roadmap.md](roadmap.md) → "Batch mode").
- The API's `events` subscription (U-12) is the only push channel; stores re-query on it.

## API additions (Phase 4; rules U-11 … U-14)

```ts
// commands
| { type: 'permission.answer'; runId: string; askId: string; decision: 'allow' | 'deny' }
| { type: 'deploy.approve'; workOrderId: string; gate: string; commit: string; confirmedEnvironment?: string }
| { type: 'account.save'; id?: string; provider: string; label: string; authMode: string; plan?: string }
| { type: 'account.remove'; id: string }
| { type: 'binding.save'; role: string; accounts: { accountId: string; model?: string }[] }
// queries
| { type: 'settings.accounts' }        → accounts with pools/meters and per-role bindings
| { type: 'providers.discovered' }     → DiscoveredProvider[] (kicks a discovery pass)
// Api member
subscribe(listener: (e: UiEvent) => void): () => void;
type UiEvent = { type: 'workOrders.changed' } | { type: 'run.updated'; runId: string };
```

- **U-11** `permission.answer` reaches the run that owns `askId` through the permission board
  (an in-process registry service the executor registers every run's gate on): an unanswered
  ask is listed until answered or its run ends; `answer` resolves the waiting run; an unknown
  or ended `askId` returns `{ ok: false, code: 'not_found' }` and never throws.
- **U-12** `Api.subscribe` emits coarse change events after any command that appends to the
  event log or any run event (`workOrders.changed` · `run.updated` with `runId`).
  Notifications never carry payloads — stores re-query. Unsubscribe stops delivery; a listener
  that throws does not break the emitter.
- **U-13** `settings.accounts` returns every account with its pools and meters plus the
  per-role binding chains; `providers.discovered` kicks a discovery pass and resolves when the
  pass ends (per-provider failures are `null` fields, not query failures). `account.save` /
  `account.remove` / `binding.save` map onto the use cases; removing an account referenced by
  a binding fails with `{ ok: false, code: 'binding_exists' }` listing the referencing roles.
- **U-14** `deploy.approve` binds `approveAndDeploy`: the actor must be the user (mirroring
  E-11's `no_approval`), `confirmedEnvironment` travels verbatim, and every `DeployGateError`
  maps to its own `CommandResult` code. A protected environment without the typed
  `confirmedEnvironment` surfaces `confirmation_mismatch` (E-8 unchanged).

Deploy approval passes the gate's `environment`; a protected environment without the typed
`confirmedEnvironment` fails with `confirmation_mismatch` (E-8/E-11 surface unchanged).

## Labels (U-1, U-8, U-9)

- **U-1** All user-visible copy lives in `labels/{tr,en}.ts` behind typed keys (`labels/keys.ts`);
  Turkish is the default locale, English is a peer. A component or store that renders a literal
  user-visible string is a defect (codes, ids and slugs excluded). Every `CommandResult` error
  code and every `QueryFailure` code the UI can receive has a label key.
- **U-8** `results.ts` maps every `CommandResult` to display copy: success → confirmation toast
  copy, `ok: false` → the code's label; an unknown code renders the generic failure key, never
  an empty or raw code string to the user (the code itself is available for copying).
- **U-9** The locale is a store setting: switching swaps the bundle without reload and persists
  the choice; the resolver falls back to Turkish for a key missing from the English bundle.

## Stores

- **U-2** (cockpit) Attention items keep the API's order (A-22 rank, oldest first); the store
  re-queries on `workOrders.changed` and `run.updated`; an item's age renders from `since` in
  the active locale. A failed query leaves the previous view and surfaces a retry intent — an
  error never blanks the cockpit.
- **U-3** (board) Columns mirror `BoardView` (stage order preserved, `done` as a separate lane);
  a `definitions_invalid` result shows the workspace-problem state, not an empty board; the
  create-work-order intent validates title presence and flow choice before issuing
  `workOrder.open`.
- **U-4** (work-order detail) The store derives, per stage, the gate list with human-readable
  states; for a `deploy` gate it exposes the environment, whether it is protected (typed
  `confirmedEnvironment` required — the input must equal the environment name before the
  approve intent is issued), and the prerequisite (E-5 chain, read-only). Gate decisions,
  stage enqueues, permission answers and deploy approvals are intents that map `CommandResult`
  through U-8 and refresh the detail query.
- **U-5** (live pane) The store folds a run's `AgentEvent` stream into display items
  (thought, message, tool call with status, usage, quota signal) in arrival order, keeps the
  earliest still-open permission ask with an answer intent, and marks the stream ended on
  `finished`. Events after `finished` are ignored.
- **U-6** (settings) Accounts list with their pools/meters (label, remaining, unit, resets at
  in locale format, source badge from `ObservationSource`), per-role bindings, and discovery
  results that stream in per provider (a slow provider delays only its row). Saving an account
  or binding maps through U-8; removing an account that a binding still references warns with
  the referencing roles before issuing the command.
- **U-7** (wizard) First-run state machine: definitions source → account → binding → done.
  `next` is enabled only when the step's validation passes (source reachable / at least one
  discovered+logged-in provider for the chosen account / at least one bound role); `back`
  preserves entered state; finishing leaves the wizard and does not reappear while a workspace
  exists.
- **U-10** (shell) The shell's attention badge count equals the cockpit's attention items,
  ranked by kind (permission asks first); it updates on the same events; when the count is
  zero the badge is absent, never zero.

## Electron bridge (no U-rules — structural)

`electron/main.ts` composes `createNodeDeps` + the api, starts the dispatcher/executor loops,
and owns the window; `electron/preload.ts` exposes exactly one `window.docket` surface
(`command`, `query`, `subscribe`) over `contextBridge` — no Node surface leaks. Verified by
the E2E smoke and the operator scenario, not by unit rules.

## Operator scenario (the gate)

Every UI-bearing PR batch ends with a numbered manual scenario on the tracker PR (Turkish);
the operator walks it against `npm run dev` and records the verdict. No merge to `main`
without the verdict; merges into `v2` are fine.
