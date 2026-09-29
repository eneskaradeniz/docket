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
  stores/       cockpit · board · work-order-detail · live-pane · settings · wizard · results · project-tree · roadmap · account
  screens/      shell · cockpit · board · detail · roadmap · account · settings · wizard
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
  a `definitions_invalid` result shows the repo-problem state, not an empty board; the
  create-work-order intent validates title presence and flow choice before issuing
  `workOrder.open` with the board's project and repo.
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
  preserves entered state; finishing leaves the wizard and does not reappear while a project
  exists.
- **U-10** (shell) The shell's attention badge count equals the cockpit's attention items,
  ranked by kind (permission asks first); it updates on the same events; when the count is
  zero the badge is absent, never zero.

## Phase 3.5 — the rev-7 shell (U-15 … U-21)

Visual source of truth: the operator-approved OpenDesign prototype "Docket v2" → `index.html`
(rev 7) — the same standing as the design book for tokens. From 2026-09-30 the running app itself
is the visual source; the rev-8 prototype is historical and is not updated. The information architecture is fixed
by the main-screen decisions (K-1…K-8, 2026-09-28/29): the Pano navigation item is gone — a board
is a repo's view; the app opens on the Kokpit, reached through the title bar's Anasayfa;
project row → roadmap, repo row → board.

### API additions (Phase 3.5)

The commands (`workOrder.open` with `project`+`repo`, `task.open`, `project.attach`,
`repo.register`, `repo.unregister`) and queries (`project.tree`, `roadmap.byProject`, `repo.board`,
`cockpit` with an optional `project` filter, `account.detail`, `project.spend`) are specified in
[application.md](application.md) → "API contracts"; their A-rules are **A-24 … A-28** there.

### Stores (U-15 … U-21)

