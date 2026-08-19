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

Land the operator's final-tour rulings — three mockup rounds on one day (2026-08-18): the v5 tour
(12 rulings), the v6 structure tour (2 rulings, after "Apple gibi: daha az yüzey"), and the v7 feel
tour (3 rulings, after "her şey gerektiğinde… detayına baktığın belli olmalı… sıcak, animasyonlu,
oyunlaştırılmış, ödüllendirilmiş, kullanıcıyı çeken") — as one restructure + one feel pass: DETAY's
six tabs become **two surfaces (Akış | Kayıt)** with the live terminal inside the active step's row,
the **D3 "Sıcak"** direction pass over everything, the board's closed-list toggle + peron invitation
+ card durations, the closed work order made immutable (UI + store), the running-empty stream line,
the agreed tech-debt batch, and the v7 feel layer (owner-spotlight anchoring, reward moments,
entrance glides).

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
- **The v7 feel rulings (tour round three — operator: "her şey gerektiğinde olmalı… detayına
  baktığın belli olmalı… her şey değerli toplu olmalı… sıcak, animasyonlu, oyunlaştırılmış,
  ödüllendirilmiş, kullanıcıyı çeken"):**
  - **H-1: reward = the moment, not the meta-game.** No points, badges, or scores (ADR-0012 r7's
    "no meta-game" stands verbatim). Three one-shot reward moments: a step completing (pop + drawn-✓
    + green flash + row mini-fill + the strip hairline advancing + the substrip segment flipping),
    closure (the seal ceremony — sealpop once, only on a live close; stats never count up: money does
    not celebrate), and the day ending (the board's all-done arrival: one green wash pulse ≤400ms,
    then steady — a state transition, never a mount). Two ADR-0012-governed additions land inside
    the existing juice contract: the hairline advances on step completion (it already fills — this
    names the arrival) and the all-done pulse.
  - **H-2: the gaze anchor.** Opening a detail spotlights its owner: the row's surface raises, its
    state edge names it, and the report/transcript reveals under it in ≤200ms; sibling rows dim one
    notch by BACKGROUND only (text contrast untouched — the WO-0031c B4 lesson); closing restores
    calm. "Neye baktığın belli" — the detail always reads as belonging to its step.
  - **H-3: the entrance glide returns — as a NAMED exception.** A surface entering view (first board
    open, a tab switch) glides in once: ≤400ms, translate+fade only (no scale/rotation), staggered
    ≤40ms between siblings; re-renders and live appends stay motionless; reduced-motion kills it.
    This consciously REVERSES the v5 ".rise kaldırılsın" ruling — recorded here so the reversal is a
    decision, not drift.
  - **H-4: the substrip becomes a filled band carrying three values** (operator's spot note on v7
    §01: "● Sıra sende … adım 2/4 — orası üstü altı çok boş durmuyor mu?"). Treatment C of v7 §1b:
    a surface-tinted band, the turn label one notch bigger (12px), the MIDDLE carrying the current
    focus (the active step's aim, or the reviewed report's step — data the app already holds), and
    the right keeping segments + adım N/T. The line now answers sıra kimde · odak ne · ilerleme
    kaçta in one breath; it never sits empty while a focus exists. SADE keeps its calm line
    unchanged.
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
  - **F-kat = TD-038 (all five — item 1 resolves as the v7 glide exception, below) + TD-037 (Çizelge
    cap is MOOT — the section dies; the load lines remain)**; TD-034 stays OUT.
  - **F7 copy = "Oturum açıldı — çıktı bekleniyor"**.
- ADR-0012 governs every item; two amendments land (see Scope). Mockups are the approved design:
  `docs/ui-mockups/wo-0031-v5-final-turu.html` (35 frames) +
  `docs/ui-mockups/wo-0031-v6-yapi.html` (8 frames, D3 skin) +
  `docs/ui-mockups/wo-0031-v7-his.html` (7 frames, D3 skin, interactive feel demos) — where they
  disagree, v7 wins on feel, v6 on structure, v5 on the board/closure rules.

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
- **Feel layer (v7)**: owner-spotlight on detail expansion (raised surface + state edge + ≤200ms
  reveal + siblings dimmed by background only); the three one-shot reward moments wired end-to-end
  (step completion advances the strip hairline and flips the substrip segment; closure seal remains
  once-per-live-close; the board's all-done arrival pulses once, green, ≤400ms); the entrance glide
  (`glide` on surfaces entering view — first open and tab switch only, ≤400ms translate+fade,
  ≤40ms stagger, named reduced-motion kill) replacing `.rise`.
- **Substrip (H-4)**: the turn line becomes a filled band — `Substrip.tsx` + `labels.ts` (the focus
  text reuses the step aim; no new derivation): turn (left, 12px) · current focus (middle) ·
  segments + adım N/T (right); surface-tint background, one line, SADE unchanged.
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
- **ADR-0012 edits**: two one-sentence amendments — (1) r2: a finished surface may carry one
  invitation CTA beside its state line (the peron invitation is the named case); (2) r7: entrance
  glides are the named exception to "never on mount" (a surface entering view on first open or tab
  change may glide in once, ≤400ms translate+fade; re-renders, live appends, and reduced-motion stay
  motionless — the reborn `.rise`, now contractual).
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
10. StepList link uses `.alink`; pulse timer cleared on unmount; empty-DB E2E collects console
    errors; the named load lines replace bare "Yükleniyor…" — and `.rise` is reborn as the
    contractual `glide`: first open / tab switch only, ≤400ms, once, reduced-motion-killed.
11. Opening a detail spotlights its owner (raised surface + state edge, siblings dimmed by
    background only — text contrast unchanged) and reveals in ≤200ms; closing restores calm.
12. The reward moments are one-shot and composed as drawn in v7 §02 (step: pop+✓+flash+fill+hairline
    advance+segment flip; closure: seal once per live close, stats never animate; board: one green
    arrival pulse) — money never animates anywhere.
13. The substrip renders as a filled band carrying sıra · odak · ilerleme (turn label, current
    focus, segments + N/T); the middle never sits empty while a step/session focus exists; SADE's
    calm line is unchanged.
14. ADR-0012 carries exactly the two one-sentence amendments (r2 invitation; r7 entrance glide); no
    other ADR text changes.
15. All new copy lives in `labels.ts`; no `.replace(`/`disabled` in `src/ui`.
16. E2E: 29 specs rewritten/extended for the two-surface world (target ≥ 32); `npm run typecheck &&
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

- The exact wording of BOTH ADR-0012 amendment sentences (r2 invitation; r7 entrance glide) — confirm
  at PR review before merge.
- If the xterm-per-active-step mount proves to lose scrollback the operator expects on finished
  steps (the transcript expansion is the designed fallback), surface it at PR review rather than
  inventing a hidden keep-alive.

## Notes

Created 2026-08-18 in the final-tour session; restructured twice the same day on the operator's
live feedback — v5's 12 rulings (morning), then "Apple gibi… çok sekme var… hala tam final değil" →
v6's structure round (8 frames, D3 skin, `Omurga + Kayıt` picked over single-surface and 4-tab
variants; Y-2 = Çizelge dies, Y-3 = the names), then "her şey gerektiğinde… sıcak, animasyonlu,
oyunlaştırılmış, ödüllendirilmiş, çeken" → v7's feel round (7 frames; H-1 reward = the moment, no
meta-game; H-2 gaze anchor; H-3 entrance glide, reversing the v5 ".rise kaldırılsın" ruling
consciously). Hand-numbered WO-0031f on purpose (TD-035). Two honest deviations, both the
operator's calls: Y1 = D3 (the tour suggested D1), and the awaiting-close platform keeps a single
CTA. The smooth-scroll CSS-route rule survives for the substrip N/T jump; the two-tab world makes
S3 nearly moot. `durationMs` rides the existing `getWorkOrders` payload (TD-036). E2E's tab-scroll
spec (WO-0031e) gets rewritten, not deleted — the N/T jump keeps its coverage.

## Closure

PR #38 (`wo-0031f-final-turu`, tek PR; dokuz commit `36e6aea…fb1d576`). ROADMAP `[x]` + TD-038
closed / TD-037 narrowed + ADR-0012'in iki cümlesi `fb1d576`'de. Kapılar: typecheck (2 tsconfig) +
480 test + `check:boundaries` + build + `test:ui` 39/39 (hedef ≥32). Stop-and-ask ikisi de PR
gövdesinde operatöre sunuldu: ADR cümlelerinin tam metni + bitmiş-adım scrollback gözlemi. Dürüst
sapmalar PR'da listelendi: 'İş emirleri okunuyor…' tek mockup-dışı metin; Kaynaklar Kayıt kuyruğu
sonuna yerleşti; all-done nabzı çalışma-alanı hafızasıyla geçiş sayıldı (mount değil).
