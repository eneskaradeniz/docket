---
id: WO-0031c
title: Kontrol Konsolu v2 — kompakt detay ekranı
workspace: docket
status: implementing
mode: direct
review: light
tracks:
  - repo: docket
    depends_on: []
---

# WO-0031c — Kontrol Konsolu v2 — kompakt detay ekranı

## Objective

Replace Faz B's state-blind two-pane detail with the operator-approved v4 console
(`docs/ui-mockups/wo-0031-v4-kompakt.html`, commit 53d6e8a): a content-aware
strip/substrip/body/rail spine sized for the 980×620 default, one global SADE/DETAY
view, the card language (never raw JSON), a per-work-order permission rule, pre-approval
plan editing, audit surfaces (per-step ⏱/$ + a session ledger), a notification contract
(toast + window-title counter + OS notification), a working stop with wind-down, and the
P0/P1 repairs the audit filed (dead Durdur, closed-drawer contrast, empty rail sections,
Esc=back, aria-live turn line). Delivered as two PRs: c1 the layout spine + repairs +
E2E harness repair, c2 the rules, editing, audit and notification layer.

## Context

- Approved design: `docs/ui-mockups/wo-0031-v4-kompakt.html` (sizes, demos, copy-trim) and
  `docs/ui-mockups/wo-0031-v3-sade-detay.html` (lifecycle walkthrough).
- ADR-0001 (absent, not disabled), ADR-0006 (layering; vendor names only in adapters),
  ADR-0007 (labels.ts display copy; `woIdLabel`; repo docs English), ADR-0011 (CI gates).
- Prior phases: WO-0031a (board/shell/kit, PR #32), WO-0031b (detail two-pane, PR #33 —
  layout rejected by the operator, root cause `WorkOrderDetail.tsx` state-blind grid).
- Tech debt touched: TD-034 stays open (markdown-in-terminal out of scope). Numbering is
  operator-tracked (the CLI would renumber; see TD-035).

## Scope

In scope:

- Detail screen restructure (strip/substrip/body/rail, content-aware branching, DETAY
  tabs <1080px / 250px rack ≥1080px, empty sections absent).
- Global SADE/DETAY view mode, remembered; glow wash per state (static, reduced-motion safe).
- Button language: busy + locked states (no `disabled`), instant response, double-click lock.
- Per-WO permission rule (`ask_every` / `risky_excluded` "Riskli hariç" / `full_auto`);
  risky = CI workflows, lockfiles, agent configuration (CLAUDE.md, .claude/), sensitive
  files (.env*, *.pem, *key*, credentials*, secrets*), destructive shell (git push/remote,
  dependency installs, rm). Create-modal field, strip badge, ask-card one-click change,
  Settings default, timeline audit.
- `updateWorkOrder` API + inline title/description editing + review mode from the strip.
- Pre-approval plan editing (aim, role, ▲▼ order, add/remove) with "düzenlenmiş onay".
- Audit: per-step ⏱/$ on step cards; session ledger (Oturum|Rol|Zaman|Süre|Maliyet + total)
  in archive/DETAY; timeline events carry their clock.
- Notification contract: toast (3 kinds; on-screen results are never toasts), window title
  "(n) izin bekliyor", OS notification on background asks, board lamp.
- Stop wind-down (visible cost freeze, synthetic terminal notes, force-kill after 5s stuck),
  step-fail red card with retry, diff peek on write-permission cards, ⏎ on approve/allow,
  close WITHOUT ⏎, create-modal `Oluştur ve plan iste ⏎`.
- E2E: A6 harness repair, new seeds, fake-runner under DOCKET_E2E, per-behavior specs.

Out of scope:

- Specialization profiles (role+profile two-layer model) — WO-0032.
- Faz C: measured contrast, micro-copy sweep, state×width E2E matrix, ADR-0012 +
  ROADMAP closure — WO-0031d.
- Markdown rendering inside the terminal (TD-034); board redesign beyond the contrast fix.

## Acceptance criteria

1. The detail screen renders the v4 spine (strip, substrip, body, rail); the layout adapts
   to the phase, and a closed work order shows no action rail.
2. In DETAY below 1080px the sections are tabs (Terminal · Adımlar · Kanıt · Çizelge ·
   Belgeler, Denetim in c2); at ≥1080px a 250px rack; a section with nothing to show is
   absent (no tab, no header).
3. SADE/DETAY is one app-wide toggle in the strip, survives reload, and defaults to SADE.
4. StepPane/ReviewPane contain no `onClick={stop}` (the dead window.stop path); exactly one
   working Durdur per running drive, in the rail.
5. A new work order offers the permission rule (default from Settings, three options named
   Her seferinde sor / Riskli hariç / Tam otomatik); the strip shows the rule; changing it
   from the ask card persists it and logs a timeline event.
6. Under `risky_excluded`, a risky write (e.g. `.github/workflows/*`, `.env*`, a lockfile,
   `CLAUDE.md`) asks; an ordinary in-scope write does not. `npm run typecheck` is not risky;
   `npm install` and `git push` are.
7. Title/description/review-mode edits persist (order.md + DB title) and log `wo_edited`.
8. Before approval the plan's steps are editable (text, role, order ▲▼, add/remove, min 1);
   approving N changes logs `plan_approved` with the edited count.
9. A closed WO shows the session ledger with a correct total row; step cards carry ⏱/$.
10. A background ask produces a toast + `(n) izin bekliyor` title + OS notification; an
    on-screen action never produces a toast.
11. Stop shows wind-down, freezes cost visibly, offers Sürdür; a stuck stop offers Zorla kes
    after 5s; a failed session shows the red card with Yeniden dene.
12. `npm run typecheck && npm test && npm run check:boundaries && npm run build &&
    npm run test:ui` all green; no `disabled`/`.replace(` in `src/ui`; E2E screenshots are
    named by the screen they actually capture.

## Evidence required

- plan_approval: exempt — `mode: direct`; the approved plan is the v4 mockup tour
  (`docs/ui-mockups/`, commit 53d6e8a) plus this order.
- pr_open: PR URL, head sha (PR c1 and PR c2).
- ci_green: all required checks `success`.
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha).

## Stop-and-ask gates

- (none)

## Notes

Created 2026-08-16 from the mockup tour session (operator decisions: two PRs c1/c2; risky
set includes sensitive files; ▲▼ ordering; create+plan single step). Hand-numbered WO-0031c
on purpose — the CLI's `nextWorkOrderNumber` counts decision-store dirs and would renumber
(TD-035).
