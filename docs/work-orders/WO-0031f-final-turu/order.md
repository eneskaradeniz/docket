---
id: WO-0031f
title: UI final turu — yapı: Akış + Kayıt; yön D3; tahta kontrolü; kapalılık
workspace: docket
status: open
mode: direct
review: light
tracks:
  - repo: docket
    depends_on: []
---

# WO-0031f — UI final turu — yapı: Akış + Kayıt; yön D3; tahta kontrolü; kapalılık

## Objective

Land the operator's final-tour rulings — the v5 mockup tour (12 rulings, 2026-08-18) plus the v6
structure tour (2 rulings, same day, after the operator's "Apple gibi: daha az yüzey" feedback) —
as one restructure: DETAY's six tabs become **two surfaces (Akış | Kayıt)** with the live terminal
inside the active step's row, the **D3 "Sıcak"** direction pass over everything, the board's
closed-list toggle + peron invitation + card durations, the closed work order made immutable
(UI + store), the running-empty stream line, and the agreed tech-debt batch.

## Context

- **The v6 structure rulings (the tour's second round — operator: "istediğim o sıcaklık, sade,
  minimal… Apple gibi düşün… kanıt sekmesi ne gerek var mı? çok sekme var… hala tam final değil"):**
  - DETAY = **Akış | Kayıt** (Y-3): two tabs at <1080; at ≥1080 the rack IS Kayıt (left Akış, right
    the record) — no tabs. SADE unchanged (it already answers the three questions at a glance:
    whose turn, what to do, how much).
  - **Akış is the body itself**: the step list is the spine. The active step's row carries its live
    terminal INLINE, pinned open while running (not toggleable — the live thing is in front); a done
    step's report opens under its own row (the v5 R1 ruling, now the universal pattern); pending rows
    stay quiet. Free-form sessions (no plan) render the terminal inside the instrument card. Decision
    cards (ask, plan approval, verdict) keep living in the body above the flow, unchanged.
  - **Kayıt is one drawer**: three Kanıt chips at the top (a summary, not a section), Belgeler,
    Oturum dökümü. The archive body is the full Kayıt (result card + chips + docs + ledger), as today.
  - **Y-2: Çizelge dies as a surface** — "who did what when" already lives in the ledger rows'
    timestamps and the step metas; rare events (e.g. rule changes) surface in the audit row's
    detail. The stored event stream is untouched — only the UI section disappears.
  - Terminal/Kanıt/Çizelge/Belgeler/Oturum dökümü as standalone tabs all die; nothing is lost, every
    old surface has a written home (v6 §04 yuva tablosu).
  - The v5 S1/S2/S3 rulings (six-tab affordance, panel headers, conditional scroll) shrink into this
    world: the two tabs keep the signal underline + counts (Akış 1/4 · Kayıt 2/3); Kayıt's sections
    carry their own readout headers as drawn in v6; the conditional-scroll language survives only
    for the substrip adım N/T jump. The v5 §04 frames are superseded by v6 as the spec.
- **The v5 rulings that survive unchanged (tour round one, 12 decisions):**
  - **Y1 = D3 Sıcak** (the operator's pick, not the tour's D1 recommendation): the lamp language
    goes everywhere — step rows carry a 3px state edge (done `proceed`, active `info`), rack/Kayıt
    section headers open with a dot, audit rows carry their role lamp, the ambient glow is a tick
    stronger. The v6 frames are drawn in D3 — structure and warmth together are the spec.
  - **T1 = closed-list toggle button** across all three surfaces (mixed board, awaiting-close tail,
    all-done list): "N kapalı iş", collapsed by default when >5.
  - **T2 = inline invitation** on the all-done platform only ("Bütün işler tamam · ▸ Yeni iş emri");
    the awaiting-close platform keeps exactly its one CTA ("Kapanışa git").
  - **T3 = card Süre = session-sum** (one number with the strip and the audit total), drawn only
    when at least one session has finished.
  - **R1 = report under its row** — now the universal step-detail pattern (see Akış).
  - **K1 = closed WO immutable, Sil stays**: pencil ABSENT + reason line "Kapalı iş emri değişmez",
    review chip an inert badge, permission badge display-only, Sil remains with an error line
    (TD-038.4); the store's `updateWorkOrder` throws on `stage === 'closed'` (test-first);
    `deleteWorkOrder` unchanged.
  - **F-kat = TD-038 (all five) + TD-037 (Çizelge cap is MOOT — the section dies; the load lines
    remain)**; TD-034 stays OUT.
  - **.rise removed** (no ADR exception needed); **F7 copy = "Oturum açıldı — çıktı bekleniyor"**.
- ADR-0012 governs every item; one amendment lands (see Scope). Mockups are the approved design:
  `docs/ui-mockups/wo-0031-v5-final-turu.html` (35 frames) + `docs/ui-mockups/wo-0031-v6-yapi.html`
  (8 frames, D3 skin — where the two disagree, v6 wins).

## Scope

In scope:

- **DETAY restructure (v6)**: `DetailBody.tsx` / `DetailSections.tsx` — <1080: two tabs
  (Akış | Kayıt) with the S1 underline+counts treatment; ≥1080: Akış left, Kayıt rack right.
  Akış = decision surfaces + the step spine. Kayıt = Kanıt chips + Belgeler + Oturum dökümü
  (+ result card in the archive, where Kayıt is the body). Çizelge section removed; its events
  surface via the audit row detail / step metas. `Timeline`'s data path is untouched.
- **Terminal in the step row**: the active step's DETAY view renders its terminal inside the row
  (pinned while running — the live thing is never hidden behind a toggle); done rows toggle their
  report under the row (one report open at a time, real buttons, `aria-expanded`, `.alink` toggle);
  free-form sessions render the terminal in the instrument card. xterm mounts per active step;
  finished steps' scrollback is served by the transcript (the audit row expansion), not a live
  terminal. `StepReport.tsx`'s detached card retires.
- **D3 direction pass**: `src/index.css` + detail/board components — step-row state edges,
  section-header dots, audit role lamps, glow one notch stronger (static radials only). Typography,
  spacing band, tokens, hover contract unchanged (v5 §01 D3 deltas table is the boundary).
- **Board (F1, F2, F4)**: `Board.tsx` — the closedtoggle pattern on all three surfaces (the mixed
  drawer's `<details>` becomes the button; collapsed default at >5); the all-done platform's inline
  invitation (`onNewWorkOrder` from `BoardScreen.tsx`); core-first **card duration**
  (`WorkOrderCardView.durationMs`, session-sum, drawn beside cost only when >0).
- **Empty stream (F7)**: `SessionPane.tsx` / `StepPane.tsx` — a running session with zero entries
  renders "Oturum açıldı — çıktı bekleniyor"; it leaves with the first transcript line.
- **Closed immutability (F8/K1)**: `DetailStrip.tsx` closed gating (pencil absent + reason, inert
  badges); store `updateWorkOrder` throws on closed (test-first); Sil dialog error line
  (`handleDelete` catch).
- **TD folds**: `.rise` removal; StepList `hover:underline` → `.alink`; terminal pulse dispose-timer
  cleanup; empty-DB E2E console collector; load lines ("Adımlar okunuyor…" — the Çizelge cap item is
  moot, the section dies).
- **ADR-0012 edit**: r2 gains one sentence — a finished surface may carry one invitation CTA beside
  its state line (the peron invitation is the named case).
- **Labels**: Akış/Kayıt names + ~10 keys, all pre-shown in the mockups.
- **E2E**: the two-surface world (tab pair + counts + underline), terminal-in-row (live pinned,
  report toggle), Kayıt composition (chips/docs/ledger; Çizelge absence assert), the closed toggle
  (three surfaces), peron CTA, card duration, closed strip absences, stream line; existing tab-scroll
  and section specs rewritten for the two-surface world.

Out of scope:

- Specialization profiles — WO-0032.
- TD-034 (transcript markdown rendering); measured-contrast/token changes (D3 uses the existing
  palette); locale + theme (M3.5).
- Any second CTA on the awaiting-close platform; audit virtualization.
- Any port-signature or preload-arity change (TD-036) — `durationMs` rides the existing
  `getWorkOrders` payload.

## Acceptance criteria

1. DETAY at <1080 renders exactly two tabs — Akış (count = done/total steps) and Kayıt (count =
   satisfied/total evidence) — with the active tab's 2px `signal` underline and info-toned count;
   at ≥1080 the layout is Akış + Kayıt rack, no tabs; SADE is unchanged.
2. The active step's row carries its live terminal inline, pinned open while the session runs (no
   toggle hides it); a done step's report opens under its own row (padded, header "Rapor · Adım N" +
   role + time, one open at a time, real button + `aria-expanded`); pending rows are quiet; the
   detached report card no longer exists.
3. Kayıt renders: three Kanıt chips (with satisfied/total), Belgeler, Oturum dökümü — in that order;
   the archive body is the full Kayıt with the result card on top; **no Çizelge surface exists
   anywhere** (E2E absence assert) and audit rows can expand to transcript detail.
4. The D3 pass is visible exactly on its four axes (step edges, section dots, audit role lamps,
   stronger glow) and nowhere else.
5. All three closed-list surfaces use the one toggle button ("N kapalı iş", `aria-expanded`); at >5
   closed cards it starts collapsed; the mixed board's `<details>` drawer is gone.
6. The all-done platform line carries the inline invitation opening the create modal; the
   awaiting-close platform is unchanged (one CTA).
7. `WorkOrderCardView.durationMs` is the session-sum (core tests: zero sessions → 0, live-only → 0,
   never NaN, multi-session), drawn only when > 0.
8. On a closed WO: no pencil (reason line "Kapalı iş emri değişmez"), inert review badge, Sil works
   and surfaces failures; the store rejects `updateWorkOrder` on closed (test-pinned).
9. A running session with zero entries renders "Oturum açıldı — çıktı bekleniyor"; the line leaves
   with the first transcript entry.
10. `.rise` gone; StepList link uses `.alink`; pulse timer cleared on unmount; empty-DB E2E collects
    console errors; the named load lines replace bare "Yükleniyor…".
11. ADR-0012 r2 carries the one-sentence finished-surface invitation amendment; no other ADR text
    changes.
12. All new copy lives in `labels.ts`; no `.replace(`/`disabled` in `src/ui`.
13. E2E: 29 specs rewritten/extended for the two-surface world (target ≥ 32); `npm run typecheck &&
    npm test && npm run check:boundaries && npm run build && npm run test:ui` green.

## Evidence required

- plan_approval: exempt — `mode: direct`; the plan is the operator's v5 (12) + v6 (2) tour rulings +
  this order.
- pr_open: PR URL, head sha (single PR).
- ci_green: all required checks `success`.
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged; `ROADMAP.md` `[x]` + `docs/tech-debt.md` updated (TD-038 closed;
  TD-037 narrowed — the load lines land, the Çizelge cap item is moot); the ADR-0012 amendment rides
  the same PR.

## Stop-and-ask gates

- The exact ADR-0012 r2 amendment sentence — confirm at PR review before merge.
- If the xterm-per-active-step mount proves to lose scrollback the operator expects on finished
  steps (the transcript expansion is the designed fallback), surface it at PR review rather than
  inventing a hidden keep-alive.

## Notes

Created 2026-08-18 in the final-tour session; restructured same day after the operator's structure
feedback ("Apple gibi… çok sekme var… hala tam final değil") — v5's 12 rulings were captured in the
morning, v6's structure round (8 frames, D3 skin, `Omurga + Kayıt` picked over single-surface and
4-tab variants) in the afternoon; Y-2 = Çizelge dies, Y-3 = the names. Hand-numbered WO-0031f on
purpose (TD-035). Two honest deviations, both the operator's calls: Y1 = D3 (the tour suggested D1),
and the awaiting-close platform keeps a single CTA. The smooth-scroll CSS-route rule survives for
the substrip N/T jump; the two-tab world makes S3 nearly moot. `durationMs` rides the existing
`getWorkOrders` payload (TD-036). E2E's tab-scroll spec (WO-0031e) gets rewritten, not deleted — the
N/T jump keeps its coverage.
