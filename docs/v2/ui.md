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
  the referencing roles before issuing the command. Settings is not a page in the body: it opens
  as a centered window-style overlay over the current route (the wizard's frame, a 200px section
  menu beside the selected section's content) — ✕, Esc or a backdrop click closes it, and the
  route underneath stays unchanged.
- **U-10** (shell) The shell's attention badge count equals the cockpit's attention items,
  ranked by kind (permission asks first); it updates on the same events; when the count is
  zero the badge is absent, never zero.

## Phase 3.5 — the rev-7 shell (U-15 … U-21)

Visual source of truth: the operator-approved prototype "Docket v2" → `index.html`
(rev 7) — the same standing as the design book for tokens. From 2026-09-30 the running app itself
is the visual source; the rev-8 prototype is historical and is not updated. The information architecture is fixed
by the main-screen decisions (K-1…K-8, 2026-09-28/29): the Pano navigation item is gone — a board
is a repo's view; the app opens on the Kokpit, reached through the sidebar's Anasayfa row;
project row → roadmap, repo row → board. Every current item of the sidebar — Anasayfa, Ara while
its palette is open, the nav's Telefon/Ayarlar rows while the settings panel is open on their
section, the tree's active rows, the active account card — speaks one active-state language: a
raised ground with a 1px `--color-signal`
border at the row's own radius, never an inset signal bar, with a soft variant (raised ground,
hairline border) for a selected repo's parent project.

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
  kept for the session. The sidebar's top carries the four nav rows — Anasayfa (32px, icon +
  label, the cockpit's route, the attention badge on its right edge, U-10), Ara (the palette's
  door, its ⌘K hint right-aligned), Telefon and Ayarlar (the settings panel's doors, on their own
  section) — and the tree sits below them; the sidebar carries no search field beyond the Ara
  row: ⌘K or that row
  opens the centered search palette over a blurred, dimmed backdrop — while the query is empty the
  palette is the input row alone, the results (or the no-results line) appearing with the first
  typed character and folding away when it is cleared — it searches projects and
  repos by name (no other query types), ↑/↓ move, Enter opens the selected result (project →
  roadmap, repo → board, as the tree's rows do), Esc or a backdrop click closes, focus is
  trapped while open and restored on close. An empty query with remembered searches lists them
  under a "Son aramalar" header with a "Temizle" text button: ↑/↓ walk the rows, choosing one
  (click or Enter) fills the input with that query and runs it at once, a row's × removes that
  entry, and "Temizle" empties the list at once — the rows walk out with the row-exit motion and
  the body folds back to the input alone. A query is remembered only when a result is opened
  from the palette (Enter or click), never per keystroke or on a dismiss: trimmed, at least two
  characters, at most 60, deduped case-insensitively with the fresh entry first, at most ten
  (the oldest drops); it persists per viewer in local storage (`docket.searchHistory.v1`), read
  tolerantly so a corrupt value reads as empty — queries are project and repo names, never
  anything secret. The sort control cycles stored
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
- **U-18** (board) Columns are the flow's stages (A-23) and the done work is the last column, shut
  by default. A Kanban ⇄ Liste segmented control (icon-only) switches views; the choice persists per
  repo in local storage and survives reload. Cards are not draggable — a work order advances only
  through its gates. A card click opens the in-place detail (K-8:A); no hover preview. A column
  folds to a 48px rail and unfolds again; each repo remembers the choices in local storage. A column
  holding a card that waits on a person (`awaiting_human`, `blocked`, `limit_waiting`) never folds,
  and on a flow of more than six stages the empty stages start folded. The list view is one flow:
  rows grouped by stage in flow order with the done work last; a group folds and unfolds, and each
  repo remembers the choices in local storage. A filled stage starts open, an empty stage and the
  done group start closed, and an empty group never opens. A row shows the work-order code, the
  title and the status. The pencil beside the repo name opens the Settings window, where the project
  and its flow are edited; the board itself never edits definitions (K-5).
- **U-19** (in-place detail) The detail opens in place of the board — no overlay; ‹ Geri returns to
  the board with its view state (Kanban/Liste, scroll) intact — ‹ Geri is the navigation history's
  back: its label names the previous entry's kind and the row is hidden when no previous entry
  stands behind it (U-25). The flow strip marks pending gates
  amber and dashed; the "bu aşamada senden beklenen" section and its actions map U-4's intents;
  the live pane follows U-5 and opens only from the card/detail (K-8:A).
- **U-20** (account view) Fed by `account.detail`. Window blocks: one large labelled bar per window
  with the used percent and the reset time ("…'de sıfırlanır · … kaldı"); the limit-behaviour band
  shows the account's policy label with ⓘ and an "Ayarlar'da düzenle" link — no control on this page
  changes the policy; `activeWork` rows navigate to the work-order detail. Information
  is inspectable (ⓘ); editing stays in the Settings window (K-5's rule: bilgi → ⓘ,
  düzenleme → Ayarlar penceresi).
- **U-21** (cockpit) The app opens on the cockpit, which has four sections: Senden bekleyenler
  (U-2's order, inline actions), Koşanlar (account badge, stage, duration; queued items dimmed, A-36),
  Proje kartları (K-4:B — each card is a shortcut to the project's default view: multi-repo →
  roadmap, single-repo → board; it shows the active count and the waiting mark), and Son kapananlar
  (the five most recent closes, `closedAt` desc). There is no global new-work-order button on the
  cockpit — that intent lives on the board header (IA-3). An account is identified by its provider's
  mark, everywhere a badge names one (cockpit rows, sidebar cards, account view header, Settings
  accounts list): the logo from `providers.marks`, monochrome in the row's text colour; an unknown
  provider shows a neutral rounded-square outline, never a letter.
- **U-22** (work-order code) A work order is shown by its code: the locale's prefix (TR `İE-`, EN `WO-`, label key `workOrder.codePrefix`) plus its A-29 number left-padded with zeros to four digits (`İE-0014`); a number above 9999 is shown in full, never truncated. The code is set in the mono face. One pure helper formats it; no screen builds a code itself.
- **U-23** (corner radius) Corner radius comes from three tokens and nothing else: `rounded-control` (6px — buttons, inputs, tabs and segments, icon buttons, hover rows, chips), `rounded-card` (8px — bordered boxes: cards, alerts, notices, sections, bordered list rows, the sidebar frames) and `rounded-panel` (12px — surfaces that float or hold cards: modals, the search palette, the settings panel, Kanban lanes). `rounded-full` stays for lamps and round badges. No other `rounded-*` utility and no hand-typed radius in `src/presentation`; a test scans the sources.
- **U-24** (app update / nav doors) One update store feeds both update surfaces off the
  `app.update` query (A-32) and re-queries on `update.changed`; the mapping from `UpdateState`
  to the bar button is one pure function. The title bar carries the traffic lane, the signal
  accent, the wordmark and nothing else at its left; its right edge carries the Update button —
  a bordered 28px ghost with a download glyph and a signal border, the app's one call to action —
  only while the state is `available`, `downloading` or `ready`: "Güncelle" (click applies),
  "%NN" (downloading, disabled) and "Yeniden başlat" (ready; click applies again). For `none`
  and `error` the bar's right end is empty drag region. The button is `no-drag`; the rest of the
  bar stays one drag region. The settings panel appends two sections — Telefon (the honest
  "Telefon bağlı değil" with one explanatory line and a disabled "Eşleştir" labelled "Yakında";
  no fake data — the phone link feature does not exist yet) and Güncelleme (the current version,
  a status line per `UpdateState` with the error's reason, a "Şimdi kontrol et" button issuing
  `app.update.check`, and the same apply action as the bar). The nav's Telefon row opens the
  panel on the phone section; the Ayarlar row opens it on the Hesaplar section (U-28; it used to open on the language section, as the foot's
  gear did); the sidebar foot carries the accounts frame and nothing else. A download mutates the
  checker while the apply command is in flight and `update.changed` fires only at its end, so
  the store polls the query through the flight — the percent standings must be visible.
- **U-25** (navigation history) The shell keeps a navigation history — a pure reducer
  `stores/nav-history.ts` over `{ entries, index }`. Entries are the cockpit, a repo's board, a
  project's roadmap, a work-order detail and an account view; the settings panel and the search
  palette are overlays and never entries, and a navigation to the route already current adds
  nothing. A push truncates the forward part and stamps the left screen's main-column scroll
  into its entry; the history holds at most 50 entries (the oldest drops). Back and forward move
  the index and restore the target's scroll in memory — the board's Kanban/Liste choice and the
  roadmap/cockpit folds keep their own state and are not stored. Entries whose subject no longer
  exists (a removed repo or project, a vanished work order) are skipped silently in the travel
  direction; a walk that finds nothing valid lands on the cockpit. The title bar carries two
  icon-only chevron buttons 12px after the wordmark (28×28, ghost, no-drag), dimmed and inert
  with `aria-disabled` at the ends, labelled "Geri ⌘[" / "İleri ⌘]" from the bundles; ⌘[ and ⌘]
  do the same and are ignored while focus is in an input/textarea/contenteditable or while the
  palette or the settings panel is open. The detail's ‹ Geri row calls the same back.
- **U-26** (loading skeletons) A load that outlives `MOTION.skeleton.delayMs` (150 ms) shows
  skeletons — grey placeholder shapes in the real content's layout, never a blank gap or a
  spinner — built from one `Skeleton` primitive (`components/skeleton.tsx`): a block in the
  raised tone (slightly lighter at the crest) whose shimmer sweeps left→right every 1.4 s
  (`ease-in-out`, infinite), `aria-hidden` blocks inside a holder that carries
  `aria-busy="true"`, and a static placeholder under `prefers-reduced-motion`. The anti-flicker
  rule is the pure `skeletonPhase(loadingSince, now, shownSince)` (`stores/skeleton-phase.ts`,
  time injected): a skeleton appears only past the delay and, once shown, holds at least
  `minShowMs` (300 ms); the real content then enters with the row motion's rise and fade. The
  compositions (`cockpit-skeleton`, `board-skeleton`, the tree rows and the account cards) mirror
  their screen's own wrappers, paddings and row heights so nothing jumps. `npm run design --
  --slow` sets `DOCKET_API_DELAY_MS` (1200) — read once in the composition root, set only by
  `e2e/design-run.mjs` — so the standings can be seen; absent means no delay, as today.

## Settings and setup (U-27 … U-37)

Visual source: the operator-approved draft `~/source/docket-tasarim/ayarlar/akis.html` (draft 2,
2026-10-03) with its decision notes `kararlar-bagli-akis.md` (N-1 … N-8) and
`kararlar-ayarlar.md` (S-1 … S-13); the wizard keeps the approved rev 28.1 flow
(`rev8/index.html#/kurulum`). The API it reads and writes is
[application.md](application.md) → "Settings surface" (A-48 … A-52) plus the existing
`account.models`, `account.consent.*`, `accounts.candidates`, `account.adopt`, `binding.save`.

One principle runs through it: **two kinds of user, one screen, no mode switch.** A user who wants
the defaults never has to touch anything; a user who tunes everything finds every parameter one
"İnce ayar" away; whatever differs from the recommendation is always visible and one click from
being reset.

- **U-27** (info bubble) One component `components/info-bubble.tsx` serves every ⓘ, `?` and
  dashed-underline term; its open/close logic is a pure reducer (`stores/info-bubble.ts`, time
  injected) and its placement a pure `placeBubble(anchor, size, bounds)`
  (`components/bubble-place.ts`). The trigger is a real `button` (16px glyph, 24px hit area)
  with `aria-label` "Bilgi: <subject>" from the bundles, `aria-expanded` and `aria-describedby`
  pointing at the bubble, which sits in the DOM `hidden` until open so a screen reader reads it on
  focus. Pointer hover opens after 400 ms and leaving closes after 150 ms (moving onto the bubble
  keeps it); keyboard focus (`:focus-visible`) opens at once; click, Enter or Space pins it open or
  closes it; Esc closes and returns focus to the trigger; an outside click, a scroll of the
  scrolling ancestor, or focus leaving trigger and bubble closes it; one bubble is open at a time.
  Content is plain text — an optional bold title and at most three sentences, nothing interactive
  (`role="tooltip"`). Placement: below with an 8px gap, flipped above when below does not fit,
  centred on the trigger and clamped 8px inside the bounds (the nearest panel or page body),
  200–320px wide, `rounded-card`; 120 ms fade, none under `prefers-reduced-motion`.
- **U-28** (settings sections) The Settings window (U-6's frame) carries two menu groups: Çalışma —
  Hesaplar, Roller, Yetenekler, Sağlayıcılar; Uygulama — Görünüm, Telefon, Güncelleme. The nav's
  Ayarlar row opens the panel on **Hesaplar** (U-24's Telefon row is unchanged). Hesaplar opens an
  account's sub-page in place with a `‹ Hesaplar` back row (a role's settings open in its own row's
  "İnce ayar", U-33, not a sub-page); Esc first
  leaves the sub-page, then closes the panel; a sub-page is not a U-25 history entry. Hesaplar's
  menu row carries an amber dot while discovery holds an account not yet added (U-34).
  Görünüm holds Dil and Tema (U-36), each a segment control. There is no simple/advanced switch
  anywhere. A section opens with its title (20/700, plain text — no boxed header card, no upper-case
  label) and its rows sit directly under it; mono type is kept for machine data alone (paths,
  versions, commands, ids, money), never for labels, states or names.
- **U-29** (setting row and the recommendation) Every setting is one row: title and one sentence
  of purpose on the left, one control on the right (a listbox button, a number field, a switch),
  and below it an optional "› İnce ayar" disclosure holding that setting's deeper parameters.
  Every option list marks the recommended option "Önerilen". The recommendations are one constant
  table in `stores/recommended.ts`: limit policy `wait_resume`; no reserve; warn 80 %; spend cap
  $50 per month; a role's work style by the role (U-33). A pure `settingDiffs(account)` returns the
  settings that differ from the table; under each such row the surface shows "Önerilenden farklı ·
  önerilen: X" and an "Önerilene dön" intent, the editor's head shows "n ayar önerilenden farklı ·
  Hepsini önerilene döndür" (or "Bu hesap önerilen ayarlarla çalışıyor."), and the same count rides
  the account rows of Settings and the wizard's Bütçe step. A disclosure whose content differs from
  the recommendation starts open — no changed value is ever hidden. A value that was never set is not
  a choice: it is not counted as a difference and opens no disclosure. The count reads "n ayar
  önerilenden farklı" wherever it appears, never an abbreviation. In Settings a change saves on
  commit (choice → at once; number → on blur or Enter) and shows "Kaydedildi" for 1.5 s; a failure
  shows its U-8 label under the row and keeps the entered value.
- **U-30** (account editor) One editor body with four tabs — Genel · Kullanım · Limitler ·
  Modeller — has two hosts: in Settings the account sub-page (saving per U-29, with a "Hesap
  görünümünü aç" link that closes the panel and opens the account view), in the wizard a centred
  560×480 window with Vazgeç and Kaydet (Esc = Vazgeç) whose draft is written when the wizard
  finishes. Genel: the label (`account.save`), and the account facts read-only — provider,
  connection, plan, `identityDir`, `endpointHost`, whether a key is in the keychain (`hasSecret`,
  never a value). Kullanım: one bar per meter (U-31) or, for a pay-per-use account, this period's
  spend against its cap; "Son okuma · Yenile". Limitler: "Limit dolunca" (all four policies with
  their one-line purpose, `wait_resume` recommended, `switch_pool` disabled with a reason when the
  account has a single pool; `account.save` with `limitPolicy`); "Kendi kullanımın için ayır" (Yok
  · %10 · %20 · %30 · "Pencereye göre ayrı…", whose fine-tune holds separate 0–95 short and long
  fields naming the account's meters of each `reserveClass` (a `larger` meter is named under
  both, with "büyük olan geçerli"); `account.save` with `reserve`, A-45's
  `invalid_reserve` mapped); "Harcama tavanı" only on an account that may spend money — a
  pay-per-use account or one with any `consentedModels` — amount and period, fine-tune warn
  percent (`account.cap.save`; A-52's `cap_required` mapped). Under Limitler a fixed note: an
  automatic switch never moves from an included model to a paid or unverified one (P-40). A
  subscription account without consents shows no money anywhere.
- **U-31** (reserve on a bar) A meter bar shows remaining from the left. With a non-zero
  `reserveShare` (A-48) the bar carries a hatched zone from 0 to that share with a 2px
  edge, the footnote "%r senin için ayrılmış", and — when remaining is at or below that share —
  the amber tag "Rezerve ulaştı — yeni koşu başlamaz". The same reading drives the accounts frame
  (U-37). A meter whose unit is not a share never draws a zone.
- **U-32** (models and spend consent) Modeller groups `account.models` by billing: Plana dahil
  (no mark — silence means included), Kullanım başına ücretli (`$`), Doğrulanamadı (`?`, dashed);
  billing is per account and plan, never per model alone. A `$`/`?` row without consent offers
  "İzin ver…", which opens an inline card under the row: what the mark means (the `?` text is
  fixed: Docket could not verify the plan covers it and using it may be billed — no amount, no
  price claim), that only a hand-picked role uses it and tiers and fallbacks never pick it, the
  account's cap (required when the account has none, prefilled with the recommendation), Vazgeç
  and İzin ver → `account.consent.grant` with the cap. A consented row shows "İzinli" and a
  "Geri al" (`account.consent.revoke`, no confirmation). A stale list says so beside "Yenile"
  (`refresh: true`).
- **U-33** (roles) Roller lists `roles.list` (A-50). On top, "Asistan sırası": the global chain
  every role uses, reordered with ↑/↓ (Alt+↑/↓) — saving it issues `binding.save` for every listed
  role with its complete binding (A-49). Below, one row per role with its work style — Hızlı ·
  Dengeli · Özenli, a presentation preset a pure `workStyle` maps to and from
  `{ tier, thinking }` (fast/fast · balanced/balanced · strong/deep); any other pair reads
  "Özel". Recommended style: Planlayıcı, Gözden geçirici, Güvenlik denetçisi Özenli; Geliştirici,
  Test yazarı Dengeli; Analist, Belgeci Hızlı; a role outside this list Dengeli. A role whose
  binding sets neither tier nor thinking shows no selection and no difference; while any role is in
  that state the section starts with one line "n rol önerilen çalışma biçimini kullanmıyor ·
  Önerilenleri uygula", whose intent saves the recommended style for exactly those roles (complete
  bindings, A-49). "Özel" is a fourth, non-clickable standing inside the segment, never a label
  beside it; the role row carries no repeated explanatory sentence. A role's
  fine-tune: hesap sırası (Tüm roller / Bu role özel, the latter a chain with per-account model
  pin whose `$`/`?` models are selectable only after consent), kademe, düşünme with an exact
  effort list, and the role's stages that set their own tier or thinking (read-only, with the flow
  name). A stage with `sameProviderReview` puts an amber line on its role's row: the review will
  run on the provider that wrote the code; adding an account of another provider sends it there.
- **U-33a** (amends U-33; 2026-10-09, #838) "Asistan sırası" also offers a "+" chip for every
  account outside the chain (the same chip the fine-tune's own chain uses), with one dim hint line
  above them; with accounts but an empty chain the chips sit beside the empty line. Clicking a chip
  appends the account to the chain's end and saves every listed role with its complete binding
  (A-49); a role with its own chain keeps it.
- **U-38** (providers) Sağlayıcılar lists `providers.discovered` (A-67): one row per provider —
  mark, `name`, version (mono), status (Hazır · Giriş gerekli · Doğrulanamadı for `loggedIn: null`)
  and the binary path (mono, dim, full in `title`); "Yeniden tara" re-runs discovery and each row
  updates as its provider answers (U-6); providers not found on the machine fold into one closed
  group "Kurulu değil · n" whose rows show `installUrl` as copyable text. No row invents a version,
  a status or a command.
- **U-39** (account test, A-68 … A-74; added 2026-10-03) "Test et" sends `account.test` for a
  **saved** account (it needs an account id): inline on a Settings → Hesaplar account row whose
  provider reads Doğrulanamadı (`loggedIn: null`, U-38), and on every account's editor Genel tab
  (U-30). It tests the route's default model (no `model` is sent; the line names it "asistanın
  varsayılanı"). While the command is open the button reads "Test ediliyor…" and is disabled; on its
  answer the store re-queries `settings.accounts` and renders the row's `test` view as one result
  line: `null` → "Test edilmedi"; `ok` → "Çalışıyor" with the relative time of `at`; `failed` → the
  class sentence — `auth` "Giriş gerekli ya da anahtar geçersiz", `limit` "Bu model şu an
  kullanılamıyor — plan limiti", `model` "Bu model bu hesapta kullanılamıyor", `network` "Bağlantı
  kurulamadı ya da yanıt gelmedi", `install` "Asistan bu makinede çalıştırılamadı", `unknown` "Test
  başarısız oldu" — with a closed "Ayrıntı" disclosure showing `detail` (mono) only when it is not
  empty. A `failed` view of class `model` sets the account row's status to "Model hatası" (error
  tone) until the next test or reset. Refusals are U-8 labels under the button:
  `needs_spend_consent` "Bu model ücretli ya da doğrulanmadı — önce Modeller'de izin ve tavan ver"
  with a link to the Modeller tab, `spend_cap_reached` "Harcama tavanı doldu", `busy` "Test zaten
  sürüyor", `unsupported` "Bu hesap test edilemiyor", `not_found` the generic not-found label. The
  model's output is never shown anywhere. The wizard's Hesaplar rows are discovery candidates, not
  accounts yet, so they carry no "Test et": a Doğrulanamadı candidate's status line adds "Kurulumdan
  sonra Ayarlar'da test edebilirsin".
- **U-40** (Yeni proje, A-75 … A-79; added 2026-10-03; approved prototype
  `docket-tasarim/rev8/index.html` → calismaAlan*) A page at route `#/yeni-proje` in the wizard's
  page language: a centred 880×580 card, title "Yeni proje", one line "Docket'in çalışacağı projeyi
  seç ya da yenisini birlikte kuralım.", and a fixed bottom band (Vazgeç · reason line · primary).
  Cards, in the prototype's order: the featured "Birlikte sıfırdan başla" card is shown **disabled**
  with a "Yakında" tag (Phase 7, #658) and is never selected; under the divider "ya da var olan bir
  yoldan başla": "Var olan klasör" (selected by default), "Git'ten klonla" disabled with "Yakında",
  "Boş proje". Var olan klasör: "Klasör" path field and "Proje adı" (pre-filled with the folder's
  last path segment once a path is typed, editable); primary "Oluştur" sends `project.create`
  `mode: 'existing'`. Boş proje: "Proje adı" and "Konum" (parent folder path) with the note
  "Konum içinde yeni bir klasör oluşturulacak."; primary "Oluştur" sends `mode: 'blank'`. The reason
  line names the missing input ("Bir klasör seç." / "Projeye bir ad ver.") and the primary stays
  disabled until it is satisfied. Errors are U-8 labels under the field they concern:
  `invalid_name`, `not_a_repo` ("Bu klasör bir git deposu değil"), `not_a_folder`, `folder_exists`,
  `docket_folder_exists` ("Bu klasörde yarım bir .docket var; elle düzelt"), `io_failed`,
  `definitions_invalid`; `project_exists` shows "Bu klasör zaten bir Docket projesi" with a "Bağla"
  action that sends `project.attach` for the same path. Success closes the page, refreshes the tree
  (U-15) and opens the new project's board, with one toast: "Proje oluşturuldu. Test komutlarını
  .docket/repo.yaml'a yaz; yazılana kadar test kapısı bekler." Entries: the wizard's "Kurulum tamam"
  moment keeps its inline "Proje bağla" form (U-35) and adds a "Yeni proje oluştur" link under it
  that opens this page; the sidebar's "Projeler" header gets a "+" icon button (title "Yeni proje")
  opening it. No folder picker exists yet: paths are typed (mono fields).
- **U-41** (shared components; added 2026-10-04, #750) The setup wizard and Settings are built from
  one set of components — never a wizard copy and a Settings copy. The approved design is the
  prototype `docket-tasarim/kurulum-v3/index.html`; where a rule and the prototype differ, ask.
  Components: **Window** (880×580, 200px left column + content column of head · scrolling body ·
  optional footer band; the footer never leaves the window — the body scrolls); **SettingRow**
  (U-29's row: title, one sentence, one control on the right); **Listbox** (a button showing the
  current value and a chevron; click or ↓/↑ opens a list of options with a ✓ on the selected one and
  an "Önerilen" tag on the recommended one; Enter picks, Esc/Tab closes, outside click closes);
  **AccountGroups** (one card per assistant: mark, name, account count; one row per account: label,
  billing tag — "Abonelik", "Abonelik · anahtarla", "Kullandıkça öde", "Ücret bilinmiyor" from the
  P-51 billing view — `displayPath · host` in mono, status, ✎, and the selection circle where the
  host selects); **MeterList** (U-44); **DragOrderList** (rows with a grip, position number, mark,
  label and sub-line; pointer drag moves a row and the others slide to their slots; Alt+↑/↓ moves the
  focused row; each move is announced "n. sıraya taşındı"); **AccountEditor** (U-43). A footer button
  that does not apply to a step is not rendered (no reserved space).
- **U-42** (setup wizard v3; supersedes U-35 where they differ; added 2026-10-04, #750) Steps: Hoş
  geldin → Hesaplar → Yetenekler (skipped "–" until #715) → Asistan sırası (skipped with fewer than
  two ready selected accounts) → Bütçe. **Hoş geldin**: two SettingRows — Dil (Listbox Türkçe ·
  English) and Tema (Listbox Sistem · Koyu · Açık with a small swatch, Sistem recommended) — applied at
  once; no Geri on this step. **Hesaplar**: a toolbar on top ("Bulunanlar · n hesap · m asistan" left,
  "Yeniden tara" right with a thin progress line while scanning) and AccountGroups over
  `accounts.candidates` (directory and machine-login candidates, P-53); every installed provider has a
  group; a needs-login account says "Terminalde <asistan> ile giriş yap, sonra Yeniden tara"; a
  Doğrulanamadı account says "Giriş durumu okunamıyor. Kurulumdan sonra Ayarlar'da test
  edebilirsin." (no Test et in the wizard, U-39); ready accounts start selected; the gate is U-35's.
  **Asistan sırası**: DragOrderList of the selected accounts, ready subscriptions first, then the
  others; a non-included account's sub-line reads "<billing tag> · otomatik geçişte atlanır"; the
  first row's sub-line reads "İlk tercih"; a note says every role uses this order and that a
  role-specific order lives in Settings. **Bütçe**: two groups by the P-51 billing view — "Abonelikler ·
  Planına dahil kullanım; para harcamaz" and "Kullandıkça öde ya da ücreti bilinmeyen · Para
  harcayabilir; tavan ve iznin olmadan çalışmaz"; a subscription row has "Limit dolunca" (Listbox:
  Sıfırlanınca sürdür (recommended) · Sıradakine geç · Aynı hesapta başka modele geç — only when the
  account has a model-scoped pool · Durdur ve bana sor), ✎, and a MeterList from
  `accounts.candidateQuota` (before adoption) — while it loads or when it answers an error, one line
  "Limitler hesap eklenince okunur." (or the U-44 no-meter line); a pay-per-use row has the cap amount,
  the period Listbox (Aylık recommended) and ✎, with "Tavanın %80'ine gelince haber veririm; tavana
  ulaşınca yeni işleri durdururum, çalışanı kesmem." **Kurulumu bitir** adopts and saves as U-35 says,
  then closes the wizard and opens **Anasayfa** directly (no completion moment, no attach form) with
  one toast "Kurulum tamamlandı · n hesap hazır"; with no project yet, Anasayfa shows a dashed start
  card "İlk projeni ekle" with "Yeni proje" (U-40's page) and "Var olan projeyi bağla". "Bu adımı
  atla" appears only on Bütçe (finishes with the recommended values).
- **U-43** (Settings in the wizard's language; amends U-28, U-30, U-33, U-34; added 2026-10-04,
  #750) Settings is the same Window with a menu instead of steps — Çalışma: Hesaplar · Roller ·
  Yetenekler · Sağlayıcılar; Uygulama: Görünüm · Telefon · Güncelleme — and a × in the head.
  **Hesaplar**: the same AccountGroups over `settings.accounts` (no selection circle), "Yeniden tara",
  Test et per U-39, ✎, and below a "Eklenmemiş · n hesap" group of candidates with an "Ekle" button
  (`account.adopt`); the menu row keeps its amber dot while it is non-empty. **Roller**: "Asistan
  sırası" as the same DragOrderList (replaces U-33's ↑/↓ buttons), then one SettingRow per role with a
  Listbox Hızlı · Dengeli · Özenli (recommended per U-33). **Görünüm**: the same two SettingRows as Hoş
  geldin (replaces U-28's segment controls). **Sağlayıcılar**: U-38's rows inside the same card style.
  **Yetenekler**: one dashed empty state "Yetenek keşfi hazırlanıyor" until #715. **AccountEditor**
  (replaces U-30's sizes): a centred dialog 820×600 (max 100% of the window) with a head (mark,
  "Asistan · hesap", `displayPath · host` mono, billing tag, status, ×), vertical tabs on the left —
  Genel (Ad field; Model Listbox, "Asistanın varsayılanı" recommended; the account facts as a
  definition list), Kullanım (MeterList, "Son okuma … · Yenile" issuing `quota.refresh`), Limitler
  ("Limit dolunca" as radio cards with one sentence each — the same options as the wizard Listbox;
  "Kendi kullanımın için ayır" Listbox Yok · %10 · %20 · %30; the spend cap only on an account whose
  billing view is not `included` or that has consents), Modeller (U-32's three groups — Plana dahil,
  Kullanım başına ücretli with an "İzin ver" switch, Doğrulanamadı — each model in exactly the group
  its resolved billing says; a model made `included` by an allowance pool says why, e.g. "haftalık
  limiti olduğu için planda") — and a footer (in the wizard "Değişiklikler kurulum bitince
  kaydedilir." · Vazgeç · Kaydet; in Settings saving per U-29). Esc or a click outside closes it.
- **U-44** (meter list; amends U-31; added 2026-10-04, #750) A MeterList shows one row per meter:
  the meter's label (the provider's own window name: "5 saatlik", "Haftalık", …) with a scope tag —
  "tüm modeller" for a pool that applies to all while another pool of the same account is
  model-scoped, "yalnız <model>" (info tone) for a model-scoped pool —, the bar (remaining from the
  left; amber under 40 %; the U-31 reserve zone when set), "%r kalan", and "<reset> sonra
  sıfırlanır" (or the unit fraction first, e.g. "120 / 300 ·"). When the account has a model-scoped
  pool, one note follows: "<model> limiti dolarsa bu hesapta yalnız <model> durur; diğer modeller
  çalışmaya devam eder." No meter: "Bu asistan kullanım bilgisi vermiyor; limit dolunca hatadan
  anlarız." (needs login: "Giriş yapılınca limitler görünür."). The list re-renders on
  `accounts.changed`.
- **U-44a** (amends U-42 and U-43, 2026-10-04, review of #757) A pay-per-use or unknown-billing row
  in the wizard's Bütçe carries an explicit consent control ("İzin ver" / "İzinli") next to its cap —
  U-35's gate (consent with a cap before "Kurulumu bitir") stays. The AccountEditor's Genel tab has no
  Model choice until a contract stores an account's model; the wizard's editor has no Modeller tab (a
  candidate's models are unknown before adoption). Anasayfa's "Var olan projeyi bağla" opens the U-40
  page (its "Var olan klasör" card is the default). U-35's completion moment and inline attach form
  and U-40's wizard entry are superseded by U-42: the wizard ends on Anasayfa.
- **U-45** (amends U-42 and U-43; 2026-10-04, #759; approved prototype `docket-tasarim/kurulum-v3/index.html` →
  accounts()) AccountGroups splits the visible accounts into two collapsible sections, in the wizard's Hesaplar
  step and in Settings → Hesaplar alike: **Bulunanlar** (status ready) and **Hatalı ve bulunamayanlar** (needs
  login or Doğrulanamadı). Each header is a button with `aria-expanded` and `aria-controls`, a turning chevron,
  the name and "n hesap"; Enter and Space toggle it. Bulunanlar starts open, Hatalı ve bulunamayanlar starts
  closed and, while closed, shows a summary after its count ("n giriş gerekli · m doğrulanamadı", each part
  omitted at zero, with the status lamp colours). The open state lives in the screen's state: it survives
  "Yeniden tara" and re-renders, not a reload. An empty section is not drawn. Inside a section the
  per-assistant groups, rows, selection, ✎ and Test et are unchanged (U-42, U-43); the rows of a closed
  section are hidden and not focusable. The toolbar label "Bulunanlar · n hesap · m asistan" becomes
  "Taranan · n hesap · m asistan" (EN "Scanned"; section names EN "Found" and "Failed or not found").
  Settings' "Eklenmemiş" list stays as it is. Out of scope: a row for an assistant that is not installed.
- **U-45a** (amends U-45; 2026-10-04, review of #761) Only a needs-login or Doğrulanamadı row sits in
  Hatalı ve bulunamayanlar. Every other visible row — ready, Rezervde (reserve reached), Veri yok (no meter
  reading) and any later status that still works — stays in Bulunanlar, and an installed assistant's empty
  card stays there too. The closed summary counts only the two failing standings.
- **U-46** (window sizes; amends U-42, U-43; 2026-10-04, #766; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) The setup wizard and Settings share one window: 1040×680 at most,
  `max-width: calc(100vw - 48px)`, `max-height: calc(100vh - 96px)`; on a narrow window the existing
  single-column layout applies. The AccountEditor dialog (U-43) stays 820×600 at most, so an editor is
  always visibly smaller than the window it opens over.
- **U-47** (DragOrderList motion; amends U-41, U-42; 2026-10-04, #767; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) DragOrderList (wizard Asistan sırası and Settings → Roller) uses
  pointer events with pointer capture, not the HTML5 drag API. The held row lifts (shadow, scale 1.01,
  amber outline) and follows the pointer; the other rows slide to open the gap (FLIP, 160 ms ease-out); on
  release the row settles (140 ms); the list scrolls itself near its edge; text is not selected during a
  drag; touch works (`touch-action: none` only on the grip). Alt+↑/Alt+↓ moves a row with the same slide
  and the "n. sıraya taşındı" announcement (U-41). Under `prefers-reduced-motion` there is no motion: the
  order changes at once.
- **U-48** (compact Bütçe; amends U-42, U-44a; 2026-10-04, #766; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) Each account is one compact row in the wizard's Bütçe: mark, name,
  billing tag, one summary line ("Limit dolunca bekler · rezerv yok", "Tavan $50 · izinli") and an "Ayrıntı"
  button (`aria-expanded`) that opens the row's controls in place — limit-full choice, reserve, cap, ✎ and a
  Max account's three limit lines — one row open at a time; all rows start closed. A pay-per-use or
  unknown-billing row always shows its consent control and cap field in the row (U-44a; U-35's gate stays).
  A line above the groups says "Önerilen ayarlar uygulandı — değiştirmek istersen satırı aç.". The two
  billing groups (Abonelikler, Kullandıkça öde ya da ücreti bilinmeyen) keep their headers.
- **U-49** (finishing progress; amends U-42, U-44a; 2026-10-04, #766; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) "Kurulumu bitir" turns into a spinner button "Kuruluyor…" and the
  window body into a four-line progress list — "Hesaplar kaydediliyor", "Sıra kaydediliyor", "Bütçe
  uygulanıyor", "Anasayfa hazırlanıyor" — each line going from a spinner to a drawn check as its real step
  completes (never a fixed delay); Geri and the step buttons are disabled meanwhile; on completion the
  window fades to Anasayfa and the U-50 toast reads "Kurulum tamamlandı · n hesap hazır". A failing step
  stops the list on that line with its reason and a "Tekrar dene" button. Under `prefers-reduced-motion`
  the lines change without animation, in the same order.
- **U-50** (ToastHost; amends U-8; 2026-10-04, #768; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) Every toast in the app — command results (U-8), wizard completion,
  new project and any other — goes through one component and one call, `toast({ type, text })` with `type`
  one of success, info, warn, error, rendered by one ToastHost at the top right (16 px from the edges),
  stacked, at most three visible. A toast slides in from the right, dismisses itself after 5 s (warn and
  error 8 s) with a thin progress line, pauses while hovered or focused, and has a close button. `aria-live`
  is polite, assertive for error. Only existing colour tokens. No screen draws its own toast.
- **U-50a** (amends U-50 and U-8; 2026-10-04, review of #771) `ToastInput` has an optional `copy` text. A
  toast that carries it shows a "Kodu kopyala" button (it copies that text and says so by changing to
  "Kopyalandı" for two seconds) so U-8's "the code itself is available for copying" holds: a command result
  with `ok: false` toasts as `error` with the code's label as its text and the code as `copy`; an unknown
  code shows the generic failure text with the raw code only behind "Kodu kopyala", never in the text. A
  toast with a copy button does not dismiss itself while the pointer or focus is on it (U-50) and, being
  an error, stays 8 s.
- **U-51** (sidebar; amends U-16 and U-44; 2026-10-04, #774; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) The sidebar is 264 px wide; section headers (Projeler, Hesaplar) are 14
  px/700, rows 13.5–14 px, helper text at least 12 px. The Hesaplar section has a collapsible header (chevron,
  count) and, once under it, one dim line "Çubuk en dar limiti gösterir.". Every account card has the same fixed
  height (56 px) whatever its number of limits: row one is the provider mark, the account's name only (ellipsis
  when long; the full "Asistan · ad" in the `title` and the popover) and a status dot; row two is one bar for the
  account's tightest limit with its percent on the right, no per-card limit label; an account without limit data
  shows a dim "Limit bilgisi yok" in that row instead. The bar and dot colour by what remains: 40 % or more
  proceed (green), 15–40 % amber, under 15 % red. Click or Enter opens a popover listing every limit with its name
  and reset time and marking the tightest; Esc closes it and the focus stays on the card. Five accounts show at
  first; the rest sit behind a "+n hesap daha" button (`aria-expanded`, "Daha az göster" when open) and the open
  list scrolls inside the section. With no project, Projeler shows a centred dashed box (`rounded-card`) with a
  folder icon, the line "Projelerin burada görünecek." and a secondary "Yeni proje" button that opens the U-40
  page — the text "Henüz proje yok." is gone.
- **U-52** (scanning state; amends U-42 and U-43; 2026-10-04, #775; approved prototype
  `docket-tasarim/kurulum-v3/index.html`) Arriving on the wizard's Hesaplar step, and pressing "Yeniden tara",
  shows six skeleton assistant groups (mark, dimmed name, one or two shimmering placeholder rows, about the size
  of the real groups) under the toolbar line "Asistanlar ve hesaplar taranıyor…" with a thin indeterminate
  progress line — never a percentage or a counter, because discovery reports none. The toolbar count reads
  "Taranan · —" and the button "Taranıyor…" (spinning icon, disabled) until the scan ends. The skeleton stays at
  least 400 ms; the groups then appear in order, 40 ms apart, each fading in over 160 ms with an 8 px rise. The
  container has `aria-busy` while scanning and the end announces "n hesap bulundu" politely. Settings → Hesaplar
  uses the same component. Under `prefers-reduced-motion` there is no shimmer or rise: a static dim skeleton and
  an immediate swap.
- **U-51a** (amends U-51 and U-16; 2026-10-05, review of #779) The popover a sidebar account card opens ends with
  a "Hesabı aç" button that opens that account's view (the page U-16's card click used to open), so the sidebar
  keeps a one-step way into the account; the card itself opens only the popover. Esc closes the popover and
  the focus stays on the card.
- **U-51b** (amends U-51; restores U-16's visible count; 2026-10-05, review of #779) The Hesaplar section shows two
  account cards at a time with the top of a third peeking beneath them, and the rest scroll inside the section:
  there is no "+n hesap daha" or "Daha az göster" button. U-51's "five accounts show at first … sit behind a button"
  is superseded. The section starts collapsed (U-16) and its body keeps the cards' height equal (U-51); the scroll
  area has no horizontal overflow.
- **U-34** (discovered accounts) The candidates (`accounts.candidates`) and the discovered
  providers appear in the wizard's Hesaplar step and under Settings → Hesaplar → "Eklenmemiş":
  a row per candidate with mark, label, status and selection. `unreadable` disables the row with
  its reason; `env_overrides_login` shows its warning tag with an ⓘ; `alreadyAdded` candidates are
  not listed. A candidate whose `envOverrides` holds `token` shows, once selected, a separate card
  "Erişim anahtarını Anahtar Zinciri'ne taşı" with a switch that starts **off**; while off the row
  reads "Anahtar gerekli" and `account.adopt` is sent without `importToken`; the value is never
  shown, masked or otherwise. A provider that needs a login says so with its name ("Terminalde <ad> ile giriş
  yap, sonra yeniden tara") and offers "Yeniden tara"; a provider not found on the machine shows
  its `installUrl` (A-67) as copyable text — Docket runs no install itself and never invents a
  command. A candidate's mark comes from its `provider` (A-67).
- **U-35** (setup wizard; replaces U-7) The rev 28.1 flow: Hoş geldin (Dil, Tema) → Hesaplar
  (U-34, ✎ opens the U-30 window; gate: at least one ready account selected) → Yetenekler →
  Asistan sırası → Bütçe → the "Kurulum tamam" moment (rail all ✓, one summary line, "Proje
  bağla", which opens an inline attach form in the same window: the project folder as a path
  field and "Bağla" issuing `project.attach`; success closes the wizard and opens the project's default
  view (K-4:B), a failure shows its U-8 label under the field; creating a project from the built-in
  library is #370's). An account row reads "<provider name> · <account label>" (A-67 `name`;
  the label derives from the config folder), as rev 28.1 shows it; providers that can be installed fold
  into a closed "Kurulabilir (n)" group under the found ones. A step with nothing to decide is skipped and shown
  with "–" in the rail: Asistan sırası with fewer than two accounts, Yetenekler while no
  capability source is composed or none was found. Footer slots are fixed (Geri · Bu adımı atla
  left; reason line · primary right). Bütçe lists the selected accounts in two groups —
  Abonelikler (mini bars, policy and reserve summary, the U-29 diff count, ✎) and Kullandıkça öde
  (spend against the cap, ✎); a pay-per-use account needs its explicit spend consent with a cap in
  this step (the U-32 card) before "Kurulumu bitir" is enabled. Finishing adopts or saves every
  selected account with its draft, writes caps and consents, and issues `binding.save` for every
  `roles.list` role with the chain and the role's recommended work style; the wizard does not
  reappear while a project exists. `back` keeps every entry.
- **U-36** (theme) Tema is Sistem · Koyu · Açık, persisted per viewer in local storage
  (`docket.theme.v1`, a corrupt value reads as Sistem); Sistem follows `prefers-color-scheme` live;
  the choice sets `data-theme` on the root, which the tokens already read.
- **U-37** (links between surfaces) The accounts frame (U-16) marks a card "rezervde" when any
  of its meters reached its reserve (U-31), and, while discovery holds an account not yet added,
  ends with one row "n hesap eklenmedi · Gör ›" opening Settings → Hesaplar. The account view's
  "Ayarlar'da düzenle" (U-20) opens Settings on that account's sub-page, Limitler tab, and its
  limit band reads the policy and the reserve in one sentence. A role chip on the account's Genel
  tab opens that role's sub-page.

Deferred: a "Docket AI'a sor" entry in the editor and in Roller, answering with a Proposal card
(eski → yeni, Vazgeç / Uygula; invariant 5), lands with the chat surface (Phase 6); account test
("Test et") and capability import land with their own contracts. (2026-10-03: account test → U-39.)

### Prototype vs rules (2026-09-29)

Where the rev-7 prototype and U-15 … U-21 disagree, the rules win and the prototype is corrected:
the main-repo ★ row opens the board, not the roadmap (U-15); a single-repo board header carries
"Yol haritası ↗" (U-15); a cross-repo task expands to its per-repo work orders (U-17); the account
view shows the limit policy read-only with ⓘ (U-20); Son kapananlar lists five (U-21); copy says
proje / repo, never çalışma alanı (the Workspace→Repo rename).

## Width — proportional scale and full sections (U-53 … U-56)

Visual source: the operator-approved width prototype `~/source/docket-tasarim/genislik/index.html`
(2026-10-05), validated in twelve conditions — the four data screens (cockpit, account view,
work-order detail, roadmap) at 1280, 1920 and 2560, in both themes — with every section at 100 %
fill, a 0 px right gap and no console or page error; the fill was measured at the unscaled raw size.
The wave exists because the measured app left the wide window empty (the 2026-10-05 responsive
report): the account view and the roadmap filled 42.6 % of the main area at 2560, the cockpit
53.6 % (74.8 % already at 1920), the detail 56.8 % — every route but the board sat under a fixed
`max-w` pinned left, and the cockpit's one wide breakpoint bound the viewport, not the main
container.

- **U-53** (proportional scale; amends U-51's fixed 264 px; added 2026-10-05, #793; approved
  prototype `docket-tasarim/genislik/index.html`) The interface grows proportionally with the
  window. Every dimension on the data screens and the sidebar is expressed in rem — px survives
  only where a hairline must stay a hairline (1px rules, icon hit areas) — and the scale is one
  rule on the root, in CSS, never a JS measurement: `html { font-size: clamp(100%, calc(100% +
  (100vw - 1440px) * 0.0223), 125%) }` (16 px base, breakpoint 1440, clamped 100–125 %; the
  prototype computed the same formula in JS only because it frames one window inside a page). The
  anchors the prototype measured: a 0.8125rem body text reads 13 px at 1280 and 16.25 px at 2560,
  the page h1 (1.25rem) 20 → 25 px, the sidebar's 16.5rem 264 → 330 px. No screen or component
  overrides the root font-size; a test pins the clamp expression and the no-override rule.
- **U-54** (full sections; added 2026-10-05, #793) The four data screens fill the main area: no
  `max-w-*` on their page wrappers or top-level sections, a fixed rem padding at the edges, the
  content left-aligned (L-10 unchanged). Deliberately narrow surfaces stay narrow — the search
  palette, the Settings/wizard window (U-46), the AccountEditor dialog (U-43), the centred Yeni
  proje page (U-40), empty-state cards — and reading text inside a full-width card keeps its
  measure at most 62ch. Moving any of those to full width is its own decision, never a rider on a
  PR that lands this rule.
- **U-55** (columnation on the main container; added 2026-10-05, #793) A width threshold binds to
  the `main` element's container (`@container`), never to the viewport — the cockpit's
  viewport-bound `min-[1500px]` column jump, and its skeleton's mirror, is the trap this replaces.
  The thresholds, in CSS px against the main container: below 900 one column, at ≥900 two, at
  ≥1500 three; the detail's live pane is the fixed 22.5rem second column from ≥900, and its
  runs-and-audit third column (21.25rem) arrives at ≥1700. A card grid fills its row with
  `repeat(auto-fill, minmax(min, 1fr))`, the minimum in rem (21.25rem row cards, 22rem project
  cards, 23.75rem roadmap phases), so a full row spans edge to edge at every width.
- **U-56** (sparse row → side panel; added 2026-10-05, #793) A row whose items all fit on one
  line keeps its cards at their natural minimum on the left and gives the leftover width to a
  `1fr` side panel: the cockpit's attention and runners rows take "Son kapananlar" and "Sırada" as
  their panels, and the account view is the fixed three-column composition Kullanım |
  Harcama+Bağlantı | Son koşular, which leaves no orphan column. The panel exists only while the
  row's items fit on one line with room to spare — in the validated world the widest class;
  narrower, the cards fill the row themselves. CSS cannot count elements, so the product binds
  this decision structurally — one pure helper (item count, container width, minimum card →
  column count and panel on/off) or, where the composition is fixed anyway, that width class's
  fixed composition — never a per-screen hand-tuned grid.

### Constraints and follow-ups (the prototype's known limits)

- "Few items → side panel" cannot be expressed in CSS; the prototype computes it in JS on every
  resize. The product must bind it structurally (U-56's helper or fixed composition) together
  with the screens — a sparse row whose cards silently stretch wide is the failure mode the rule
  exists to prevent.
- The U-55 thresholds are CSS px against `main` while every size rides U-53's rem scale, so a
  threshold's design-effective point drifts as the scale grows (a 1500 px container buys fewer rem
  at 125 %). Validated at 1280/1920/2560 only; the audit's 1024/1152 windows sit at the clamped
  low end. A threshold that proves wrong at an intermediate width is a follow-up that re-validates
  all three widths, not a per-screen nudge inside a PR.
- Fill is measured with animations disabled (`prefers-reduced-motion`): a moving element's
  bounding box corrupts the reading — the prototype's first measurement round read the cockpit's
  scan bar as %102 fill. L-5a's measurement takes the same precaution.
- The prototype loads its type faces from Google's CDN and falls back to system faces offline; the
  product already bundles them (`@fontsource` in `src/index.css`), so there is nothing to port —
  do not add a CDN dependency for this wave.
- The px-fixed surfaces inside the scaled app — U-46's wizard/Settings window (1040×680), U-43's
  AccountEditor (820×600), U-40's card (880×580), the palette's 560 px, the title bar's 28 px
  controls — do not grow with U-53's scale while their interiors do (at 125 % the interior grows
  25 % inside the same frame). Whether each moves to rem is the architect's follow-up decision,
  issue by issue; the width wave must not rewrite them silently.

## Verifying the shell — E2E layers (Phase 3.5)

The shell is verified against the frozen prototype **rev 8** (`~/source/docket-tasarim/rev8/`:
`index.html` + reference screenshots). Every check below drives the **built Electron app** through
Playwright's Electron mode, the same way `e2e/ui.mjs` does: launch, click, read the DOM. There is no
browser-only harness and no second transport. Maestro is out of scope for the desktop app; it
belongs to the mobile app.

| Layer | File | Runs | Blocks merge |
| --- | --- | --- | --- |
| Store rules U-15 … U-21, U-23 … U-25 | `src/presentation/**/*.test.ts` | `npm test` (CI) | yes |
| Journeys | `e2e/journeys.mjs` | `npm run test:journeys` (local, after build) | yes (PR evidence) |
| Layout audit L-1 … L-13 | `e2e/layout-audit.mjs` | `npm run test:layout` (local, after build) | yes (PR evidence) |
| Gallery | `e2e/gallery.mjs` → `e2e/.out/gallery/index.html` | with the two above | no (operator's eyes) |
| Operator scenario | PR body | operator | yes (`main` gate) |

- **Seed.** `e2e/seed-design.ts` writes a throwaway data dir holding exactly the prototype's world:
  projects Antero (7 repos, main `antreo-docs`), Docket (2), date-app (3), telerelay (1), Kadife
  Odoo (1); the prototype's work orders by code, stage and state; two accounts with 5-hour, weekly
  and monthly windows. The same codes appear in the same place on every screen. It never touches the
  operator's data.
- **Window sizes.** Journeys and the audit run at 1024×640 (the minimum), 1152×720 (the
  default window) and the primary display's work area (full screen — read at run time from the
  Electron main process, so the window is exactly as large as the real screen and never spills
  off it). By default a run walks **four combinations**: dark at all three sizes, plus light at
  the default window (the size the operator uses). `--full` — or `FULL=1` on the wrapping npm
  script — restores the complete 3 × 2 matrix, every size in both themes, for a release run or
  after a token/theme change; `journeys --quick` stays the default window in dark alone. The sidebar is
  always open, never collapses. The harness resizes the `BrowserWindow`; it does not scale the page
  itself — under U-53 the page scales with the window through its own root clamp, and the audit's
  readings are the page's own CSS px.
- **Journeys** (one `test` each, named `J-n: …`): J-1 cockpit → answer a permission ask inline →
  the item leaves Senden bekleyenler · J-2 tree → repo row → board; Kanban ⇄ Liste survives reload ·
  J-3 card → in-place detail → approve → ‹ Geri returns with view state intact · J-4 project row →
  roadmap → expand a cross-repo task → its work order opens the detail · J-5 single-repo project →
  board → "Yol haritası ↗" · J-6 account card → account view → "Ayarlar'da düzenle ↗" opens
  Settings, and the nav's Telefon and Ayarlar rows open it on their own sections · J-7 ⌘K (or the
  sidebar's Ara row) opens the search palette and focuses its input · J-8 cockpit → open a project →
  back → forward (the bar's chevrons, ⌘[/⌘], dimmed at the ends; the palette owns its keys), and the
  detail's ‹ Geri rides the same history. Each step asserts visible text and saves a screenshot.
- **Layout audit** (pure DOM measurement, no pixel diff; each assertion named `L-n: …`, for every
  screen × size × theme):
  - **L-1** The sidebar's left edge is 0 and its width is 240px at every window size — it never
    narrows — identical (±0.5px) on every screen.
  - **L-1a** (amends L-1; 2026-10-05, U-51) the sidebar is 264 px wide, not 240.
  - **L-1b** (amends L-1a; 2026-10-05, U-53) the sidebar is 16.5 rem at the live scale — 264 px
    at 100 %, 330 px at 125 % — so its pixel width follows the root clamp instead of a fixed
    number; the never-narrows and identical-on-every-screen readings of L-1 stay.
  - **L-2** No page-level horizontal scroll: `documentElement.scrollWidth <= innerWidth`.
  - **L-3** Every visible button, link and input lies fully inside the window and inside its nearest
    clipping ancestor, except inside the declared Kanban scroller; inside the Settings window's content
    pane (`[data-settings-content]`, a vertical scroller) only sideways escape counts.
  - **L-4** Text whose `scrollWidth` exceeds its `clientWidth` by more than 1px uses
    `text-overflow: ellipsis` and carries its full text in `title`.
  - **L-5** The main column's content width is at most 1200px (cockpit), 1280px (detail) or 960px
    (roadmap, account); the board uses the full main width.
  - **L-5a** (amends L-5; 2026-10-05, U-54) the four data screens fill the main column instead:
    every top-level section's right edge sits within 8 px of the main column's content-box right
    edge at every audited size and theme, measured with animations disabled
    (`prefers-reduced-motion` — a moving element's box corrupts the reading). L-5's caps are
    superseded for these screens; a deliberately narrow surface (U-54's list) keeps its own cap
    and is asserted against it.
  - **L-6** The accounts frame is never collapsed: at the 1024×640 minimum its body stays visible
    under its header.
  - **L-7** When the detail's main width is below 900 the live pane sits below the "bu aşamada
    senden beklenen" section.
  - **L-8** When Kanban columns overflow, the scroller has scroll-snap and shows the edge fade.
  - **L-9** At the full-screen size the cockpit's "Son kapananlar" heading starts inside the
    first screen; the smaller windows accept it below the fold and report the rule as not
    applicable.
  - **L-10** Every screen's content wrapper starts at the main column's left padding edge — its
    left edge sits within 1px of it at every size, never centred inside the column.
  - **L-11** Every Kanban card spans its column header's width — its left and right edges sit
    within 1px of the header row's at every size and theme.
  - **L-13** No audited screen shows a problem state: no visible text equals an `error.*` label
    (keyed off the app's own label bundles, both locales) — a failing row names the screen and the
    text. A screen whose cause sits in a file under interactive redesign may carry a named,
    temporary known-standing in `e2e/layout-rules.mjs`, removed when that redesign lands.
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
