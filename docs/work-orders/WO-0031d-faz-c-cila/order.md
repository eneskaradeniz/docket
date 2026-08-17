---
id: WO-0031d
title: Faz C — kural kitabı (ADR-0012), boş durumlar, diyalog akışları, juice
workspace: docket
status: closed
mode: direct
review: light
tracks:
  - repo: docket
    depends_on: []
---

# WO-0031d — Faz C — kural kitabı (ADR-0012), boş durumlar, diyalog akışları, juice

## Objective

Close Faz C with the operator's post-0031c tour findings folded in. Codify the pending design-system
decision as ADR-0012 — one interaction contract, empty states as invitations, no explainer copy, no
jargon headers, no standing keyboard hints, a density band, a juice contract — and enforce it in the
codebase in the same pass: the empty surfaces become invitations (real appbar on an empty DB, hero
board), the edit/delete/close flows become kit dialogs that stand down while a drive is live, the
defined-but-unwired juice lands on step-status transitions and a closure results card, and the
pre-merge review's P2 fast-follows ride along (title-counter assert, "Adım 0", plan-retry resume,
fresh-file diff-peek, risky case-blindness, the ADR-0006 CI carve-out documented).

## Context

- The operator's tour rulings (2026-08-17, recorded in the 0031c closure session) are the spec:
  packages A–D below are fixed; ADR-0012 is the decision they were waiting for.
- `docs/ui-mockups/wo-0031-v4-kompakt.html` §7 Juice (rules: <400ms, prefers-reduced-motion, cost
  counter never animated, "SADE sakin kalır; juice DETAY ve sonuç anlarında yaşar").
- ADR-0001 (absent, not disabled — extended here from actions to empty surfaces), ADR-0007 (all copy
  in `labels.ts`; repo docs English), ADR-0011 (CLAUDE.md carries rules; a convention change updates
  CLAUDE.md and the ADR together).
- WO-0031c (`docs/work-orders/WO-0031c-kompakt-detay/order.md`) delivered the console this polishes;
  its Out-of-scope named this WO. TD-037 names this WO payer for the closure seal, scroll-margin and
  comment-rot items.
- Operator rulings this session: single PR; "Repolar" replaces the Track display words; the
  review-cadence badge joins Düzenle/Sil behind the live-drive gate (same order.md write path).

## Scope

In scope:

- **ADR-0012** + the enforcement sweep: semantic interaction classes (`.ibtn`/`.irow`/`.ichip`) as the
  one hover contract; the labels.ts micro-copy sweep (explainer paragraphs and dead keys deleted,
  informative lines kept, `TRACK'LER (ILGILI REPOLAR)` → `Repolar`, the standing `esc geri` hint
  deleted); density band (gaps 12–14px, board ≤840px, detail ≤1160px); CLAUDE.md pointer.
- **Empty states**: AppShell brand + the normal Settings on an empty DB (the bare second header with
  the ⚙ glyph dies); empty-DB and zero-WO invitation heroes ("Haydi ilk iş emrini açalım" + one CTA);
  buckets/closed-drawer absent at zero items; board intro line removed.
- **Detail safety + dialogs**: while a drive is live (`running || stopping`) the pencil, trash and
  review badge are absent with one reason line ("önce oturumu durdur"); Düzenle/Sil/Kapat move to kit
  Dialogs (screen intact; rail decisions and the objection stay put; Kapat keeps its no-⏎ rule —
  the global ⏎ stands down while a dialog is open).
- **Progress + juice**: step segment indicator (`adım N/T` + filled cells) in the substrip; step-row
  transition flash + drawn ✓ + mini fill (never on mount); closure results card (seal + Süre/Maliyet/
  adım/kanıt/inceleme stats, pops once in-session, calm on reopen); terminal newline pulse only if
  the xterm decoration API allows it cheaply.
- **P2 folds**: `document.title` E2E assert; unscoped sessions named "Bağımsız" in the audit table;
  plan-stage retry/Sürdür resumes the persisted architect session; fresh-file diff-peek returns
  all-adds (root jail intact); risky basename/shell patterns case-insensitive; ADR-0006 addendum
  documenting the `claude.md`/`.claude` CI strip.
- E2E: empty-DB boot (second window, fresh DB path), invitation card, dialog editing, gated strip,
  results card, audit row; density change must not break the rack@1240/board@940 specs.

Out of scope:

- Specialization profiles — WO-0032.
- Measured contrast / color token changes; locale + theme selectors (M3.5).
- Çizelge virtualization and load skeletons (stay TD-037).
- The structural preload-arity fix (TD-036) — this WO changes no port signature.
- Board information architecture beyond the empty state and density.

## Acceptance criteria

1. `docs/adr/ADR-0012-console-interaction-contract.md` exists; `CLAUDE.md` carries its rules;
   `npm run typecheck && npm test && npm run check:boundaries && npm run build` green.
2. On an empty DB the real AppShell renders (brand + the normal Settings gear); the screen is one
   hero line + exactly one CTA (workspace create); no second header, no glyph button.
3. A zero-WO board renders the hero line + one CTA (work-order create) and nothing else — no bucket
   headers, no dashed boxes, no closed drawer; the board intro line is gone everywhere.
4. While a drive is live (wind-down included, `stopped` excluded) the strip shows neither pencil,
   trash nor review-badge button — one quiet reason line instead; nothing is greyed or locked.
5. Düzenle, Sil and Kapat are kit Dialogs over an intact screen; the rail decisions and the inline
   objection are unchanged; Enter in the Kapat note input submits nothing and the global ⏎ never
   fires while a dialog is open.
