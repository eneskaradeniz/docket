# CLAUDE.md

Rules every session obeys. Each points to the ADR that decided it; the reasoning lives there, not here. A
rule restated with its reasons in two places is the duplication this repository refuses everywhere else.

## Layering — ADR-0006
- `src/core/` is pure: no React, no I/O, no Node. It imports nothing from `src/adapters/` or `src/ui/`.
- `src/ui/` imports from `src/core/` and reaches the outside world only through a port defined in `core`.
- A composition root imports an adapter — and there is exactly ONE: the Electron main process
  (`electron/main.ts`). The CLI root WO-0024 added is gone (WO-0073, GUI-only; ADR-0006 addendum). CI: no
  Node builtin or `node:` specifier imported in `core/`, `ui/` or `renderer/`, and no adapter import outside
  the composition root.

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
  locale bundles (`woIdLabel`), never raw `{id}`. The roadmap's faz/task ids (`f0`, `f0-t3`) joined the same
  carve-out (ADR-0007's 2026-08-27 addendum): operator-authored references through `fazIdLabel`/`fazLabel`,
  never raw interpolation.

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
  işlemez" — stay), no jargon/mixed-case headers, no standing keyboard hints (only the current
  primary's ⏎ badge — `EnterMark`; never on Kapat, never during an ask; the rail itself died with
  WO-0039).
- Juice: transitions only (never mount), ≤400ms, reduced-motion off via the one CSS block, the cost
  counter never animates, the CLOSED session card stays calm (ADR-0012's 2026-08-22 restatement —
  SADE no longer exists).
- Form errors sit under their field (persistent while invalid, first-invalid focused on submit, `role="alert"`);
  save failures toast top-right (hata) — a dialog footer carries no error copy; validity never locks a submit.
  Required-ness is marked the minority way — `aria-required` + an "(isteğe bağlı)" suffix — never asterisks
  or a legend (WO-0036 + its review round).
