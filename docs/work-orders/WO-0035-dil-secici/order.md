---
id: WO-0035
title: Dil seçici — en/tr label bundles, LocaleProvider, the settings selector
workspace: docket
status: draft
mode: plan
tracks:
  - repo: app
    depends_on: []
---

# WO-0035 — Dil seçici (en/tr label bundles, LocaleProvider, selector)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

The UI becomes bilingual: every display string ships as a per-locale bundle
(`src/ui/data/labels/{tr,en}.ts`, both satisfying one `Labels` type so a missing EN key is a compile
error), a `LocaleProvider`/`useLabels()` seam serves them (the `view-mode.tsx` precedent), and the
inert language Segmented in Settings becomes a real, instant, no-restart selector. The preference is
an operator property persisted in `app_setting` (ADR-0007's ruling); a fresh install with no stored
choice detects the system language (`navigator.language` tr-prefix → tr, else en — operator ruling
2026-08-21), detection stays renderer-side, and the DB stores only explicit choices. The order also
pays two standing debts: WO-0013's never-written ADR-0007 addendum recording `tr` as the live
locale, and CLAUDE.md's stale "UI copy is English" line.

## Context

- docs/adr/ADR-0007-localisation-and-theming.md — the ruling this order implements: "UI vocabulary
  is translatable. Domain data is not"; locales en/tr; preference in the app's own database, never
  workspace.yaml; repository documents stay English. WO-0013 promised the live-locale addendum; it
  was never written (this order pays it). The ADR's theming half is already dead (dark-only,
  ADR-0012) — the addendum notes, not re-decides.
- ROADMAP.md M3.5 — "Locale en/tr, keyed labels, en fallback, preference persisted (ADR-0007)".
  Deliberately pulled ahead of M3 by the operator (2026-08-21).
- src/ui/data/labels.ts — 713 lines, ~370 display strings (the 251-key `UI` object + 20 Records +
  15 composer functions); its header promises "en/tr seçici M3.5'te gelir". 33 consumer files, all
  under src/ui; zero display literals outside the module (comments excepted) — the seam is clean.
- src/ui/data/view-mode.tsx — the provider precedent: synchronous localStorage rehydration in the
  `useState` initializer, tolerant of storage failure.
- The persistence chain to extend, pattern-first: src/core/app-settings.ts (the operator-preferences
  port; `getProviderKey(): Promise<string | undefined>` is the "unset = undefined" precedent),
  src/adapters/store/index.ts (~595-600, ~984-997 — the permission-rule members), electron/main.ts
  (~210-219, the `docket:settings:*` channels), electron/preload.ts (~49-55; TD-036: preload arity
  is hand-maintained — main and preload change in one commit).
- src/ui/chrome/AppSettingsModal.tsx:75-87 — the inert language placeholder (`value="tr"`,
  no-op change handler); `UI.language/langTr/langEn` keys already exist.
- src/ui/chrome/ErrorBoundary.tsx — the codebase's only class component (no hooks): localizes via
  `static contextType` with the provider mounted above it in src/renderer/index.tsx.
- e2e/seed.ts + e2e/ui.mjs — the seeding pattern (direct store access) and the second-instance
  pattern (~1018-1024). Playwright's Electron runs under en-US: with system detection, the seed MUST
  write `locale='tr'` or ~208 Turkish locators break.
- scripts/check-boundaries.mjs — the constraints the bundles must respect: c1 (no
  claude|anthropic|cursor|copilot|gemini|openai|gpt substring anywhere in src/ui — the EN lexicon
  cannot say "cursor"), c3 (no node:/builtin imports — dictionaries are plain TS modules), c6 (no
  `.replace(`).
- CLAUDE.md:60 — the stale "UI copy is English" line this order corrects.

## Scope

In scope:

- core: `Locale = 'tr' | 'en'` union + `getLocale(): Promise<Locale | undefined>` /
  `setLocale(locale)` on the AppSettings port (src/core/app-settings.ts).
- store adapter: `settingLocale` (missing/garbage row → undefined) + the two members on
  `app_setting` key `locale`; one store test (default undefined, round-trip, garbage → undefined).
