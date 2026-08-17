---
id: WO-0031e
title: Tur-3 cila — kapatılabilir peronu, yeşil hairline, denetim dökümü, sekme kaydırma
workspace: docket
status: open
mode: direct
review: light
tracks:
  - repo: docket
    depends_on: []
---

# WO-0031e — Tur-3 cila — kapatılabilir peronu, yeşil hairline, denetim dökümü, sekme kaydırma

## Objective

Land the operator's tur-3 rulings (2026-08-17, recorded in the WO-0031d closure session — fixed scope,
all four decisions confirmed in the planning round): the board grows an awaiting-close platform so a
closable work order is visible from the outside, the strip progress hairline fills green like the step
fill, the Denetim session ledger's rows expand to their transcript, and a DETAY tab switch scrolls the
opened panel into view.

## Context

- The four rulings, as picked by the operator: (1) the platform threshold relaxes from "only closed" to
  "no live work left" (`working` empty AND non-closable `up` empty) with one CTA into the first closable
  detail, the closable card says ▸ "Kapatılabilir", and the all-closed "Bütün işler tamam" platform stays
  exactly as tur-2 D1 shipped it; (2) `.hairline-progress` fills `--color-proceed` (it fills `--color-
  signal` today while `.stepfill` is already green); (3) the audit-row transcript expansion; (4) the
  tab-switch scroll.
- ADR-0012 governs every item: 1 short line + exactly 1 CTA on the new platform, no mount animation,
  `.irow` hover on the row toggle, instant scroll (no smooth), SADE stays calm.
- TD-036 is untouched: `closeable` rides the existing `getWorkOrders` payload exactly as `stage` and
  `cost` already do — no port signature changes.

## Scope

In scope:

- **Closable card signal**: `WorkOrder` gains an adapter-derived `closeable` (the full `canClose`
  predicate over the step rows, computed at hydrate — the `stage`/`cost` precedent, never stored);
  `toCardView` exposes it; `deriveCardAction` prefers it after the working-state suppressions; the
  board card's closure action reads "Kapatılabilir".
- **Awaiting-close platform**: when `working` is empty and every remaining `up` card is closable, the
  board renders the platform line ("N iş kapatılmayı bekliyor") + exactly one CTA opening the first
  closable detail; closable cards actionable, closed cards quiet below; no mount stagger. A
  stopped_asking card never counts as closable in the partition (a permission ask outranks closure).
- **Green hairline**: `.hairline-progress` fill `--color-proceed` — color-only, the ≤400ms width
  transition and the reduced-motion kill already cover it.
- **Audit-row transcript**: `deriveSessionAudit` rows carry `sourceIdx` (the input-session index) so
  the UI can map a row back to its `SessionRef.transcript`; the AuditTable row grows a show/hide toggle
  (absent when the transcript is empty — never disabled), the transcript renders as mono DOM lines via
  labels' `transcriptLineText` in a height-capped box; instant, one row open at a time; both surfaces
  (DETAY Denetim section + the closed-WO default body) inherit it.
- **Tab auto-scroll**: selecting a DETAY tab (<1080px) scrolls the opened panel's top into view
  (double-rAF, instant); the instrument panel gains the `sec-instrument` anchor; `jumpToSteps` reuses
  the same handler; rack layout unaffected.
- E2E: a third seeded workspace (`raf`) holding one closable-but-open work order with a
  transcript-carrying session; specs for the platform + CTA + green hairline, the row expansion, the tab
  scroll; an absence assert that rows without a transcript render no toggle.

Out of scope:

- Specialization profiles — WO-0032.
- Measured contrast / color token changes beyond the one hairline swap; locale + theme (M3.5).
- Çizelge / transcript virtualization (TD-037 territory).
- Any port-signature or preload-arity change (TD-036).
- Close-from-the-board (the CTA opens the detail; the Kapat card stays the one close surface).

## Acceptance criteria

1. `closeable` is the `canClose` predicate over the step rows, derived in the adapter at hydrate,
   never stored; `toCardView().closable` is always boolean; `deriveCardAction` returns
   `{ kind: 'closure', intent: 'close' }` for a closable WO unless a working state
   (`in_progress`/`ci_running`) or a stopped_asking permission ask outranks it — pinned by core tests.
2. `working.length === 0 && otherUp.length === 0 && closableUp.length > 0` renders the
   `data-board-awaiting-close` platform: one line ("N iş kapatılmayı bekliyor") + exactly one CTA that
   opens the first closable detail; closable cards actionable, closed cards quiet; the all-closed board
   keeps the tur-2 D1 platform unchanged; mixed boards render closable cards in `up` with ▸
   "Kapatılabilir".
3. `.hairline-progress`'s fill is `--color-proceed` (pinned by an E2E computed-style assert); the
   transition stays ≤400ms and dies under reduced motion (existing block, unchanged).
4. An audit row with a non-empty transcript renders the toggle (`.irow`, `aria-expanded`); clicking
   shows that session's transcript under the row (`data-audit-transcript`, mono DOM via
   `transcriptLineText`, height-capped, scrollable); clicking again hides it; one row open at a time; a
   row with an empty transcript renders no toggle.
5. Selecting a DETAY tab scrolls the opened panel into view, instant, only on value change; nothing
   scrolls on mount or on a same-tab re-click; the rack layout never scrolls from this path.
6. All new copy lives in `labels.ts`; no `.replace(`/`disabled` in `src/ui`.
7. E2E: 29 specs green (26 + the 3 new), including the absence assert.
8. `npm run typecheck && npm test && npm run check:boundaries && npm run build && npm run test:ui`
   green.

## Evidence required

- plan_approval: exempt — `mode: direct`; the plan is the operator's tur-3 rulings + this order.
- pr_open: PR URL, head sha (single PR).
- ci_green: all required checks `success`.
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged, `ROADMAP.md` updated; tech-debt only if review opens an entry.

## Stop-and-ask gates

- (none)

## Notes

Created 2026-08-17 in the WO-0031d closure session. Hand-numbered WO-0031e on purpose (TD-035).
Two planning-round corrections worth naming: the transcript renders through labels'
`transcriptLineText` (the DOM sibling the fail card already uses) — core's `formatTranscriptLine`
emits ANSI for xterm and would print escapes in DOM; and `deriveSessionAudit` sorts a copy, so the
rows need `sourceIdx` to map back to their source session at all. The closable derivation is
`canClose`, not `stage === 'closure'` — the seed's `Uygulama sürüyor` sits at stage `implementation`
while its Kapat card is live, which is exactly the state the board must surface. The transcript box
is height-capped but line-unbounded; virtualization stays TD-037 territory.
