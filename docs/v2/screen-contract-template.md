# Screen contract (template)

A screen contract fixes what one screen must do and measure, so acceptance never depends on a
screenshot. Judgment = a11y snapshot + `getBoundingClientRect` measurements + interaction
results (operator decision, 2026-10-07). One contract file per screen.

## Purpose

One short paragraph: what the screen is for, who reaches it, what "done" means for the user.

## States

Every state the screen can be in. A state is accepted when its a11y snapshot shows the row's
content — no pixel judgment.

| State | Trigger | Must show (a11y-verifiable) |
| ----- | ------- | ---------------------------- |
| empty | … | … |
| loading | … | … |
| error | … | … |
| populated | … | … |

## Structure

Read from the a11y snapshot (`e2e/.out/a11y/*.json`), never from pixels:

- role and accessible name of every region of the screen;
- the accessible name of **every** interactive element (button, link, input, tab, switch);
- focus order where it carries meaning (Tab, arrow keys);
- all copy from the label bundle (Turkish default, English peer locale); no inline copy.

## Measurements

| Element | getBoundingClientRect | Expected range | Radius token |
| ------- | --------------------- | -------------- | ------------ |

Rules: every interactive target is at least 24×24 CSS px (WCAG 2.5.8; a rule introduced by this
template, not inherited from earlier docs); no element crosses the viewport bounds (overflow is
a FAIL); corner radius only from `rounded-control` (6px), `rounded-card` (8px), `rounded-panel`
(12px), plus `rounded-full` for lamps and round badges.

## Interactions

| Step | Expected result | Evidence |
| ---- | --------------- | -------- |

Evidence per step: an a11y snapshot after the step, a measurement, or a page/console-error
check — never a screenshot.

## Evidence

- Walk: `npm run test:ui:report` → `e2e/.out/report.json` + `e2e/.out/a11y/*.json`.
- `report.json` `run.commit` MUST equal the PR head commit (the operator's merge hook enforces
  this for UI PRs); layout audit 0 FAIL; no page or console errors; permitted FAILs: the J-1
  allowlist (`~/.claude-hybrid/state/known-fails.json`) only.

## Golden reference

The measurement report of the screen the operator approved ("tamam"). Frozen once, dated,
immutable. A later change to the screen is accepted only if its measurements stay inside the
golden ranges; a delta needs operator approval and becomes the new golden (the old entry stays,
dated, for comparison).

## Open findings

| Id | Measurement | Expected | Actual | Status (pass/open) |
| -- | ----------- | -------- | ------ | ------------------ |

A finding closes when a re-walk of the fixed commit measures inside the expected range; the
row flips to `pass` with the evidence commit noted.

---

## Filled example — Hesaplar (Accounts), pilot walk 2026-10-07

**Purpose.** Show provider accounts and their quota pools; adopt accounts; read per-account
limits. Reached from the sidebar.

**States.** loading = scanning skeletons (staggered groups); populated = equal account cards
grouped by provider, five-account fold in the sidebar; empty = fresh data dir, no accounts
yet; error = probe failure (row TODO(pilot): trigger not yet walked).

**Structure** (names from the a11y snapshot; TODO(pilot) rows await the pilot walk):

- sidebar region with the "Hesaplar" item; main region, heading "Hesaplar";
- per account card: provider + account name, a "Limitler" button (accessible name TODO(pilot));
- limits popover: role and per-pool meter names TODO(pilot).

**Measurements.** Account card 216×56, `rounded-card` (8px); Settings dialog `[56,48,1040,624]`,
`rounded-panel` (12px); "Ekle" buttons 46.2×28.8; no page overflow (walk window 1152×720).
Popover rows wait on the F2 fix — measured into the golden once the operator approves the
screen.

**Interactions.** open Hesaplar → grouped cards (a11y snapshot) · "Limitler" → popover opens
inside the viewport (measurement) · rescan → skeleton → populated (a11y before/after).

**Evidence.** ui-walk 2026-10-07 via `launch-cdp` against `~/.docket-test`, walk window 720px
high; `e2e/.out/report.json` (`run.commit` = PR head when this contract rides a PR).

**Open findings.**

| Id | Measurement | Expected | Actual | Status |
| -- | ----------- | -------- | ------ | ------ |
| F1 | narrowed Hesaplar section content | content hidden by narrowing is neither focusable nor clickable | content stays focusable/clickable | open |
| F2 | limits popover bottom edge | popover fully inside the viewport (bottom ≤ 720 in this walk's window) | bottom edge 827.8 → 107.8px below the viewport | open |
| F4 | `docket:event` listener count | no listener-leak warning | MaxListenersExceededWarning at 11 listeners | open |
| F8 | sidebar icon buttons "Projeleri sırala" / "Yeni proje" / "Kullanımı yenile" | ≥ 24×24 | 22×22 each | open |