- IPC bridge: `docket:settings:get-locale` / `set-locale` + the two preload entries.
- labels module: `src/ui/data/labels/` — `tr.ts` (today's content moves; same names, same
  signatures; `as const` dropped from the bundle), `en.ts` (`const en: Labels` — completeness
  compiler-enforced), `marks.ts` (locale-invariant glyphs), `index.ts` (bundles + `Labels` +
  `LABEL_BUNDLES`; deliberately NO word re-exports — an un-migrated static import must not compile),
  `labels.test.ts` (key parity + formatter expectations).
- `src/ui/data/locale.tsx`: LocaleProvider (localStorage mirror `docket.locale` for first paint,
  `navigator.language` detection when nothing is stored, DB row wins on reconcile,
  `document.documentElement.lang` kept in sync — Turkish İ/i text-transform correctness), `useLabels`
  / `useLocale`, catch-guarded port calls (the provider sits above the only ErrorBoundary).
- the 33-consumer migration: each file's labels import becomes a `useLabels()` destructure of the
  same names; component bodies stay byte-identical. ErrorBoundary via `contextType`;
  renderer/index.tsx mounts the provider above the boundary (settings port injected as a prop —
  src/ui never touches `window.docket`).
- App.tsx: the dead second AppSettingsModal render dies (state line ~40, render ~375); the
  driveStore-callback and document.title effects take the labels in their dep arrays so
  notifications and the title re-localize on switch.
- the selector: AppSettingsModal's Segmented goes live (`useLocale()`), instant switch, endonym
  option labels ('Türkçe'/'English' in both bundles).
- bypass repairs (the only two display strings outside the seam): StepList.tsx:120
  `aria-label={s.status}` → `STEP_STATUS_LABELS[s.status]`; drive-store.ts:86
  `lastError: 'drive failed'` deleted — the crash renders from a new `UI.driveStreamCrashed` key at
  the call sites (structural detection: `status === 'error' && !lastErrorCode && !lastError`).
- E2E: seed writes `locale='tr'`; three specs — instant tr→en→tr flip (visible copy spread, `lang`
  attr, `$6.27` decimal point, title), DB-beats-detection restart (second instance, `--lang=tr`,
  fresh userData), empty-DB hero in EN.
- docs: ADR-0007 addendum (WO-0013 debt + this order: bundles, DB persistence, system-detection
  default ruling, compile-time completeness superseding the runtime en-fallback clause, theming half
  noted dead), CLAUDE.md English-section fix + labels path update, ROADMAP M3.5 tick, tech-debt
  entries for accepted residue.

Out of scope:

- CLI localization (English by ruling; the port carries the locale but the CLI reads none).
- Repository documents, code comments, commit messages (English per ADR-0007, regardless of locale).
- Domain data translation: WO titles/bodies, plan text, transcripts, evidence values, provider error
  messages, the clipboard `code:`/`message:` prefixes, the agent-bound 'Denied by operator' reason.
