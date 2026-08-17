---
id: WO-0031f
title: UI final turu — yön D3, sekme dili, tahta kontrolü, kapalılık
workspace: docket
status: open
mode: direct
review: light
tracks:
  - repo: docket
    depends_on: []
---

# WO-0031f — UI final turu — yön D3, sekme dili, tahta kontrolü, kapalılık

## Objective

Land the operator's final-tour rulings (2026-08-18, three AskUserQuestion rounds over the v5 mockup
`docs/ui-mockups/wo-0031-v5-final-turu.html` — 12 decisions): the **D3 "Sıcak"** aesthetic direction
becomes the console's global pass, DETAY tabs gain a real affordance + panel context + a conditional
scroll language, the board gains the closed-list toggle + a peron invitation + card durations, the
closed work order becomes immutable (UI + store), the step report opens under its row, the
running-empty terminal gets its line — and the agreed tech-debt batch rides along.

## Context

- The 12 rulings, as picked by the operator (mockup §09 ledger):
  - **Y1 = D3 Sıcak** (the operator's own pick, not the tour's D1 recommendation): the lamp language
    goes everywhere — the step row's left edge carries its state color (done `proceed`, active
    `info`), rack section headers open with a dot, audit rows carry their role lamp, the ambient glow
    is a tick stronger (§01 D3 frames + the d3 audit close-up are the spec; the deltas table lists
    every axis).
  - **S1 = C**: active tab gets a 2px `signal` underline; the active tab's count turns info-toned
    (Adımlar 1/4, Kanıt 2/3 — the counts already exist in the app today, C only emphasizes them).
  - **S2 = panel header + count, sticky**: every DETAY tab panel opens with the rack's own readout
    header + mono aside (`DetailSection` already carries both; tabs drop them today), sticky within
    the panel. The Terminal panel keeps its own instrument head (it is not a section).
  - **S3 = conditional scroll**: on tab switch the panel scrolls into view only when it is out of
    view; the motion rides CSS `scroll-behavior: smooth` (never JS `behavior:'smooth'` — the one
    reduced-motion block must kill it), long distances fall back to instant; the substrip adım N/T
    jump uses the same handler.
  - **T1 = toggle button**: one closed-list control across all three surfaces (the mixed board's
    drawer, the awaiting-close tail, the all-done list) — "▸ N kapalı iş", collapsed by default when
    N > 5.
  - **T2 = inline invitation**: the all-done platform line carries "▸ Yeni iş emri" next to "Bütün
    işler tamam" (opens the create modal). The awaiting-close platform keeps exactly its one CTA
    ("Kapanışa git") — its work is closing, not creating; this narrows the original finding to the
    all-done surface and keeps ADR-0012 r2's "exactly 1 CTA" intact for the waiting platform.
  - **T3 = session-sum duration**: the card's Süre is the sum of session durations (the strip's live
    Süre and the audit total — one number everywhere); drawn only when at least one session has
    finished (the cost line's precedent — never `$0.00`-style noise on fresh cards).
  - **R1 = inline report**: the step report opens under its own row in the StepList (the audit-row
    ▸ döküm idiom: real padding, header "Rapor · Adım N" + role + time, one open at a time, the
    toggle is a real button with `aria-expanded`, hover via the `.alink`/`.irow` family).
  - **K1 = Sil stays**: on a closed WO the pencil is ABSENT with the reason line "Kapalı iş emri
    değişmez", the review-mode chip renders as an inert badge (a closed WO's mode is history, not a
    setting), the permission badge stays display-only, and Sil remains (archive hygiene is not
    editing) — the Sil dialog gains the error line (TD-038.4). Enforcement is two layers: UI surfaces
    absent AND the store's `updateWorkOrder` throws on `stage === 'closed'` (test-first);
    `deleteWorkOrder` stays allowed.
  - **F-kat = all in**: TD-038 items 1–5 + TD-037's two (see Scope). TD-034 (transcript markdown)
    stays OUT — an architecture decision, not polish.
  - **.rise = removed**: the board's mount stagger dies; ADR-0012's "no motion on mount" needs no
    exception (TD-038.1 resolved by removal).
  - **F7 copy = "Oturum açıldı — çıktı bekleniyor"** for a running session with zero entries.
- ADR-0012 governs every item. One amendment lands with this WO (see Scope); everything else stays
  inside the existing contract.
