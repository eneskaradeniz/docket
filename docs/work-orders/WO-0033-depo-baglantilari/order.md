---
id: WO-0033
title: Depo bağlantıları — Defter rows, inline field errors, vocabulary pass
workspace: docket
status: open
mode: plan
tracks:
  - repo: app
    depends_on: []
---

# WO-0033 — Depo bağlantıları (workspace settings: Defter rows, inline errors, vocabulary)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

The workspace settings modal's repo section becomes the operator-selected "Defter" design
(docs/ui-mockups/ws-repos-v1.html §A): every connection is a two-line row — basename on top, full
mono path below — and the row is a live surface: the path is editable in place (name locked), the
connection is removable (confirmless, three guards). Form errors move from the single footer slot
to the field that caused them (persistent while invalid, first-invalid focused on submit). The UI
vocabulary completes its Turkish pass: repo → depo, "Workspace ayarları" → "Çalışma alanı
ayarları". Create and edit share one row anatomy — the current two-anatomy split (dead basename
rows in edit vs editable rows in create) dies.

## Context

- docs/ui-mockups/ws-repos-v1.html — the visual contract. §A (Defter) is operator-selected
  (2026-08-21, among A/B/C); §0 records the error-display decision (inline field errors; toast
  rejected on the ToastHost rule). B (çipler) and C (terminal listesi) remain in the file as the
  rejected alternatives.
- src/ui/chrome/WsSettingsModal.tsx — the surface: the single footer error slot (~line 118),
  edit-mode dead basename rows, the `for…await addRepoConnection` batch on save, the decision-store
  select that never shows the saved value.
- src/core/types.ts — `Workspace.repos: RepoId[]` carries basenames only; full paths live in the
  store's `connection` table (src/adapters/store/schema.ts). Reading paths in the UI needs a new
  port — the precondition for everything else in this order.
- src/core/source.ts:70-71 — `addRepoConnection` / `removeRepoConnection` exist; `repoConnections`
  (read) and `updateRepoPath` are new. Core is test-first (ADR-0006).
- WO-0032's confirm-vocabulary ruling: the 440px narrow confirm is for irreversible cascades; repo
  removal sits below it (re-adding = typing a path) — confirmless with guards, operator-approved
  in the design session.
- ADR-0007 (all copy in labels.ts), ADR-0012 (interaction: hover via `.ibtn` only, empty = 1 line +
  ≤1 action), ADR-0001 (guards render absent + reason), ADR-0009 (at repo-connection level the
  disconnect-only stance survives — removal never touches repo code), ADR-0006 (layering; the ports
  live in core, the SQLite in the adapter).
- The designer-agent audit (2026-08-21, 13 findings) — the in-scope findings are folded into the
  ACs; the out-of-scope ones are listed in Notes.

## Scope

In scope:

- core ports: `repoConnections(wsId): {id, path}[]`; `updateRepoPath(wsId, repoId, newPath)` —
  throws when the new path's basename ≠ the RepoId (identity is the basename; a different name is a
  different repo); port doc comments; test-first.
- store adapter: both implementations; basename-collision refusal on add (a second repo with the
  same basename errors instead of the silent INSERT OR REPLACE collapse that loses it today).
- UI (WsSettingsModal, both modes): Defter rows (two-line: basename + full mono path,
  middle-truncated with the full path in `title`); a leading ✓/! validity glyph (the two-✕
  ambiguity dies); ✎ inline path edit (Enter/blur commits, name locked, inline error on a basename
  change); ✕ confirmless removal with the three guards; the add row keeps Ekle + Klasör;
  `● karar deposu` marks the decision-store row; edit mode commits repo changes per action
  (add/edit/remove fire immediately — no staged batch on Kaydet; Kaydet applies name + decision
  store only).
- UI errors: field-adjacent lines via `Field`'s error slot (src/ui/kit/Input.tsx:29 — exists,
  unused today); persistent while invalid, cleared on edit; a failed submit focuses the first
  invalid field; a valid draft path left in the add row is absorbed into rows before validation
  runs; save failures stay the footer's single line; Kaydet/Oluştur gain the busy lock; error
  lines carry `role="alert"`.
