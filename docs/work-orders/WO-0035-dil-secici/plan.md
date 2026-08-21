# WO-0035 — plan

The design the implementer follows. Decisions are settled here; the order's ACs are the contract.

## D1 — Bundle structure: `src/ui/data/labels/`, one object per locale, compiler-enforced completeness

- `tr.ts` — today's labels.ts content moves nearly verbatim: same member names, same signatures,
  same internal cross-references (`cardReasonText` closes over its own bundle's `UI`). The `as
  const` on the bundle object is DROPPED (literal property types would make `en` unassignable;
  grep-verified nothing compares label values to literals). File shape survives: consts first,
  composers after, the bundle object assembled last:
  ```ts
  const tr = { UI, BUCKET_LABELS, /* …every display member… */ };
  export type Labels = typeof tr;
  export default tr;
  ```
- `en.ts` — `const en: Labels = { … }`. A missing key is a compile error, which is how ADR-0007's
  "en as the fallback for any missing key" clause now holds (vacuously, by type — the addendum
  records the supersession). Ships as a competent draft in the migration commit, refined at the
  operator's vocabulary gate (C7).
- `marks.ts` — `STEP_MARK`, `VERDICT_MARK`: locale-invariant glyphs, never duplicated per bundle.
- `index.ts` — re-exports `tr`, `en`, `Labels`, the marks, and `LABEL_BUNDLES: Record<Locale,
  Labels>`. Deliberately does NOT re-export any word member: an un-migrated static import stops
  compiling, so the compiler drives migration completeness. The `../data/labels` import path keeps
  resolving through the directory index.
- `labels.test.ts` — runtime belt under the compile-time braces: key parity (`Object.keys(en)`
  mirrors `Object.keys(tr)`, member kinds match), `formatUsd(6.27)` → `'$6,27'` / `'$6.27'`,
  duration units, month abbreviations.

Rejected: keeping `labels.ts` as the tr module beside `labels-en.ts` (two homes for where words
live); keeping `as const` with a satisfies-clause (loses the completeness guarantee, adds runtime
machinery); any i18n library (c3 bans fs-loaded dictionaries, c6 bans `.replace(` interpolation —
and the repo's template-function pattern already does the job).

## D2 — `LocaleProvider` + `useLabels()` in `src/ui/data/locale.tsx` (the view-mode precedent)

- Mounted in `src/renderer/index.tsx` ABOVE the only ErrorBoundary:
  StrictMode → LocaleProvider(settings) → ErrorBoundary → TooltipProvider → App. The port arrives
  as a prop; `src/ui` never touches `window.docket` (ADR-0006).
- Resolution rule (the operator's 2026-08-21 system-language ruling):
  - First paint, synchronously in the `useState` initializer: the `docket.locale` localStorage
    mirror, else `resolveSystemLocale(navigator.language)` — tr-prefix → tr, else en. The
    initializer also sets `document.documentElement.lang` (Turkish İ/i text-transform correctness on
    the first frame). Tolerant of storage/`navigator` failure, never throws.
  - Mount effect: `settings.getLocale()`; a stored row WINS over mirror and detection (state +
    mirror + `lang` updated). All port calls `.catch()`-guarded — the provider sits above the only
    error boundary and must never throw.
  - `setLocale`: optimistic state + mirror + `lang`, then `void settings.setLocale(locale).catch(...)`.
- Context value `{ locale, labels, setLocale }`; default = the tr bundle + a noop setter (a
  provider-less render degrades to today's Turkish). Exports: `LocaleProvider`, `useLabels():
  Labels`, `useLocale()`, and the context itself (for the class boundary).
- ErrorBoundary (class — no hooks): `static contextType = LocaleContext`; the fallback reads
  `this.context.labels.UI.*`. Context updates re-render the fallback on switch. Rejected: a
  module-level active-labels snapshot (a second mutable global), a render-prop child (moves the
  problem), boundary-above-provider (the fallback could never localize).

## D3 — Persistence chain (the permission-rule pattern, extended)

- `src/core/app-settings.ts`: `export type Locale = 'tr' | 'en';` + `getLocale(): Promise<Locale |
  undefined>` (undefined = no explicit choice — the `getProviderKey` precedent) and
  `setLocale(locale: Locale): Promise<void>`. A pure union carries no display strings (ADR-0006).
- `src/adapters/store/index.ts`: `settingLocale(db)` beside `settingPermissionRule` — `'tr'`/`'en'`
  pass through, missing or garbage → `undefined`; `setLocale` writes `INSERT OR REPLACE INTO
  app_setting (key, value) VALUES ('locale', ?)`. No schema change (`app_setting` exists).
- `electron/main.ts` + `electron/preload.ts`: the `docket:settings:get-locale` / `set-locale`
  channel pair, both files in ONE commit (TD-036 — preload arity is hand-maintained).
  `src/renderer/preload.d.ts` unchanged (types flow from `AppSettings`).
- `store.test.ts` +1: default `undefined`; `setLocale('en')` round-trip; a garbage row → `undefined`.

## D4 — The selector and the dead modal

`AppSettingsModal`'s placeholder Segmented goes live (`useLocale()`; `value={locale}
onValueChange={setLocale}`), instant switch — the context swap re-renders everything under the
provider. Option labels are endonyms ('Türkçe'/'English') in both bundles. `App.tsx`'s dead second
settings surface (state ~line 40, render ~375; the only opener lives in AppShell) is removed — a
two-line cleanup inside a file this order touches anyway.

## D5 — Formatters become bundle members; signatures unchanged

`formatUsd` (`Intl.NumberFormat('tr-TR'` ↔ `'en-US'` — decimal comma ↔ point), `formatDateTime`
(`MONTHS_TR` ↔ `MONTHS_EN`), `UI.formatDuration` (tr `ms/sn/dk/s` ↔ en `ms/s/m/h`),
`formatTokens` (same `k` abbreviation both — a bundle member for uniformity), `formatCost`,
`woIdLabel` (identity in both — the ADR-0007 carve-out names it the formatting seam).
`UI.auditClock` stays 24h in BOTH (operator preference; lexicon note).

## D6 — Consumer migration: destructure, don't rewrite

Each of the 33 consumer files replaces its labels import with `useLabels()` and destructures the
exact names it used before, at the top of the component. Bodies stay byte-identical. Special
cases: ErrorBoundary via `contextType` (D2); `pane-chrome.tsx`'s only use is inside its `StreamLine`
component (hook there); `Terminal.tsx` keeps the `toolLabel`/`UI.noteFor` injection into core's
transcript-format resolvers (written scrollback keeps its write-time locale — accepted, noted);
`App.tsx`'s driveStore-callback and title effects take the labels members into their dep arrays so
notifications and `document.title` re-localize on switch.

## D7 — The two bypass repairs

1. `StepList.tsx:120` — `aria-label={s.status}` → `STEP_STATUS_LABELS[s.status]` (the record
   exists unused precisely for this).
2. `drive-store.ts:86` — the hardcoded `'drive failed'` string is DELETED (the `status: 'error'`
   flag stays); the crash is identified structurally at render time (`status === 'error' &&
   !lastErrorCode && !lastError` — the fold's error events always carry code/message, the catch
   path is the only code-less error). The render sites (`SessionPane`, `ReviewPane`, `StepPane` ×2,
   the fail card in `WorkOrderDetail`) gain the final fallback arm `UI.driveStreamCrashed` (tr
   draft: 'Akış koptu — kayıt korundu.'). No injection machinery, no sentinel-string compares; the
   invariant is documented at the write site. The alternative (a `TranscriptNoteKind` member
   through the note channel) stays behind the order's stop-and-ask gate.

## D8 — EN lexicon and the operator gate

~370 entries. The order carries the spine table; the full `en.ts` is reviewed in the PR diff and
the operator's rounds (the WO-0033 precedent). The lexicon must not contain the boundary-banned
vendor substrings (c1) — never "cursor" for a text caret. The contract strings E2E asserts (title
"waiting for permission" shape, notification copy) freeze only after the operator gate.

## Work packages (commit-sized)

- C1 `docs(WO-0035): order.md` ✓ 982be98
- C2 `docs(WO-0035): plan.md` — this file (plan_approval evidence)
- C3 `feat(WO-0035): Locale port — core union, store row, IPC bridge` — app-settings.ts, store
  (+test), main.ts, preload.ts. Independently green.
- C4 `feat(WO-0035): per-locale bundles + LocaleProvider; all consumers via useLabels` — the big
  mechanical commit (labels/, locale.tsx, the 33-file migration, ErrorBoundary contextType, the
  renderer mount, the dead modal removal, both bypass repairs, the draft en.ts). One commit because
  `labels/index.ts` intentionally stops re-exporting words — a partial migration cannot compile,
  which is the point.
- C5 `feat(WO-0035): the language selector` — the Segmented goes live. Small, isolated,
  screenshot-friendly for review.
- C6 `test(WO-0035): E2E locale specs` — the seed's `setLocale('tr')` + three specs (instant flip;
  DB-beats-detection restart via `--lang=tr` + fresh userData; the empty-DB hero in EN).
- C7 `feat(WO-0035): EN vocabulary round(s)` — after the operator gate; may land as several commits.
- C8 `docs(WO-0035): ADR-0007 addendum, CLAUDE.md, ROADMAP, tech-debt` — closure.

## E2E

The seed writes `locale='tr'`, so the existing 37 specs run untouched (`$6,27` stands). New:

1. Instant flip — Settings → English; a spread of EN strings, `lang="en"`, `$6.27` (decimal point
   — the mirror of the `'$6,27'` assertion on the same seeded data), EN title; back to Türkçe,
   `lang="tr"` restored. Ends in tr (later specs start clean).
2. DB beats detection — second-instance pattern, a COPY of the seeded DB: (a) fresh DB + `--lang=tr`
   → boots TR (detection); (b) toggle EN, close, relaunch SAME DB with fresh userData (empty
   localStorage) + `--lang=tr` → boots EN (the row won). Own console collector.
3. Empty-DB hero in EN — fresh DB, toggle EN, the hero line + exactly one CTA,
   `empty-db-hero-en@980.png`.

## Verification

Per commit and at closure: `npm run typecheck` (both tsconfigs), `npm test`, `npm run build`,
`npm run check:boundaries`, `npm run test:ui` (40/40; `git diff e2e/ui.mjs` additions only).
Manual: tr↔en on a live drive (rail, new terminal lines, toasts), reload while EN, a killed drive
under EN (the localized crash line), Settings reopening on the stored segment. Greps: no Turkish
display literal outside `labels/tr.ts` in src/ui (comments excepted); no static word import from
the bundles outside `locale.tsx`.
