---
id: WO-0036
title: İş emri form hataları — under-field validation in both WO dialogs + textarea heights
workspace: docket
status: closed
mode: direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0036 — İş emri form hataları (under-field validation, both WO dialogs)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

The two work-order dialogs join the form contract WO-0033 gave the workspace dialog: a validation
error renders UNDER the field that caused it (persistent while invalid, cleared on typing,
`role="alert"`), a failed submit focuses the first invalid field, and the footer's single line is
save failures only. The edit dialog drops its validity-locked Kaydet (locked is for in-flight and
terminal states, never validity) and pays four defects the UX review found: the silent
description-clear refusal, the stale description left by Vazgeç, the missing `catch` on the
store-throwing update path, and the hand-rolled labels duplicating kit `Field`. Both "Açıklama /
hedef" textareas grow one row (3→4 create, 5→6 edit — the Dialog's `max-h-[86vh]` + internal scroll
keep the 760×480 fit). Required-ness is marked the minority way (NN/g): `aria-required` on the
title inputs, one "(isteğe bağlı)" suffix on the single optional free-text label; no asterisk, no
legend.

## Context

- src/ui/chrome/WsSettingsModal.tsx:5-8 — the reference contract ("form errors sit under the field
  that caused them…; the footer's single line is save failures only"); its submit (296-319) is the
  validate-in-visual-order + focus-first-invalid model.
- src/ui/kit/Input.tsx:23-33 — kit `Field`'s error slot (`role="alert"`, WO-0033 comment).
- src/ui/chrome/WoCreateModal.tsx — footer `mr-auto` error span (97), submit-time title guard with
  no focus/clear (66-69), `rows={3}` (110); Radix steals open-focus (no `onOpenAutoFocus`).
- src/ui/components/detail/DetailStrip.tsx:69-85, 198-235 — the edit dialog: no error state,
  `locked={saving || !title.trim()}` (208), catch-less `save()` (77-85), `closeEdit` resets title
  only (73-76), description patch sent only when non-empty (80) — a cleared description is silently
  ignored though core supports the empty write (src/core/order-md.ts:96-105; prompts degrade
  gracefully, :120).
- docs/adr/ADR-0001 (absent-not-disabled; the 2026-08-18 `locked` addendum), ADR-0012 (interaction +
  copy contract — this order's amendment records the form-error placement as contract).
- WO-0033 (the pattern's origin), WO-0035 (the label bundles this order edits).
- e2e/ui.mjs:1024-1088 — the workspace validation spec this order's two new specs mirror.

## Scope

In scope:

- WoCreateModal: `titleErr` + `titleRef`, `Field error` slot, clear-on-typing, focus-on-failed-submit,
  footer span gains `role="alert"` (save failures only), `onOpenAutoFocus` fix, `aria-required`,
  chip glyph `aria-hidden` + context-chip `key={p}`, `rows={4}`.
- labels tr/en: `woDescLabel` → "Açıklama / hedef (isteğe bağlı)" / "Description / goal (optional)";
  `woEditTitleLabel`/`woEditDescLabel` deleted (edit dialog reuses `woTitleLabel`/`woDescLabel` +
  the create placeholders).
- DetailStrip edit dialog: kit `Field` for both fields (ids/autoFocus/`onDialogOpenAutoFocus`
  preserved), `titleErr` + focus, `locked={saving}` only, `catch → UI.saveFailed` footer line,
  `closeEdit` resets description + error state, description patch becomes difference-based
  (clearing saves empty — operator ruling 2026-08-21), `aria-required`, `rows={6}`.
- E2E: two specs (create: empty-title refusal under the field + focus + no WO created + clears on
  typing; edit: Kaydet stays clickable on an empty title → error + focus + dialog open, then
  description clear-to-empty saves and restores).
- docs: ADR-0012 dated amendment (form-error contract; validity never locks a submit), CLAUDE.md
  one bullet under the ADR-0012 section, ROADMAP tick at closure.

Out of scope:

- The ▸/＋ add-reveal glyph unification and Enter-to-submit (`<form>`) — deferred to a later UI
  pass (operator ruling 2026-08-21).
- Any core/adapters change (the empty-description write is already supported; this order only
  stops the UI from swallowing it).
- Splitting "Açıklama / hedef" into two fields (the data model is one Objective string).

## Acceptance criteria

1. Create dialog: submitting with an empty title shows "Başlık gerekli." under the Başlık field
   (`role="alert"`), focuses the title input, creates nothing, and the line falls once the user
   types — E2E.
2. Create dialog: the footer line carries only save failures and announces (`role="alert"`).
   *(Superseded by the 2026-08-21 review round: save failures toast top-right as hata — a dialog
   footer carries no error copy at all.)*
3. Edit dialog: Kaydet is never locked for validity; an empty title on save shows the same
   under-field error + focus and the dialog stays open — E2E.
4. Edit dialog: clearing the description and saving persists the empty Objective (re-open shows
   empty); Vazgeç/ESC resets both fields and the error state — E2E for the clear; code-review for
   the reset.
5. Both title inputs carry `aria-required="true"`; the description label reads "(isteğe bağlı)" in
   tr and "(optional)" in en; `woEditTitleLabel`/`woEditDescLabel` no longer exist in either bundle.
6. Textareas: create `rows={4}`, edit `rows={6}`; the 760×480 fit spec still passes.
7. `save()` failures surface `UI.saveFailed` (no unhandled rejection on a closed-WO store throw) —
   as a top-right error toast per the review round, not the edit footer.
8. ADR-0012 carries the dated amendment; CLAUDE.md carries the bullet; ROADMAP ticked at closure
   with the merge sha.
9. CI green: typecheck (both), test, build, check:boundaries, test:ui (42 specs, zero renderer
   console errors).

## Evidence required

- plan_approval: (mode: direct — waived, WO-0005 precedent)
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: reviewer report, `path:line` pointers resolve at head sha
- closure: merged, `ROADMAP.md` updated (commit sha)

## Stop-and-ask gates

- The description-clear ruling was asked and answered (2026-08-21: clearing allowed, saves empty).
  No other gate; anything unexpected stops the session and reports.

## Notes

- The pattern is ported, not reinvented: every mechanic already ships in WsSettingsModal.
- The edit dialog does not unmount on close (DetailStrip stays mounted) — explicit reset in
  `closeEdit` is load-bearing, unlike the create modal which resets by unmount.
- Deferred (operator): glyph unification, Enter-to-submit.

## Closure

Merged PR #42 (`d60d39e`), one PR, 4 commits: the order, the compile-coupled feature commit (both
dialogs + the label collapse — deleting `woEditTitleLabel`/`woEditDescLabel` only compiles with
DetailStrip's Field rewrite in the same commit), the E2E round (+2 specs, the two WO-0036 shots), and
the ADR-0012 decision + CLAUDE.md bullet. CI green on the PR (check + GitGuardian); locally
typecheck ×2, 497 tests, build, boundaries, E2E 42/42 with zero renderer console errors. The two
operator rulings taken mid-flight: description clearing saves empty, and required-ness is marked the
minority way. Deferred to a later UI pass: the ▸/＋ glyph unification and Enter-to-submit.

**Review round (2026-08-21, same evening):** the operator reversed the footer-line form — save
failures now surface as a **top-right error toast** (hata, persistent, manual close) in all three
dialogs that had footer copy (create, edit, and WsSettingsModal — the pattern's own birthplace).
A dialog footer carries no error copy, period; the field line (the form's refusal) and the toast
(the environment's refusal) answer different failures. ToastHost's caller rule gained the named
exception; the z-ladder already placed floaters (z-80) above dialog overlays (z-40/70), so the toast
shows over an open dialog. ADR-0012's decision and the CLAUDE.md bullet updated with the ruling.

_Closed 2026-08-21 at d60d39e (review round: footer → toast)_
