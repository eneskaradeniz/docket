---
id: WO-0070
title: "M3.5 artıkları — the string/colour grep lands + prompt overrides (the Settings-driven, app_setting-backed template seam)"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0070 — M3.5 artıkları — the grep + the prompt overrides

## Objective

M3.5's two remnants in one WO. (1) The grep: check-boundaries gains the hardcoded-copy and
literal-colour checks for `src/ui/` — the compiler drove the vocabulary into the bundles
(WO-0035); the mechanical backstop catches what a refactor drops back into a component.
(2) The prompt overrides: the four role prompt templates become Settings-editable —
`app_setting` rows, read at prompt-assembly time, the built-ins standing when no override
exists (the exact flow the M3.5 line names).

## Context

- **The grep's honest shape (greppable, deterministic, no JSX parser):** components must not
  carry display copy — the vocabulary lives in `src/ui/data/labels/` (ADR-0007). The cheap
  deterministic proxy for "a word a human reads" is NON-ASCII text: Turkish copy outside the
  bundles is exactly what the ban targets, and regex sees it perfectly. Literal colours are
  `#hex` / `rgb(`/`hsl(` literals in `src/ui/` (the tokens are `var(--…)`). Check 6 (`.replace(`)
  and check 5 (disabled) are the precedent's proxies — this adds c7 (literal colours) and c8
  (non-ASCII in ui minus the data/labels allowlist) to `scripts/check-boundaries.mjs`, each
  demonstrated on a deliberate violation before landing, the file allowlist explicit
  (`src/ui/data/` + `__tests__` + `.test.` files are the vocabulary's home and are exempt).
- **The prompt assembly chain (explored):** the constants live in `src/core/order-md.ts`
  (`architectPrompt` / `implementerPrompt` / `verifierPrompt` / `architectReviewPrompt`) +
  `roadmapDraftPrompt` (roadmap-draft.ts); the store's four assembly fns call them
  (`architectPromptFor` ~:1783, `buildStepPrompt` ~:1543, `buildStepReviewPrompt` ~:1565,
  `roadmapDraftPromptFor` ~:1720); the pipeline asks the store port (`session-store.ts:66-70,
  109`); the renderer sends nothing. An override flows: AppSettings get/set → `app_setting`
  row(s) → IPC → a Settings modal section → the assembly fns consult the override FIRST and
  fall back to the built-in.
- **The override's unit is the WHOLE template** (not micro-edits): the operator edits the full
  text of one named prompt; a parse-free plain-text row; absent = the built-in. The ADR-0017
  git-discipline paragraph rides INSIDE the implementer template — an override replaces the
  whole thing, and the Settings section says so (the built-in's current text is shown as the
  placeholder/reset material).
- **No display copy in components** — the modal section's words go through the bundles; the
  PROMPT TEXTS themselves are data (not UI copy) and may live as template constants.

## Scope

In scope:

- **The grep (scripts/check-boundaries.mjs):** check 7 — literal colour literals
  (`#[0-9a-fA-F]{3,8}\b`, `rgba?\(`, `hsla?\(`) in `src/ui/**` excluding `src/ui/data/` and
  test files; check 8 — non-ASCII characters (`/[À-￿]/`) in `src/ui/**` minus the
  same exemptions (the labels/marks home). Each check: implemented, run against the CURRENT
  tree (must be clean — fix any violation the grep finds by moving the copy into the bundles
  with label keys, tr/en), then demonstrated on a deliberate violation in the test run of the
  commit message (the WO-0006 discipline: every check shown to fail).
- **Prompt overrides (core test-first):** `app-settings.ts` — `getPromptOverrides():
  Promise<PromptOverrides | undefined>` / `setPromptOverrides(v | undefined)` on the
  AppSettings port; `PromptOverrides = Partial<Record<PromptKey, string>>` with
  `PromptKey = 'architect' | 'implementer' | 'verifier' | 'architectReview' | 'roadmapDraft'`;
  store: one `app_setting` row `prompt_overrides` (JSON, the model-preferences precedent),
  the concrete get/set; the four store assembly fns + `roadmapDraftPromptFor` gain the
  override-first lookup (a tiny pure helper in core: `withOverride(builtin, override)` — same
  string either way, pinned).
- **IPC + preload:** `docket:settings:get-prompt-overrides` / `set-prompt-overrides` (the
  budget/docs-root pattern); the bridge d.ts.
- **UI:** the Settings modal's new section (AppSettingsModal.tsx) — per PromptKey a labeled
  textarea (4 rows, mono), Kaydet persists all five at once, Vazgeç resets, the built-in
  reachable via a «Varsayılana dön» per-key clear (setPromptOverrides minus the key — the
  taskRef set/drop idiom); form-errors-under-field grammar; labels tr/en parity.
- **Tests:** the override-first assembly pins (store: an overridden implementer prompt carries
  the override text verbatim; absent override → byte-identical built-in — the EXISTING prompt
  tests become the fallback proof and must pass unmodified); the grep checks' violation
  demos; the settings round-trip pin.

Out of scope:

- Per-section template editing, variables/placeholders (the templates are whole-text);
  per-workspace overrides (app-global, like the models); history/versions of overrides;
  ADR-0017 discipline enforcement in overrides (the operator's text is the operator's text).

## Acceptance criteria

1. Checks 7 and 8 live in check-boundaries, the current tree passes, and each check is
   demonstrated failing on a deliberate violation (the demo files removed before the commit —
   the demonstration lives in the PR description's captured output).
2. The override round-trip: set → assembly uses it → clear → byte-identical built-in (store
   pins); all four existing prompt tests pass UNMODIFIED (the fallback proof).
3. The Settings section edits, saves, clears per-key; labels parity tr/en; no disabled.
4. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries` (now
   10 checks).

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the "tüm işleri
  bitir" delegation, 2026-09-19).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19).
- ci_green: RESOLVED — green, 2026-09-19: typecheck (both tsconfigs), **1073 unit tests**
  (+10), build, `check:boundaries` **10/10** clean (the two new checks demonstrated failing on
  deliberate violations before landing; the tree was clean on first pass — zero fixes needed).
- pr_open / closure: RESOLVED — PR #75 (`https://github.com/eneskaradeniz/docket/pull/75`),
  head `25dbe77`, merged `24bfd51`; closed at this commit.

## Stop-and-ask gates

- A check that fails on the CURRENT tree at commit time (the grep lands CLEAN or not at all —
  fixing violations by moving copy into bundles is in scope; landing a red check is not).
- An override that reaches the agent through any path but the store's assembly fns.
- Prompt-override content injected into any NON-prompt surface.

## Notes

- Chain position: M3's tail (WO-0069) → **M3.5 (this)** → M4 machinery (WO-0071) → M5
  overview (WO-0072) → the operator's single test phase.
- The grep's exemptions are the design: `src/ui/data/` is the vocabulary's home — the check
  guards the BORDER, not the dictionary.