- Any i18n library (the bundle module replaces one; also c3/c6 make the usual ones unusable).
- Theme (dark-only ruling already killed ADR-0007's theme half).
- The M3.5 hardcoded-string lint bullet (a separate item; the compiler-driven `Labels` completeness
  is this order's share of it).
- The fixtures' English mock content (src/adapters/fixtures — display data, not chrome).

## Acceptance criteria

1. Every display string exists per locale: `labels/tr.ts` and `labels/en.ts` both satisfy `Labels`;
   removing a key from `en` fails `npm run typecheck` (demonstrated once in the PR description). No
   i18n library, no JSON/fs loading, no `.replace(` in src/ui.
2. The Settings language Segmented is functional: switching to English re-renders every visible
   surface (board, detail, Settings itself) without restart — E2E.
3. The preference persists in `app_setting`: store test covers the default (`undefined` = no
   explicit choice), an `en` round-trip, and a garbage row falling back to `undefined`; E2E proves a
   relaunch on the same DB boots EN with empty localStorage (DB beats detection, `--lang=tr`).
4. A fresh install with nothing stored boots in the system language (tr-prefix → tr, else en) —
   E2E proves the tr branch via `--lang=tr` on a fresh DB.
5. `document.documentElement.lang` follows the locale in both directions (E2E).
6. Formatters localize: `formatUsd` decimal comma ↔ point (`$6,27` ↔ `$6.27` — unit test + E2E on
   the same seeded data), `formatDateTime` month abbreviations, `formatDuration` units (unit test);
   `auditClock` stays 24h in both (lexicon note).
7. Option labels are endonyms in both dictionaries ('Türkçe'/'English').
8. Bypass repairs: StepList's step row aria-label reads `STEP_STATUS_LABELS[s.status]`; the
   drive-stream crash line renders from `UI.driveStreamCrashed` in both locales; raw provider
   errors, clipboard prefixes, and the deny reason remain untranslated by design (Notes).
9. ErrorBoundary's fallback localizes via `static contextType` (code-review AC — not
   E2E-crashable).
10. `e2e/seed.ts` writes `locale='tr'`; all 37 existing specs pass unchanged
    (`git diff e2e/ui.mjs` shows only additions; the `$6,27` assertion stands).
11. The EN lexicon passed the operator's vocabulary review (the spine table below finalized);
    the EN bundle contains no boundary-banned vendor substring (`check:boundaries` green).
12. Docs: ADR-0007 addendum (WO-0013 debt + this order's rulings), CLAUDE.md English-section fix,
    ROADMAP M3.5 tick, tech-debt entries for the accepted residue.
13. CI green: typecheck (both tsconfigs), test, build, check:boundaries, test:ui (40/40).

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at head sha
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

- The vocabulary spine (table below): SADE/DETAY → SIMPLE/DETAIL or kept as brand tokens;
  Defter → Ledger or Registry; Oturum dökümü → Session log or Transcript. Operator decides before
  the EN pass is finalized (C7).
- The EN copy for contract strings E2E asserts (window title "waiting for permission" shape,
  notification title/body) — operator reviews before the specs freeze.
- The drive-store crash-line shape: this order's stance is the structural render-site branch
  (behavior identical, no core change); the alternative — a `TranscriptNoteKind` member through the
  existing note channel — changes where the message surfaces. Architect may propose; operator
  decides.
- If any EN wording would need a banned vendor substring to be natural (it should not) — stop and
  ask, never workaround.

## Notes

- Vocabulary spine (draft; finalized at the C7 gate):

  | TR (live) | EN (proposed) | Note |
  | --- | --- | --- |
  | iş emri / çalışma alanı / depo | work order / workspace / repo | |
  | karar deposu / Defter | decision store / Ledger | gate |
  | kanıt / kaynaklar / oturum | evidence / Sources / session | |
  | Sıra sende / Çalışıyor / Kapalı | Your turn / Working / Closed | buckets |
  | Süre / Maliyet | Duration / Cost | |
  | Her seferinde sor / Riskli hariç / Tam otomatik | Ask every time / Risky excluded / Full auto | |
  | Akış / Kayıt | Flow / Record | |
  | SADE / DETAY | SIMPLE / DETAY (or brand tokens) | gate |
  | Mimar denetimi / Oturum dökümü | Architect review / Session log | gate |
  | Durduruldu. Rapor kısmi kalır. | Stopped. The report stays partial. | E2E-asserted |
  | izin bekliyor (title) | waiting for permission | E2E-asserted |

- Accepted residue (tech-debt entries at closure): terminal scrollback and persisted transcripts
  render in the locale active at write time; the clipboard diagnostic prefixes and the deny reason
  stay English by design; e2e/seed.ts's `locale='tr'` is load-bearing while detection is the default.
- Known minor behavior: cleared localStorage + a stored DB choice ≠ detection → the one loading
  line may flash in the detected language (~100ms) before the mount effect reconciles; every normal
  boot reads the mirror synchronously. Not engineered around.
- index.html keeps its static `lang="tr"` (no visible text before React mounts; the provider sets
  `lang` synchronously in the initializer). The pairing is commented in both files.
- Ordering: WO-0034 stays pencilled to profiles (WO-0033 Notes); this order takes WO-0035.