- the decision-store select reflects the saved value on open (edit mode; today it always shows
  `allRepos[0]`).
- labels.ts vocabulary pass + the section's new strings.
- E2E: path display in edit mode, removal guards, path edit, inline errors, draft absorption.

Out of scope:

- En/tr selector (M3.5).
- RepoId derived from the git remote instead of the basename (the root fix for basename collisions
  — an adapter-level identity decision; its own order if wanted).
- WoCreateModal functional fixes (zero-track WO validation; context chips basename-only) — only
  its labels ride the vocabulary pass; see Notes.
- transactions for multi-write sequences (TD-021 keeps the class).
- toast changes of any kind (the ToastHost contract is untouched).

## Acceptance criteria

1. Edit mode lists connections as two-line Defter rows: basename + the `connection.local_path`
   full mono path (middle-truncated, full path in `title`) — proven by store test + E2E.
2. `repoConnections(wsId)` returns `{id, path}[]` from the connection table (core port + adapter
   test).
3. `updateRepoPath` rewrites `connection.local_path` only; a path whose basename differs from the
   RepoId throws and changes nothing (test).
4. Removal is confirmless (✕) and absent-with-reason when the repo is (a) the decision store,
   (b) referenced by an open WO's track, or (c) the last remaining repo — E2E covers (a) and (c).
5. Create and edit render the SAME row anatomy; create rows carry the leading ✓/! glyph and the
   same affordances (paths stay local state until Oluştur).
6. Errors: `wsErrName` renders under the Ad input; an invalid typed path renders its line under the
   owning row/field; both persist while invalid and clear on edit; a failed submit focuses the
   first invalid field; a valid draft is absorbed into rows before validation runs; save failures
   remain the footer line; Kaydet/Oluştur carry the busy lock; error lines carry `role="alert"`.
7. The decision-store select opens showing the saved decision store (edit mode).
8. Vocabulary (labels.ts): `wsSettings` → 'Çalışma alanı ayarları'; `wsReposLabel` → 'Depo
   bağlantıları'; `wsRepoPlaceholder` → 'yerel depo yolu'; `wsErrRepo` → '…depo yolu…';
   `woTracksLabel`/`secTracks` → 'Depolar'; `woContextLabel` → 'Bağlam dosyaları';
   `ACTION_LABELS.merge_track` → 'Depoyu birleştir'; `ABSENT_REASON_LABELS.depends_on_open` →
   'Bağımlı depo merge olmadı'; `UI.stepBlockedHint` → 'kapsam bir depoyla eşleşmiyor'.
   PR/CI/ADR/ROADMAP/order.md stay (domain shorthand, never translated). Review check: no display
   word 'repo'/'workspace'/'track' remains in labels.ts.
9. A basename collision on add refuses with an inline line ('Bu adda depo zaten var.') — store
   test: two same-baseline paths → error and one row (no silent swallow).
10. CI green: typecheck (both tsconfigs), test, build, check:boundaries, test:ui (+ the new E2E
    specs).

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at head sha
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

- Per-action commit in edit mode (the order's stance: repo adds/edits/removals fire immediately;
  Kaydet applies name + decision store only) — the architect may propose staged-then-Kaydet
  instead; operator decides.
- Guard (b) semantics: an OPEN WO's track blocks removal; closed-WO references do not (history
  keeps the basename string) — data-loss stance, recorded as a decision.
- The vocabulary table touching `ACTION_LABELS.merge_track` (rendered nowhere today — the
  ADR-0012 r4 de-jargon note anticipated exactly this change).

## Notes

- Adjacent audit findings NOT in this order (a later small pass, or fold-in at review):
  WoCreateModal allows a zero-track WO (a degenerate pipeline object); its context chips show
  basename only (the `title` attribute is a free fix the implementer may take); ESC discards modal
  edits silently (single operator, short form — accepted unless the operator says otherwise).
- The evidence strings that interpolate repo names (`evdPrMissing · ${repo}` etc.) are data and do
  not change; only fixed words change.
- Ordering: the operator pencilled profiles next; that work shifts to WO-0034.