- **U-15** (project tree / shell) The tree store is fed by `project.tree` and re-queries on
  `workOrders.changed`. Selection semantics (K-2/K-3/K-7): a project row opens the roadmap, a repo
  row opens that repo's board; while a repo row is active its project row keeps the pale-selected
  state; a single-repo project renders as one flat row opening the board, with a "Yol haritası ↗"
  link in the board header. ★ marks the main repo; the main-repo row is a repo row like any other and
  opens its board — the roadmap is reached only through the project row (one rule per row kind). A project's status dot mirrors its most urgent
  repo (`waiting > running > idle`, A-27) and its pill the total active work orders; a zero count
  hides the pill (U-10). Multi-repo groups collapse and expand (`aria-expanded`) with the state
  kept for the session. The sidebar carries no search field: ⌘K or the title bar's Ara button
  opens the centered search palette over a blurred, dimmed backdrop — while the query is empty the
  palette is the input row alone, the results (or the no-results line) appearing with the first
  typed character and folding away when it is cleared — it searches projects and
  repos by name (no other query types), ↑/↓ move, Enter opens the selected result (project →
  roadmap, repo → board, as the tree's rows do), Esc or a backdrop click closes, focus is
  trapped while open and restored on close. The sort control cycles stored
  order → A→Z → recently used; the choice persists locally (manual reordering arrives later).
- **U-16** (accounts frame) The frame collapses and expands and starts collapsed; at most two account cards are visible,
  the rest scroll. A card shows the label plus one mini bar per window (window label and normalized
  percent) and spend meta where the account carries it; a bar at or above its warn percent
  (default 80) renders warn, a `hard_stop` status renders critical; the refresh intent re-polls
  quota per account (a slow provider delays only its card — U-6). A card opens the account view
  (K-5:A).
- **U-17** (roadmap page) Fed by `roadmap.byProject`. Phases collapse and expand (grid-rows
  animation) with the done/total count right-aligned in mono; on entry the first phase is open and
  the rest closed. A task row shows its status glyph (✓ done · ● running, amber outline · ○
  remaining), the title, and one mono tag per target repo; expanding a cross-repo task lists its
  work orders per repo with navigation to the board and detail; a task turns ✓ only when every
  linked work order is done (R-40). No editing on this page (Phase 5).
- **U-18** (board) Columns are the flow's stages (A-23) and `done` is a separate strip. A
  Kanban ⇄ Liste segmented control switches views; the choice persists per repo in local storage
  and survives reload. Cards are not draggable — a work order advances only through its gates. A
  card click opens the in-place detail (K-8:A); no hover preview. The list view is a stage rail
  plus the selected stage and one row per work order (İE, title, stage progress, status, account,
  duration/cost, date). The header's "Akışı düzenle" is a shortcut that opens the Settings window
  at this repo's flow; the board itself never edits definitions (K-5).
- **U-19** (in-place detail) The detail opens in place of the board — no overlay; ‹ Geri returns to
  the board with its view state (Kanban/Liste, scroll) intact. The flow strip marks pending gates
  amber and dashed; the "bu aşamada senden beklenen" section and its actions map U-4's intents;
  the live pane follows U-5 and opens only from the card/detail (K-8:A).
- **U-20** (account view) Fed by `account.detail`. Window blocks: one large labelled bar per window
  with the used percent and the reset time ("…'de sıfırlanır · … kaldı"); the limit-behaviour band
  shows the account's policy label with ⓘ and an "Ayarlar'da düzenle" link — no control on this page
  changes the policy; `activeWork` rows navigate to the work-order detail. Information
  is inspectable (ⓘ); editing stays in the Settings window (K-5's rule: bilgi → ⓘ,
  düzenleme → Ayarlar penceresi).
- **U-21** (cockpit) The app opens on the cockpit, which has four sections: Senden bekleyenler
  (U-2's order, inline actions), Koşanlar (account badge, stage, duration; queued items dimmed),
  Proje kartları (K-4:B — each card is a shortcut to the project's default view: multi-repo →
  roadmap, single-repo → board; it shows the active count and the waiting mark), and Son kapananlar
  (the five most recent closes, `closedAt` desc). There is no global new-work-order button on the
  cockpit — that intent lives on the board header (IA-3).
- **U-22** (work-order code) A work order is shown by its code: the locale's prefix (TR `İE-`, EN `WO-`, label key `workOrder.codePrefix`) plus its A-29 number left-padded with zeros to four digits (`İE-0014`); a number above 9999 is shown in full, never truncated. The code is set in the mono face. One pure helper formats it; no screen builds a code itself.

### Prototype vs rules (2026-09-29)

Where the rev-7 prototype and U-15 … U-21 disagree, the rules win and the prototype is corrected:
the main-repo ★ row opens the board, not the roadmap (U-15); a single-repo board header carries
"Yol haritası ↗" (U-15); a cross-repo task expands to its per-repo work orders (U-17); the account
view shows the limit policy read-only with ⓘ (U-20); Son kapananlar lists five (U-21); copy says
proje / repo, never çalışma alanı (the Workspace→Repo rename).

## Verifying the shell — E2E layers (Phase 3.5)

The shell is verified against the frozen prototype **rev 8** (`~/source/docket-tasarim/rev8/`:
`index.html` + reference screenshots). Every check below drives the **built Electron app** through
Playwright's Electron mode, the same way `e2e/ui.mjs` does: launch, click, read the DOM. There is no
browser-only harness and no second transport. Maestro is out of scope for the desktop app; it
belongs to the mobile app.

| Layer | File | Runs | Blocks merge |
| --- | --- | --- | --- |
| Store rules U-15 … U-21 | `src/presentation/**/*.test.ts` | `npm test` (CI) | yes |
| Journeys | `e2e/journeys.mjs` | `npm run test:journeys` (local, after build) | yes (PR evidence) |
| Layout audit L-1 … L-9 | `e2e/layout-audit.mjs` | `npm run test:layout` (local, after build) | yes (PR evidence) |
| Gallery | `e2e/gallery.mjs` → `e2e/.out/gallery/index.html` | with the two above | no (operator's eyes) |
| Operator scenario | PR body | operator | yes (`main` gate) |

- **Seed.** `e2e/seed-design.ts` writes a throwaway data dir holding exactly the prototype's world:
  projects Antero (7 repos, main `antreo-docs`), Docket (2), date-app (3), telerelay (1), Kadife
  Odoo (1); the prototype's work orders by code, stage and state; two accounts with 5-hour, weekly
  and monthly windows. The same codes appear in the same place on every screen. It never touches the
  operator's data.
- **Window sizes.** Every journey and every audit runs at 1024×640 (the minimum), 1280×800 (the
  default), 1920×1080 and 2560×1440, in the dark and the light theme. The sidebar is always open,
  never collapses. The harness resizes the `BrowserWindow`; it does not scale the page.
- **Journeys** (one `test` each, named `J-n: …`): J-1 cockpit → answer a permission ask inline →
  the item leaves Senden bekleyenler · J-2 tree → repo row → board; Kanban ⇄ Liste survives reload ·
  J-3 card → in-place detail → approve → ‹ Geri returns with view state intact · J-4 project row →
  roadmap → expand a cross-repo task → its work order opens the detail · J-5 single-repo project →
  board → "Yol haritası ↗" · J-6 account card → account view → "Ayarlar'da düzenle ↗" opens
  Settings · J-7 ⌘K opens the search palette and focuses its input. Each step asserts visible text and saves a screenshot.
- **Layout audit** (pure DOM measurement, no pixel diff; each assertion named `L-n: …`, for every
  screen × size × theme):
  - **L-1** The sidebar's left edge is 0 and its width is 240px at every window size — it never
    narrows — identical (±0.5px) on every screen.
  - **L-2** No page-level horizontal scroll: `documentElement.scrollWidth <= innerWidth`.
  - **L-3** Every visible button, link and input lies fully inside the window and inside its nearest
    clipping ancestor, except inside the declared Kanban scroller.
  - **L-4** Text whose `scrollWidth` exceeds its `clientWidth` by more than 1px uses
    `text-overflow: ellipsis` and carries its full text in `title`.
  - **L-5** The main column's content width is at most 1200px (cockpit), 1280px (detail) or 960px
    (roadmap, account); the board uses the full main width.
  - **L-6** The accounts frame is never collapsed: at the 1024×640 minimum its body stays visible
    under its header.
  - **L-7** When the detail's main width is below 900 the live pane sits below the "bu aşamada
    senden beklenen" section.
  - **L-8** When Kanban columns overflow, the scroller has scroll-snap and shows the edge fade.
  - **L-9** At 1280×800 the cockpit's "Son kapananlar" heading starts inside the first screen.
- **Evidence.** A UI PR attaches the pass lines of `test:journeys` and `test:layout` and the gallery
  path. The architect compares the gallery against the rev-8 reference screenshots before the
  operator scenario.
- J-n and L-n are E2E assertions, not coverage-checked rules: `check-rule-coverage.mjs` does not
  list them.

## Electron bridge (no U-rules — structural)

`electron/main.ts` composes `createNodeDeps` + the api, starts the dispatcher/executor loops,
and owns the window; `electron/preload.ts` exposes exactly one `window.docket` surface
(`command`, `query`, `subscribe`) over `contextBridge` — no Node surface leaks. Verified by
the E2E smoke and the operator scenario, not by unit rules.

## Operator scenario (the gate)

Every UI-bearing PR batch ends with a numbered manual scenario on the tracker PR (Turkish);
the operator walks it against `npm run dev` and records the verdict. No merge to `main`
without the verdict; merges into `v2` are fine.
