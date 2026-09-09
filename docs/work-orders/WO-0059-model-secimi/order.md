---
id: WO-0059
title: "Model selection — the global model preference (adapter-minted presets · free-text id · spawn-time wiring · empty = provider default)"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0059 — Model selection — the global model preference (adapter-minted presets · free-text id · spawn-time wiring · empty = provider default)

## Objective

The SDK accepts a per-session model (`Options.model`), but Docket never sets one: every drive runs
on the provider's default, and the operator has no way to choose. This WO adds ONE operator
preference — a global `model` row in `app_setting` (the provider-key posture: both hosts see it) —
surfaced in `AppSettingsModal` as a mono free-text input plus preset id chips minted ADAPTER-side
and carried as data (ADR-0006's WO-0052 carve-out: a model id is data, never a constant, branch or
predicate outside `src/adapters/`). The composition root reads the preference at SPAWN time and
puts it on the drive input (the `permissionRule` precedent); the adapter maps it verbatim to
`Options.model`. Empty = no `Options.model` = the provider default. No mid-session model change
(`Query.setModel` stays unused), no per-workspace scoping.

## Context

- **Decisions locked with the operator 2026-08-30 (the approved session plan):** preset chips +
  free text; empty = SDK default; spawn-time resolution; limit/running appbar chip is the sibling
  WO-0060 (separate session).
