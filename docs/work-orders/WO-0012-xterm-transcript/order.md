---
id: WO-0012
title: xterm.js transcript (terminal emulation, scrollback, styling)
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
tracks:
  - repo: app
    depends_on: []
---

# WO-0012 — xterm.js transcript

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Constraints (verified in code)](#constraints-verified-in-code)
- [Decisions](#decisions)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Replace the session pane's flat transcript list (`Transcript.tsx`, a `<ul>` capped at `max-h-64`) with an
**xterm.js terminal**: real terminal emulation, scrollback, and per-speaker styling. Closes TD-020 and the
last unchecked ROADMAP M2 bullet (line 53) — M2 is complete when this merges.

## Context

- `docs/tech-debt.md` TD-020 — "The live transcript is a simple list, not a terminal."
- `ROADMAP.md` M2 line 53 — `- [ ] xterm.js transcript (TD-020)`.
- `src/core/runner.ts` — `RunnerEvent` (structured: `assistant_text`/`tool_use`/`tool_result`/…), the
  `TranscriptLine` model, and `foldSessionEvent` (the pure event→state fold the pane renders). Unchanged.
- `src/ui/components/session/SessionPane.tsx:197-201` — the swap seam (`<Transcript entries={state.entries} />`).
- `src/ui/components/session/Transcript.tsx` — the flat list being replaced (deleted).
- `docs/adr/ADR-0006-layering-and-provider-independence.md` — core is pure/test-first; React components
  are run-verified.
- `docs/adr/ADR-0010-docket-observes-it-does-not-own.md` — the transcript is ephemeral; not persisted.
- `docs/adr/ADR-0007-display-text.md` — display vocabulary in `labels.ts`; `.replace(` banned in `src/ui/`.

## Constraints (verified in code)

- **The stream is structured, not ANSI.** No streaming deltas, no color codes. xterm's value here is the
  emulator + scrollback + **synthesized presentation styling** generated from the `TranscriptLine`
  discriminator — not faithfully replayed ANSI.
- **The transcript is ephemeral (ADR-0010).** In-memory UI state folded from the event stream; not
  persisted; blank on resume. The terminal is a live view, not a scrollback archive.

## Decisions

- **xterm.js** — the roadmap-named choice; fits a tool that drives CLI agents. Adds three renderer-side
  deps (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`), exact-pinned. No Electron/main/
  preload or vite config change (xterm is DOM-only, renderer-side).
- **Read-only display terminal.** Input stays the existing `<textarea>` + Start/Resume controls; the
  terminal is `disableStdin: true`. Making it a REPL/input surface is out of scope.
- **Synthesized styling via a core formatter.** A pure `formatTranscriptLine` in `src/core/` emits ANSI
  per speaker (test-first). Core cannot import `src/ui/`, so the tool→display-label mapping is injected
  (`{ labelFor }`); the wrapper passes `toolLabel`. This keeps display vocabulary in `labels.ts`
  (ADR-0007) and keeps all `.replace(`/escaping in core (the `.replace(` proxy is banned in `src/ui/`).
- **The transcript stays ephemeral.** No backfill from the provider's on-disk transcript on resume
  (ADR-0010). A fresh drive resets the terminal; resume appends the new stream to a blank terminal.

## Scope

In scope:

- `formatTranscriptLine(line, opts?)` in `src/core/transcript-format.ts` (test-first): `assistant` plain,
  `tool_use` dim-cyan label + detail, `tool_result` green / bright-red on error, `system` dim. SGR codes
  emitted directly; multi-line text preserved verbatim (the wrapper splits).
- An xterm wrapper component `src/ui/components/session/Terminal.tsx` (run-verified): mounts a `Terminal`
  with `FitAddon` + `WebLinksAddon`, refits on resize, consumes `entries` via a diff cursor, resets on a
  `resetKey` change (SessionPane feeds `state.sessionId`).
- `SessionPane.tsx` swaps `<Transcript>` for `<Terminal>`; the gating predicate and the "No session"
  branch are unchanged (ADR-0001). Delete `Transcript.tsx`; remove the orphaned `UI.transcriptEmpty`.
- The three `@xterm/*` deps in `package.json`.

Out of scope:

- Reshaping `RunnerEvent`/`TranscriptLine` for richer tool I/O (full input JSON, structured result
  blocks, streaming deltas). Separate WO; the lossy 200-char `summary` stays.
- Backfilling the terminal from the provider's on-disk transcript on resume (ADR-0010 forbids it).
- Making the terminal the input surface / REPL.
- Consolidating `TranscriptEntry` (fixture shape) with `TranscriptLine` (live shape).
- A configurable theme palette / search / custom keybinds — a later theming WO.

## Acceptance criteria

1. The session pane renders the live transcript in an xterm.js terminal (monospace, scrollback within the
   region, refits on window resize).
2. `formatTranscriptLine` styles each speaker as specified; `isError` tool results render distinctly;
   multi-line content renders one row per line (no staircase). Covered test-first in `src/core`.
3. The terminal consumes the existing `foldSessionEvent` stream unchanged; no `RunnerEvent`/port change.
4. A fresh drive resets the terminal; resume appends (blank-then-stream).
5. The terminal is read-only; the prompt/drive/stop-and-ask controls are unchanged.
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` are green. No new
   Node/adapter/vendor-name/`.replace(`/`disabled` boundary trip — in particular no `cursor`-bearing
   xterm option or comment (the boundary check's vendor regex matches the bare word `cursor`).

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered, ADR-0001)
- pr_open: PR URL, head sha
- ci_green: all required checks `success` (observed, not enforced — TD-013)
- verification: the formatter unit tests; run-verify the terminal in the app (drive a session: styling,
  scrollback, resize, reset-on-new-drive, append-on-resume, clickable links); typecheck/build/boundaries
- closure: all tracks merged, `ROADMAP.md` line 53 → `[x]` (M2 complete), `docs/tech-debt.md` TD-020 closed

## Notes

- Solo mode; gates operator-covered. The sharp implementation hazard is the boundary check's vendor-name
  regex, which matches the bare word `cursor` — so no `cursorBlink`/`cursorStyle`/`theme.cursor` option
  and no "cursor" in comments. `disableStdin` is safe (not the word `disabled`).