- The v5 mockup is the approved design (WO-0031c's v4 precedent: mockup + rulings = the plan). Its
  §02+ frames render today's structure by design — the D3 pass applies globally per §01.
- Pre-tour finding 0 (closed cards claiming "▸ Kapatılabilir") was already fixed pre-merge in #37
  (`14fce73`); this WO starts from that state.

## Scope

In scope:

- **D3 direction pass (F3)**: `src/index.css` + the detail/board components — step rows (`StepList`)
  gain a 3px state edge (done/active), rack section headers (`SectionStack`) gain the leading dot,
  `AuditTable` rows gain the role lamp, the glow washes strengthen one notch (within the existing
  static radial pattern — still no animation). Typography, spacing band, tokens, and the hover
  contract do not change (D3's deltas table is the boundary).
- **Tabs (F5)**: `src/ui/kit/Tabs.tsx` — S1-C affordance (kit-only; every tab surface inherits);
  `DetailBody.tsx` — the section header + aside inside each `TabsContent` (shared markup with
  `SectionStack`), sticky within the panel; `WorkOrderDetail.tsx` `handleTabChange` — the conditional
  scroll: bounds-check the target, move only when out of view, smooth via a CSS `scroll-behavior`
  class (killed by the one reduced-motion block), instant fallback for long distances; the substrip
  N/T jump rides the same handler.
- **Board (F1, F2, F4)**: `Board.tsx` — the closedtoggle pattern on all three surfaces (the mixed
  drawer's `<details>` becomes the button row; awaiting-close tail; all-done list; collapsed default
  at >5), the all-done platform's inline invitation CTA (`onNewWorkOrder` threaded from
  `BoardScreen.tsx`); core-first **card duration**: `WorkOrderCardView.durationMs` (sum of session
  durations; 0 when none finished), derived in `toCardView`, drawn beside cost only when >0; label
  keys `closedToggle(n)` etc.
- **Report (F6/R1-A)**: `StepList.tsx` — the done row's report opens as an inline expansion under the
  row (padded, header "Rapor · Adım N" + `ROLE_LABELS` + time, one open, `aria-expanded`, `.alink`
  toggle); `StepReport.tsx`'s detached-card variant retires; the loading state uses the new load line.
- **Empty stream (F7)**: `SessionPane.tsx` / `StepPane.tsx` — a running session with zero entries
  renders the line "Oturum açıldı — çıktı bekleniyor" (mono, dot pulse) where the terminal would be
  blank; it leaves with the first transcript line.
- **Closed immutability (F8/K1)**: `DetailStrip.tsx` — `stage === 'closed'` gates the pencil (absent +
  the reason line) and freezes the review chip to an inert badge (same treatment as `driveLive`);
  store `updateWorkOrder` throws on closed (store test or a `canEditWorkOrder` core predicate,
  test-first — UI gating alone would be a lie); `deleteWorkOrder` unchanged; the Sil dialog gains the
  error line (`handleDelete` catch → dialog error state, the Kapat dialog's pattern).
- **TD folds**: TD-038.1 `.rise` + its stagger code removed from `Board.tsx`; TD-038.2 StepList
  `hover:underline` → `.alink`; TD-038.3 terminal pulse dispose-timer cleanup on unmount;
  TD-038.5 the second empty-DB E2E app gets the console-error collector; TD-037 Çizelge renders 3
  events + "▸ tümü (N)" expansion (the same bounded-list idiom); TD-037 load lines ("Adımlar
  okunuyor…" etc. — quiet mono + dot, no skeletons).
- **ADR-0012 edit**: r2 gains one sentence — a *finished* surface may carry one invitation CTA beside
  its state line (the peron invitation is the named case). Nothing else in the ADR changes; the
  `.rise` question resolves by removal, so no exception is written.
- **Labels**: ~10 new keys, all pre-shown in the mockup (§09's new-text table): `closedToggle(n)`,
  `showAll(n)`, `reportToggle` pair, `streamOpen`, `stripClosedReason`, the load-line trio, the
  peron CTA reuses the existing create label.
- **E2E**: specs for the closed toggle (three surfaces), the peron CTA opening the create modal, the
  tab underline + active count, panel headers present, the conditional scroll (moves when hidden,
  still when visible), the closed strip's absence asserts (pencil, clickable badge), the card
  duration, the report expansion, the stream line, the Çizelge cap.

Out of scope:

- Specialization profiles — WO-0032.
- TD-034 (transcript markdown rendering) — architecture decision, its own WO if ever.
- Measured-contrast/token changes (D3 uses the existing palette only); locale + theme (M3.5).
- Audit virtualization; the awaiting-close platform gaining a second CTA (T2 ruling narrows the
  invitation to the all-done surface).
- Any port-signature or preload-arity change (TD-036) — `durationMs` rides the existing
  `getWorkOrders` payload exactly like `stage`/`cost`/`closeable`.

## Acceptance criteria

1. The D3 pass is visible exactly on its four axes: StepList rows carry the 3px state edge
   (done `proceed` / active `info`), rack section headers open with a dot, audit rows carry the role
   lamp, the glow washes are one notch stronger — and NOT on anything else (no typography, spacing,
   token, or hover changes beyond the named deltas).
2. The active DETAY tab carries a 2px `signal` underline and its count renders info-toned; inactive
   tabs keep today's dialect; every section panel opens with its readout header + aside, sticky
   within the panel; the Terminal panel keeps its instrument head and no section header.
3. A tab switch scrolls only when the target panel is out of view; the motion rides CSS
   `scroll-behavior` (a computed-style assert pins it) and dies under reduced motion; the substrip
   adım N/T jump uses the same handler; nothing scrolls on mount or same-tab re-click.
4. All three closed-list surfaces use the one toggle button ("N kapalı iş", `aria-expanded`,
   `.irow`-family hover); at >5 closed cards it starts collapsed; the mixed board's `<details>`
   drawer is gone.
5. The all-done platform line carries the inline invitation that opens the create modal; the
   awaiting-close platform is unchanged (one CTA).
6. `WorkOrderCardView.durationMs` is the session-sum (core tests: zero sessions → 0, live-only → 0,
   never NaN, multi-session sum), drawn beside cost only when > 0; the strip's Süre and the audit
   total tell the same number for the same WO.
7. A done step's report opens as a padded inline expansion under its row with the contextual header,
   one open at a time; the toggle is a real button with `aria-expanded`; no detached report card
   remains.
8. A running session with zero entries renders "Oturum açıldı — çıktı bekleniyor"; a session-less
   pane keeps "Çalışan oturum yok."; the line leaves with the first transcript entry.
9. On a closed WO: no pencil (the reason line reads "Kapalı iş emri değişmez"), the review chip is an
   inert badge, Sil remains and its dialog surfaces delete failures; the store rejects
   `updateWorkOrder` on a closed WO (test-pinned) while `deleteWorkOrder` still works.
10. `.rise` and its stagger are gone; StepList's report link uses `.alink`; the terminal pulse timer
    is cleared on unmount; the empty-DB E2E app collects console errors; Çizelge renders 3 events +
    "▸ tümü (N)"; the named load lines replace bare "Yükleniyor…".
11. ADR-0012 r2 carries the one-sentence finished-surface invitation amendment; no other ADR text
    changes.
12. All new copy lives in `labels.ts`; no `.replace(`/`disabled` in `src/ui`.
13. E2E: 29 specs + the new set green (target ≥ 36); `npm run typecheck && npm test && npm run
    check:boundaries && npm run build && npm run test:ui` green.

## Evidence required

- plan_approval: exempt — `mode: direct`; the plan is the operator's 12 v5-tour rulings + this order.
- pr_open: PR URL, head sha (single PR).
- ci_green: all required checks `success`.
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged; `ROADMAP.md` `[x]` + `docs/tech-debt.md` updated (TD-038 closed, TD-037
  narrowed-or-closed per what landed); the ADR-0012 amendment rides the same PR.

## Stop-and-ask gates

- The exact ADR-0012 r2 amendment sentence (drafted in this order's Scope) — confirm at PR review
  before merge; the operator approved the direction (T2) over a mockup caption that flagged it, the
  final wording still gets one explicit look.

## Notes

Created 2026-08-18 in the v5 final-tour session. Hand-numbered WO-0031f on purpose (TD-035). The
mockup tour ran mockup-first per the v4 precedent: one self-contained HTML file (35 frames, 9
sections, click-tested demos), three critique lenses (contract/rubric/scenario) before the operator
saw it, an Electron smoke suite (zero console errors, every demo clicked), then three decision
rounds. Two honest deviations from the tour's own recommendations, both the operator's calls: Y1 =
D3 (the tour suggested D1), and the awaiting-close platform keeps a single CTA (the finding's
"both platforms" reading narrowed — see T2). The S3 smooth scroll MUST stay on the CSS route; a JS
`behavior:'smooth'` would bypass the one reduced-motion kill switch (the mockup implements and
documents this). `durationMs` rides the existing `getWorkOrders` payload — no preload signature
change (TD-036).