- **CORRECTION (operator, 2026-08-31 — the first checkpoint round):** the model preference is
  PER-ROLE, not one global value — the operator's own words: the PLAN rides the best model while
  implementation (Sonnet/Opus-class work) rides a simpler one. The preference axis is the
  SESSION ROLE (architect / implementer / verifier — the draft arm is an architect session and
  inherits the architect's row). The single-global first cut is replaced. The SAME round moved
  the settings surface itself: the modal grew crowded (auth, model, permission, language, theme,
  budget, docs-root in one column) — a REAL settings screen with TABS, consolidated.
- **CORRECTION 2 (operator, 2026-08-31 — the second checkpoint round):** the tabbed cut was
  REJECTED on design grounds ("hiç güzel değil… her şey kötü, kullanışsız") — redesigned with the
  frontend-design pass + the ui-ux-designer critique: TABS GONE (one scroll, `readout`-headed
  sections, `wide` dialog, version in the footer's left slot) and the model block rebuilt as an
  ASSIGNMENT MATRIX — preset ids are column heads (each id ONCE), role rows carry their
  `rlamp` + role hue, a pressed cell shows ● (the karar-deposu marker idiom), an `özel` column
  holds the verbatim custom id; >4 presets or an empty set degrades to full-width role rows. The
  raw auth-source id (`Hazır (handshake)`) no longer renders — known sources get a word
  (`providerSourceLabel`), unknown sources render nothing.
- **CORRECTION 3 (operator, 2026-09-09 — the settings-from-scratch round; four mockup tours
  `docs/ui-mockups/ayarlar-sold-menu.html`, rev 5→8, all rulings dated that day):**
  1. **The settings surface is a LEFT MENU + right content pane** (the operator's own direction,
     replacing CORRECTION 2's one-scroll cut): an 880px dialog, a 200px sunken menu rail
     (`bg` ground + one vertical hairline; active item raised + ink), ONE section's content at
     the right. Rev 2's tab ban was about TOP TABS — the vertical menu is the operator's own
     ruling and supersedes it.
  2. **The menu has TWO items: `Modeller` · `Genel`** — bare single-line names (13px, sentence
     case; the rev-6 mono status readouts under menu items were removed at tour 4: "title
     yeterli"). Section titles inside the content are sentence case, normal size.
  3. **The SAĞLAYICI section DIES.** The stored-API-key concept is removed end to end: the UI
     section, the port methods (`getProviderKey`/`setProviderKey`), the IPC pair, the spawn-time
     env injection, and the stored row (one-time cleanup). The CLI's own login + the operator's
     setup are the identity; Docket shows only PRESENCE: **`Claude Code · Hazır` /
     `Bulunamadı` + `Doğrula`** as the FIRST line of Genel (`checkProvider` with no key —
     spawn-free account read; the three states update in place). The menu is the operator's own
     summary: "claude code varlığını ve çalıştığını göstermek yeterli".
  4. **The ÇALIŞMA ALANI section MOVES to the workspace's Düzenle dialog** (structure root +
     monthly budget — per-workspace facts that never belonged in global settings). Global
     settings keep only truly global things.
  5. **The preset set is a CLOSED ENUM of ALIAS TIERS, ordered worst→best: `Default · haiku ·
     sonnet · opus`** (Default first = "leave it to the setup", not a power tier). `modelOptions()`
     returns `['haiku','sonnet','opus']`. The rev-1-3 matrix, its `özel` free-text column, and
     the preset full ids (`claude-*`) are replaced. SDK-verified (2026-09-09): `Options.model` is
     "Claude model alias or full model name"; alias resolution is the setup's own business
     (`ANTHROPIC_DEFAULT_*_MODEL`) — the tier name rides verbatim, the endpoint resolves. A
     custom full id remains SDK-possible; the UI cell returns as a small addition if ever needed.
  6. **Segments write INSTANTLY** (the dil/tema segment behavior — a closed enum commits on
     click); no Kaydet, no draft, no text field — the whole modal is buttons. Copy is PLAIN
     TURKISH, no internal jargon ("gateway" never renders): the one informative lines are
     «Kademe adları kurulumundaki modellere eşlenir.» and «✦ taslak sürüşü Mimar satırını
     izler.».
  7. **The permission-rule control (izin kuralı) stays in Genel** — it lived there in rev 1-3;
     the mockup's enumeration omitted it, dropping a live setting would be a regression. Same
     for the locale + theme segments.
  8. **Docket's own CLI (`src/cli/`) STAYS** — the assistant's headless test surface, never a
     product surface (the operator: "sadece senin için kalsın"); recorded as one line in
     CLAUDE.md, not code change.
  - **Session-role label:** the app's locked vocabulary is `Doğrulayıcı` (ROLE_LABELS); the
    mockup's "Denetçi" yields to it (ADR-0007: one word per concept).
- **The singleton runner is a non-problem:** `createRunner(...)` (electron/main.ts) receives only
  env; `Options` is rebuilt per drive inside `runDrive` from the input — so the model must ride the
  per-drive input. `RunnerOptions` is untouched.
- **Precedents:** the settings port + KV row + IPC pair + preload bridge + modal section chain
  (`provider_key`, `permission_rule`, `locale` — bare keys; `budget:<wsId>`/`docs_root:<wsId>` are
  the per-workspace variants we deliberately do NOT follow here); the main-resolved drive field
  (`cwd`/`permissionRule` — the renderer never sends it); the draft-text settings posture
  (budget/docs-root sections — a value is a draft, never a mid-keystroke write); verbatim mono id
  rendering as row DATA (`UsageBreakdownCard`'s `{b.model}`).
- **Model ids already cross as data today:** `session_usage.model` / `model_usage` rows (WO-0052),
  the usage screen's MODELLER buckets — a stored preference rides the same ruling; the real proof
  of a drive honoring it is the provider's own per-model split on the usage screen.

## Scope

In scope:

- Core (test-first): `AppSettings` gains `getModel()/setModel(model | undefined clears)` and
  `modelOptions(): Promise<string[]>` (adapter-minted presets; `[]` → the chip row renders ABSENT,
  ADR-0001; the free-text field is unaffected). `WoDriveInput` and `DraftDriveInput` gain
  `model?: string` (main-resolved, not a discriminant; drafts are drives — the global preference
  applies to them too).
- Adapter: `modelOptions()` export (the only file in `src/` that may name ids, with the carve-out
  comment); `if (input.model) options.model = input.model;` in `runDrive`'s options — alias or full
  id, verbatim, no default invented adapter-side.
- Store: bare key `'model'` in `app_setting`; read = trim, empty/absent → `undefined`; write =
  `DELETE` on undefined/blank else `INSERT OR REPLACE` (trimmed). No schema change.
- Composition root: `docket:settings:get-model` / `set-model` / `model-options` IPC pairs; the
  `docket:runner:drive` handler reads `store.getModel()` and spreads `...(model ? { model } : {})`
  — spawn-time, so a mid-life change hits the next drive, never a running one. Preload bridge gains
  the three methods (`preload.d.ts` needs nothing — it types `settings` as `AppSettings`).
  An e2e-only channel may record the resolved drive input (the `docket:e2e:pick-files` pattern) so
  the main-side fill is provable without a real key.
- UI: one `data-model-section` in `AppSettingsModal` right after the auth-status section, OUTSIDE
  the `workspaceId` guards; mono `Input` + preset chips that FILL the draft (`.ichip` buttons,
  `aria-pressed`, the `data-review-mode` chip shape) + `Kaydet` (writes `trim() || undefined`,
  re-reads) + `Kaldır` (only when stored); ONE hint line when unset; no `aria-required`, no error
  state (the provider validates ids). Labels `modelLabel` / `modelPlaceholder` / `modelDefaultHint`
  in BOTH bundles; button words reuse `woEditSave`/`budgetClear`.
- E2E: the settings section spec (chips count, fill, save/reopen round-trip, clear); the
  last-input assertion if the e2e channel landed. Screenshots per state into the WO folder.
- Docs: ROADMAP tick at closure; the verbatim-id DATA ruling recorded here (this order).

Out of scope:

- Mid-session `Query.setModel` (the adapter gains no call site); per-workspace or per-drive model
  scoping; per-role models; a model catalog maintained anywhere but the adapter; any validation of
  id format in core/ui; changes to `RunnerOptions`; fallbackModel / effort levels / adaptive
  thinking (unread SDK surface).

## Acceptance criteria

1. With a model stored, a spawned drive's adapter `Options` carries `model` verbatim; with none
   stored, `Options.model` is undefined — no default fabricated at any layer (unit-pinned both ways).
2. The preference survives an app restart (the DB row, not renderer state); `Kaldır` empties it;
   a blank value leaves no row.
3. The Settings section renders outside workspace guards (visible with no workspace), chips fill
   the draft and read pressed, an arbitrary id round-trips, and an empty `modelOptions()` renders
   the chips ABSENT — never greyed (ADR-0001); the field never locks on validity.
4. No model id literal, `startsWith`, membership test or `MODEL_*` constant exists outside
   `src/adapters/` (`check:boundaries` c1 green); the id renders verbatim in mono, never
   prettified, never `.replace(`d (ADR-0007 — the DATA ruling).
5. Every new word lives in both label bundles with key parity; display copy through `useLabels()`.
6. Full ladder green: typecheck (both tsconfigs), `npm test`, `check:boundaries`, build, E2E.

## Evidence required

- plan_approval: RESOLVED 2026-08-30 — the session plan (model + appbar chip) approved by the
  operator in plan mode; scope questions answered (global / chips+free-text / countdown+hover /
  limit-wins).
- operator_checkpoint: PENDING — the manual scenarios are presented (this order's Notes); the
  verdict gates the commit and every next chunk.
- ci: green at the working tree, 2026-09-09 (rev 4, post-review) — typecheck (both tsconfigs), 916
  unit tests (+1 store sweep; the tier-list pin retargeted; one date-rotted usage stamp fixed to
  the current month), `check:boundaries` clean, build clean, **E2E 97/97 green** (exit 0). The
  reviewer round caught the real cascade: the moved knob groups broke three dialogs-worth of stale
  spec surfaces (WO-0033's dialog-wide editor count, WO-0035/0040's opening-pane assumption,
  WO-0047/0049's settings-modal reads) — all rewired to the ws Düzenle dialog (`openWsEdit`
  targets the CURRENT workspace through Tümünü gör), and the ws-settings editor input gained a
  row-announcing `aria-label` (the path line's title div unmounts while editing — the old anchor
  deleted itself). Screenshots `settings-menu@980.png` / `settings-general@980.png` in this
  folder.
- pr_open: PENDING the operator verdict — the PR carries the "Model Used" line; the merge sha is
  recorded at closure.

## Stop-and-ask gates

- Any model id constant, alias table or capability predicate outside `src/adapters/` (ADR-0006).
- A per-workspace model key (`model:<wsId>`) or a per-drive picker (the operator ruled global).
- A mid-session model switch or a `RunnerOptions.model` (frozen-at-start posture is wrong).
- Validity enforcement, format hints beyond the one line, or a `disabled` attribute in `src/ui/`.
- Any change to `session_usage` semantics (model stays verbatim row DATA).

## Notes

- **Manual checkpoint rev 4 (the operator's minute-scale scenarios, `npm run dev`):**
  1. Ayarlar'ı aç → 880px dialog; SOLDA iki çıplak ad (Modeller · Genel), sağda Modeller içeriği.
     Sağlayıcı ve Çalışma alanı bölümleri YOK; dialogda tek metin alanı bile yok.
  2. Modeller: Mimar satırında `opus`'a tıkla → segment basılı, Kaydet düğmesi YOK (anlık yazım);
     dialogu kapat-aç → opus yerinde (satır, taslak değil).
  3. Genel: ilk satır `<ad> · Hazır/Bulunamadı` + `Doğrula` — bas, spinner satırın içine insin,
     sonuç yerinde. İzin kuralı + dil + tema segmentleri anlık uygulanır.
  4. Çalışma alanı değiştiriciden ⚙ (Düzenle) → «Yapı kökü ve bütçe» grupları burada; kaydet-turu
     eski davranışında (taşınma, kayıp yok).
  5. Gerçek sürüş: plan (mimar) → Kullanım ekranının MODELLER dökümünde mimarın kademesi
     görünür; uygulayıcı adımı onunkini taşır.
- The draft drive (✦) is an architect session: it inherits the architect's row — one map, all arms.
- The adapter mock in `runner/index.test.ts` now records its `Options` argument (a `lastOptions()`
  accessor) — previously discarded; the spawn shape was unobservable.
- The preset list is deliberately SHORT (the SDK's own three documented ids); the custom column is
  the escape hatch for everything else, so the catalog cannot go stale in a way that blocks
  anyone. An endpoint that aliases ids (a gateway's own naming) works the same — the id rides
  verbatim and the provider validates.
- The E2E carry proof rides `docket:e2e:last-drive-input` (a DOCKET_E2E-gated readback of the
  resolved input, main-side) — the spec caught two real constraints worth recording: the limit
  specs' sample WO carries a FUTURE stamp (its Sürdür stays locked — a locked button is
  unclickable, not absent), and a drive left running on an UNOPENED detail shows no Durdur at
  board level (the one-drive-at-a-time start lock is store-side, not button-side).