- Vertical rhythm is the 4px grid — gaps 4/8/12/16; 2px only inside chip/icon clusters; 10/14 never vertical.
  The dispatch card carries ONE right anchor: cost·duration sits beside the ▸ action on the reason row
  (WO-0079, ADR-0012's 2026-09-20 addendum). Adapter diagnostics never render raw — the surface speaks
  operator words, the verbatim reason rides the tooltip/record (WO-0078).

## Single view — ADR-0013
- The work-order detail screen is ONE scroll at every width (DOSYA): a merged header band (turn lamp
  spine + phase + step hairline) over decision cards → the LIVE INSTRUMENT band-adjacent (every
  drive kind; WO-0044 tur 2 — the spine row carries no pane) → the plan/step spine as a pure STATUS
  list (Aktif / Bekliyor / tamam — no live detail) → the record sections (Belgeler rows · Kaynaklar ·
  Oturum cards). No view mode, no tabs, no rack, no bottom
  rail — decisions render in their flow (the plan section's decision band + heading Düzenle, the
  lone Plan iste button on a bare plan stage, the fail card's retry) and process control rides the
  live pane's header (`DriveControls`);
  `view-mode`/`Substrip`/`DetailBody`/`useDetailLayout`/`ActionRail` are deleted; do not reintroduce
  layout forks or a command bar.
- Session history renders as CARDS: the KİM — ROL head line (role word in its role hue, 3px role
  edge, the step's aim on its own line) + the artifact-headline özet + the Ray transcript one click
  away (the aç/kapa is the old SADE/DETAY distinction); record cards wear the visible `--bord`
  edge. The ledger is PURE HISTORY — a running drive
  carries no card there (ADR-0013's 2026-08-25 addendum); the ONE live surface is the TOP
  instrument (band-adjacent), which speaks the shared live grammar (`pane-chrome`: activity verb
  line + "Dökümü aç/kapat" chip, the transcript behind the chip — StepPane/ReviewPane/SessionPane
  alike). The roadmap screen carries the console's SECOND live surface — `RoadmapPane`, the same
  pane grammar, identity `MİMAR — TASLAK`; a workspace-scoped draft never overlays a board card,
  and the head meta says `taslak sürüyor` while it runs (ADR-0013's 2026-08-27 addendum). The
  FINISHED draft's transcript is one `Dökümü aç/kapat` away on the TASLAK card's head — the chip
  grammar's card-level twin (TD-057, ADR-0013's 2026-08-28 addendum); the draft session still
  never enters a ledger.
  The ActionCard is absent while a drive runs and never renders the resume intent (Sürdür lives only
  in DriveControls). The Kanıt section is dead — evidence is
  contextual (the close card's checklist; a gated action's reason line). The plan-approval gate is
  ENFORCED in the pipeline (`SessionStore.planApprovedFor`): step/review drives on an unapproved plan
  are refused with an error event before the runner spawns — never work around it in a host. The
  workspace BUDGET gate is enforced the same way (`SessionStore.budgetBlockFor`, WO-0047): when the
  calendar-month spend meets the workspace cap, EVERY drive is refused before the runner spawns
  (a running drive is never touched); the refusal renders as a two-choice card (raise-and-re-run /
  keep-the-cap) and raising the cap is a permanent settings write that re-runs the refused drive —
  never a host-side work-around, never a force flag.

## Roadmap layer — ADR-0016
- The planning layer ABOVE the work order (roadmap → faz → task → work order). One `roadmap.md` per
  workspace at the structure root (default `docs/`, the `docs_root:<wsId>` app_setting); fazlar and
  tasks live in ONE ```fazlar fence (`FazSpec`/`TaskSpec`, ids `^[a-z0-9][a-z0-9-]*$` unique
  roadmap-wide, keys English, values verbatim operator language); the fence parses all-or-nothing with
  named diagnostics (`src/core/roadmap-md.ts`).
- The task→WO link lives ONLY in order.md front-matter (`task:`) — never a DB column, never a
  backlink in roadmap.md; `getRoadmap` joins by re-reading the workspace's order.md files at view
  time (ADR-0010 rule 1; the cost is TD-055). Storing a faz/task status anywhere, or adding a
  `work_order.task_ref` column, contradicts ADR-0016 — stop and ask (WO-0048's gates).
- Faz/task status is DERIVED (`src/core/roadmap.ts`): task from its linked WOs (none → planli, any
  open → kosuyor, all closed → tamam), faz from its tasks + blockers (kosuyor outranks bekliyor;
  zero-task → planli). The spawn action (`İş emri aç`) exists only on a planli task with a resolved
  repo in an unblocked faz; otherwise it is ABSENT with reason `kosuyor|bloke|repo_yok` (ADR-0001).
  An orphan `task:` is invisible on the roadmap; a `blockedBy` cycle renders both bekliyor + warning.
- The structure-root switch (`docs_root:<wsId>`, default `docs/`) never moves files and never writes
  a .gitignore line — both stay the operator's acts; Docket only warns (numbering restarts at
  WO-0001 under the new root).
- The ✦ draft (WO-0050) is ONE mechanism — generation and import are the same workspace-scoped
  architect plan drive (`DraftDriveInput`, the `DriveInput` union's second arm); the prompt carries
  document PATHS, never contents (no source-format parser); the proposal is a `roadmap_draft` row
  (the `plan_original` document-text carve-out), approval is the parse-guarded `saveRoadmap` write
  and the commit is the operator's; the draft session is budget-gated like every drive
  (`budgetBlockForDraft`; draft spend counts in the month pool, never in the roadmap head).
  The source set is a free COMPOSITION of channels (WO-0051, ADR-0016's 2026-08-28 addendum):
  depo scan (structure-root `.md`s at dialog open, ALL included by default, exceptions at group
  level) ∪ ek belgeler (any picked path, deduplicated against the store) ∪ serbest keşif (opt-in,
  exactly ONE prompt sentence) — the prompt carries the path UNION; persistence carries COUNTS,
  never paths (`source_summary`, dying with the row); the architect write fence aligns with
  `docs_root` (main-filled, never renderer-set).

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
- GUI-only (operator rulings 2026-09-09 "sadece senin için kalsın" → 2026-09-20 removal): there is no CLI
  surface — `src/cli/` and `npm run cli` are gone (WO-0073); the headless role they played is carried by the
  E2E spec's e2e bridge and the core port fakes.
- App home (runtime state): `~/.docket/docket.db` — the SQLite store, one path on every platform
  (WO-0075); `DOCKET_DB_PATH` overrides verbatim and never migrates. The decision store is the
  repo's — this file is the machine-local cache, never project truth.
- Work orders: `docs/work-orders/WO-NNNN-*/`. Decisions: `docs/adr/ADR-NNNN-*.md`. Debt: `docs/tech-debt.md`.
  Roadmap: `ROADMAP.md`. Closure requires the roadmap and tech-debt updated, proven by a commit sha.
- Workspace roadmap (the faz/task planning layer, ADR-0016): `<structure root>/roadmap.md` (default
  `docs/roadmap.md`, per-workspace `docs_root:<wsId>`); work orders link to its tasks via the
  order.md `task:` front-matter key.
- Session-drive orchestration (prompt assembly + persistence + permission handling) is host-agnostic in
  `src/core/pipeline.ts`; the composition root wires `createPipeline({ runner, store, permission })`. The
  `SessionStore` port is `src/core/session-store.ts`. The host contributes only `cwd` + a permission policy.

## Records & PRs — added 2026-08-26
- Persisted evidence records (`wo_event.detail`, transcript tool detail, `stop_and_ask` payloads) may name tool
  targets — paths, commands — that is their job; they never carry environment values, credentials, or the provider
  key (the key lives only in `app_setting`). A new event kind is checked against this line — scoped from Paperclip's
  run-log allowlist ("an event never carries a command, an argument, a path, an environment value" — Docket's scope
  keeps targets, excludes secrets).
- Persisted usage records (WO-0052: `session_usage` rows, the ctx/final checkpoints) are METRICS — token
  counts, cache splits, durations, model-id strings carried verbatim from the adapter as row DATA; the
  no-env-values/no-keys bound above is exactly what keeps them honest.
- A PR opened from this repository names the model that authored the work (provider + model id) in a "Model Used"
  line at the top of the body. A PR without it is incomplete, like a WO without a closure sha.

## Operator manual-check gate — added 2026-08-29
- Every work chunk (a stage, a fix round) ends with a SHORT manual scenario for the operator —
  numbered steps, minute-scale, against `npm run dev` (the operator launches it; the assistant
  never does). Until the operator's verdict: no commit, no next chunk, no closure. Liking it
  closes the chunk; not liking it iterates (or restarts).
- Agents may draft and implement, but a tour never advances past the operator's manual check.

## CI — ADR-0011
- `npm run typecheck` (both `tsconfig.json` and `tsconfig.electron.json`), `npm test`, `npm run build`, and the
  boundary checks above run on every pull request and on every push to `main`. Run the boundary checks locally
  with one command: `npm run check:boundaries`.
- `ci_green` is not exempt (TD-012).