6. A step completing in-session flashes its row green and draws the ✓; a blocked step flashes red;
   each row carries a mini fill that fills when done; nothing animates on mount, reload, or a
   SADE↔DETAY remount; SADE mode stays calm.
7. The substrip shows `adım N/T` + filled segments whenever a plan has steps; `esc geri` is rendered
   nowhere (esc still works).
8. Closing a work order in-session shows the results card — seal + Süre · Maliyet · adım · Kanıt ·
   İnceleme — popping once ≤400ms, static under reduced motion; reopening an already-closed work
   order is calm; the ledger remains the archive body.
9. An unscoped implementer/verifier session renders "Bağımsız" in the audit table (never "Adım 0");
   the risky classifier matches `.ENV`, `NPM INSTALL` and `GIT PUSH` (case-insensitive), and the
   `*key*` suffix rule is pinned by a case test.
10. The stopped_asking E2E spec asserts the `(n) izin bekliyor` window title; plan-stage retry and
    Sürdür resume the persisted architect session; a fresh-file diff-peek shows an all-adds diff
    behind the same root jail; ADR-0006 carries the CI-strip addendum.
11. Every interactive surface answers hover through the semantic classes or kit variants — no
    zero-hover clickable, no hand-rolled `hover:*` on ad-hoc buttons outside the noted exceptions
    (card lift, text-link underline).
12. `npm run test:ui` green locally with the new specs; screenshots named by the screen they capture;
    no `disabled`/`.replace(` in `src/ui`.

## Evidence required

- plan_approval: exempt — `mode: direct`; the plan is the operator's tour rulings + this order.
- pr_open: PR URL, head sha (single PR).
- ci_green: all required checks `success`.
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (TD-037 narrowed; commit sha).

## Stop-and-ask gates

- (none)

## Notes

Created 2026-08-17 in the fresh WO-0031d session. Deviations worth naming at review time: `StepCard`
is deleted as dead code (only `RoleChip` was ever imported — the live status surface is `StepList`);
the review badge joins the live-drive gate (operator-approved extension); the mockup's 0.6s sealpop
is capped at 400ms per the juice rule. Hand-numbered WO-0031d on purpose (TD-035).

Pre-merge fixes (operator review of PR #36): Kapat now closes its dialog on success (the error branch
stays open for retry) + an E2E assert that it does; all transition juice trimmed to ≤400ms (flash,
pulse, the flash window) with the lamp-breathe loops named as ADR-0012's ambient exemption; the
reduced-motion block gains the Dialog rise (now a named class, not an arbitrary utility) and the
interaction-class transitions. The review's remaining P2s are filed as TD-038.

Tur-2 fixes (operator's second tour, all decisions embedded): A1 `TurnState` gains `done` (test-first)
— a closed WO reads "Kapandı", never a false "Sıra sende"; A2 the kit TabsContent hides inactive
panels (forceMount keeps them alive — the tab bar visually did nothing before); A3 the closure sha
renders as 7 chars (full sha in title/aria, click copies); A4 the ```steps fence never renders raw —
Belgeler shows prose + a role-chip card summary (`splitStepsFence`, core, test-first); A5 Terminal +
markdown panel padding; A6 the edit dialog's description textarea is 5 rows; A7 the substrip `adım
N/T` is a real jump (DETAY + Adımlar tab + scroll, controlled tab state). D1 a board with only closed
WOs is the "Bütün işler tamam" platform (steady green dot, quiet cards OPEN, no drawer, no CTA). D2
Kanıt becomes chips with a `n/total` aside — absence sentences instead of marks, repo-name suffixes,
no panel box. D3 TrackLane + the Repolar section are deleted; the track state folds into Kanıt chips
(✓ Depoda / PR açık · CI yeşil / henüz PR yok / CI muaf); the dead onClick-less 'Mergele' chip is
gone. Five more grep-proven dead label exports purged with them.

## Closure

Tamamlandı — tek PR (#36, `7dbd924`). ADR-0012 konsolun tek etkileşim sözleşmesi oldu: `.ibtn`/`.irow`/
`.ichip` hover token'ları, labels.ts açıklayıcı-cümle/jargon/kalıcı-ipucu temizliği ("Repolar"), 12–14px
yoğunluk bandı. Boş yüzeyler davet oldu (boş DB'de gerçek appbar + hero, sıfır-WO tahta hero'su, boş kova
başlıkları yok); Düzenle/Sil/Kapat kit diyalogları — sürü çalışırken tek sebep satırıyla yok (wind-down
dahil); adım juice'ı (flash, çizilen ✓, mini fill, `adım N/T` segmentleri) + kapanış sonuç kartı (mühür +
Süre/Maliyet/adım/Kanıt/İnceleme; bir kez, ≤400ms, reduced-motion güvenli); P2 katlanmaları (başlık sayacı
E2E assert'i, "Bağımsız" satırları, plan-retry Sürdür, fresh-file diff-peek all-adds, riskli desenlerde
harf büyüklüğü duyarsızlığı, ADR-0006 CI carve-out). Operatörün tur-2 turu aynı PR'de taşındı: A1–A7 kod
fixleri + D1 "Bütün işler tamam" platformu, D2 Kanıt chip'leri (n/toplam), D3 TrackLane ve Repolar bölümü
silindi. 464 test (+12); E2E 26 spec (+8). TD-037 daraltıldı; TD-038 (inceleme P2'leri) açıldı.

_Closed 2026-08-17 at 7dbd92464f0914050795d28e62a2543f1a0bad86_
