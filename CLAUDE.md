# CLAUDE.md

Rules every session obeys. Each points to the ADR that decided it; the reasoning lives there, not here. A
rule restated with its reasons in two places is the duplication this repository refuses everywhere else.

## Layering — ADR-0006
- `src/core/` is pure: no React, no I/O, no Node. It imports nothing from `src/adapters/` or `src/ui/`.
- `src/ui/` imports from `src/core/` and reaches the outside world only through a port defined in `core`.
- A composition root imports an adapter — the Electron main process (`electron/main.ts`) or the CLI entry
  (`src/cli/index.ts`). CI: no Node builtin or `node:` specifier imported in `core/`, `ui/` or `renderer/`, and
  no adapter import outside a composition root.

## Test-first for `core` — ADR-0006
- `src/core/` is written test-first. React components are not — they are verified by running them.

## Display text — ADR-0007
- Components carry no display copy: all fixed UI vocabulary lives in the per-locale bundles in
  `src/ui/data/labels/` (`tr.ts` / `en.ts`), read through `useLabels()` — never a static word import.
- A raw identifier is never rendered as display text. CI bans `.replace(` in `src/ui/` as a **proxy** for this
  rule: it catches only the `.replace(` shape and misses JSX interpolation (`{id}`), template literals,
  `String()`/`.toString()`, concatenation, and `.replaceAll(`. A legitimate `.replace(` in `ui/` is an
  architect decision, not a thing to work around.
- The work-order number (`WO-NNNN`) is the one identifier permitted as display — rendered through the
  locale bundles (`woIdLabel`), never raw `{id}`. The carve-out lives in ADR-0007.

## Absent, not disabled — ADR-0001
- An action whose evidence is unmet is absent, with a line stating why — never a disabled control. CI: no
  `disabled`, `aria-disabled`, or `data-disabled` attribute (incl. the `{...{ disabled: true }}` object-key
  form) in `src/ui/`.
- Terminal-lock exception (2026-08-18 addendum): a control unavailable because the WO is CLOSED renders in
  place, locked (kit `locked` — pointer-events + dim, attribute-free), not absent; transient gates (a live
  drive) keep absent + reason.
- Guarded-row-action exception (2026-08-21 addendum): when the surface already shows what the row is (e.g.
  the karar deposu marker), a guarded action renders in place, dimmed, tooltip carrying the reason — not
  absent with a standing line.

## Interaction + copy contract — ADR-0012
- Hover flows ONLY through the semantic classes in `src/index.css` (`.ibtn` / `.irow` / `.ichip`) or kit
  variants; focus is the global ring, active is the kit press scale. Empty surface = 1 short line + ≤1
  action; empty groups render absent.
- No explainer paragraphs (field names suffice; informative lines — reasons, consequences, "maliyet
  işlemez" — stay), no jargon/mixed-case headers, no standing keyboard hints (only the rail ⏎ badge).
- Juice: transitions only (never mount), ≤400ms, reduced-motion off via the one CSS block, the cost
  counter never animates, SADE stays calm.
- Form errors sit under their field (persistent while invalid, first-invalid focused on submit, `role="alert"`);
  the footer line is save failures only; validity never locks a submit. Required-ness is marked the minority
  way — `aria-required` + an "(isteğe bağlı)" suffix — never asterisks or a legend (WO-0036).

## No agent-vendor names — ADR-0006 (and ADR-0002)
- No agent-vendor name (`Claude`, `Anthropic`, `Cursor`, `Copilot`, `Gemini`, `OpenAI`, `GPT`) appears
  anywhere in `src/` except the provider adapter (`src/adapters/`), the one place a provider SDK is named
  (ADR-0006 line 74-75). Sessions are vendor-neutral roles: `implementer`, `architect`, `verifier`.

## Workspace identity — ADR-0003
- Workspace, repo, work-order and track identities are constructed only in `src/adapters/`. `src/core/` and
  `src/ui/` never call a branded-identity constructor (`wid`/`rid`/`woid`/`tid`) and never hardcode a project
  name.
- The branded **types** (`WorkspaceId`, `RepoId`, `WorkOrderId`, `TrackId`) are the first line of defense: a
  bare string does not compile against them. The CI greps are the second line.
- `Docket` as the application's own chrome name is allowed — it is not a workspace identity. CI: no branded
  constructor call outside `src/adapters/`, and the pilot name `dateapp` appears nowhere in `core/` or `ui/`.

## English — ADR-0007
- Code and repository documents are English. UI copy is Turkish by default with an en/tr selector
  (ADR-0007, WO-0035); repository documents stay English regardless of UI locale.

## Where things live — ADR-0003, ADR-0001
- Work orders: `docs/work-orders/WO-NNNN-*/`. Decisions: `docs/adr/ADR-NNNN-*.md`. Debt: `docs/tech-debt.md`.
  Roadmap: `ROADMAP.md`. Closure requires the roadmap and tech-debt updated, proven by a commit sha.
- Session-drive orchestration (prompt assembly + persistence + permission handling) is host-agnostic in
  `src/core/pipeline.ts`; the composition root wires `createPipeline({ runner, store, permission })`. The
  `SessionStore` port is `src/core/session-store.ts`. The host contributes only `cwd` + a permission policy.

## CI — ADR-0011
- `npm run typecheck` (both `tsconfig.json` and `tsconfig.electron.json`), `npm test`, `npm run build`, and the
  boundary checks above run on every pull request and on every push to `main`. Run the boundary checks locally
  with one command: `npm run check:boundaries`.
- `ci_green` is not exempt (TD-012).
