# ADR-0016: The roadmap layer — a derived planning surface above the work order

Date: 2026-08-27 · Status: accepted · Supersedes (for this artifact): ADR-0008's "Roadmap progress
without machine-readable roadmaps" clause and the `milestone:` front-matter mechanism it introduced ·
Keeps: ADR-0008's two disciplines, ADR-0010's rules 1 and 2, ADR-0001's evidence gating.

## Context

The work order is Docket's unit of evidence-gated work, but real products plan one level above it.
The live scenario is antreo-app: nine faz docs (`faz-0..8-*.md`) in the decision-store repo, decision
sections, cross-faz dependencies (faz-2 blocked by faz-4), and an operator running the chain by hand
— "Ana Görev / Görev N" issues, `[API]`/`[Flutter]` labels, manual cross-repo links. That pattern,
in Docket, is the roadmap layer: **roadmap → faz → task → work order**.

The 2026-08-27 planning round (commit `19c6a38`, mockup `docs/ui-mockups/wo-0048-yol-haritasi.html`,
7 frames, operator-approved) locked four decisions: tasks are persistent and WOs link to them 1:N
with all statuses derived; generation and import are ONE mechanism — an architect draft session
(WO-0050), never a source-format-specific parser; the feature splits WO-0048 (spine) → WO-0049 (GUI)
→ WO-0050 (AI draft); the surface is a sibling screen (`Pano | Yol Haritası`), the board and detail
untouched.

ADR-0008 stood against exactly this: "ROADMAP.md stays human prose… the work orders carry the
structure." Its reason was sound then and stays sound — a planning surface that stores status is a
second source of truth next to git, the thing ADR-0001 exists to prevent. What changed is the shape
of the artifact: a **machine fence inside a document** (the ```steps tradition plan.md already uses)
gets the structure without surrendering the document to a rendering concern, and **derivation** gets
the progress without ever storing it.

## Decision

The roadmap layer is a planning surface ABOVE the work order, and every number it shows is derived.
Three rules carry the whole design:

### 1. One machine fence, one document per workspace

`<structure root>/roadmap.md` — front-matter (`workspace`, `title`), free prose, and exactly ONE
```fazlar fence holding a JSON array:

- faz: `{ id, title, aim?, blockedBy[], notes?, tasks[] }`; task: `{ id, title, repo?, note? }`.
- Ids are explicit, stable, `^[a-z0-9][a-z0-9-]*$`, unique across the whole roadmap (`f0`, `f0-t1`),
  minted by pure `nextFazId`/`nextTaskId`.
- Keys English; values verbatim in the operator's language (the `aim` precedent).
- **Status appears nowhere in the file.** `blockedBy` is data, not status. No task lists its work
  orders — no backlinks; the link lives on the WO side (rule 2).

Parsing is all-or-nothing (any malformed element → the whole list reads as empty, with a named
diagnostic — the WO-0017 degradation contract), and the parser's sibling
(`roadmapDiagnostics`) names hand-edit errors: no fence, duplicate id, bad id shape, empty title,
unknown/cyclic/self `blockedBy`, front-matter mismatch, unknown repo slug.

### 2. The task→WO link lives only in order.md; status is derived, never stored

A work order declares `task: f1-t3` in its order.md front-matter. Nothing else: **no
`work_order.task_ref` column** — a column would be ADR-0010 rule 1's stalest denormalized copy of
document text. `getRoadmap` joins at view time by reading the workspace's order.md files (solo
scale; the cost is TD-055).

Status derivation (test-first, `src/core/roadmap.ts`):

- task: no WO → `planli`; any open WO → `kosuyor`; all closed (≥1) → `tamam`.
- faz: any task `kosuyor` → `kosuyor`; any blocker not `tamam` → `bekliyor`; tasks>0 and all
  `tamam` → `tamam`; else `planli` (the vacuous truth refused — a zero-task faz is planned, not
  done).

The spawn action (`İş emri aç`) is available on a `planli` task with a resolved repo in an unblocked
faz; otherwise it is ABSENT with a structural reason (`kosuyor` / `bloke` / `repo_yok`) — ADR-0001.
Named edges, each a test: an orphan `task:` (points at a deleted task) is invisible on the roadmap;
a `blockedBy` cycle renders both members `bekliyor` plus a warning (self-block is an error); an
unresolved repo slug is a warning that blanks one task's spawn, not the surface.

### 3. The structure root is one setting; Docket never moves files or writes .gitignore

An `app_setting` key `docs_root:<wsId>` (the `budget:<wsId>` precedent — no schema change), default
`docs/`; `.docket/` is one setting away for the operator who wants the documents out of the tree.
Switching the root **never moves files** and **never writes a .gitignore line** — both are the
operator's acts (gitignore-vs-commit stays the operator's choice; the local-only mode's one cost is
documented: the closure sha does not carry the documents into history). The one honest guard is a
warning at the switch: numbering restarts at WO-0001 under the new root — move the folders yourself.

## What this supersedes, and what it keeps

ADR-0008's clause "ROADMAP.md stays human prose… each work order declares `milestone: M1`" is
superseded FOR THE WORKSPACE ROADMAP ARTIFACT (the repository's own root `ROADMAP.md` stays human
prose — it is a closure gate, not a workspace planning artifact). The `milestone:` front-matter
mechanism is retired for new work.

ADR-0008's two disciplines stand unchanged, and this layer is their strongest test yet:

- **Status is computed, never dragged.** There is no status field anywhere — not in the DB, not in
  the file. A faz flips `Koşuyor` because a linked WO opened a session, and for no other reason.
  "Ready to start" becomes `siradaki` — the first spawnable task — still a deterministic derivation,
  still not a suggestion.
- **A model never invents work unreviewed.** The ✦ draft (generate from a goal note, or import from
  existing faz docs — ONE mechanism, deliberately no source-format parser) is WO-0050's architect
  plan-mode session: it proposes `roadmap.md` contents, the operator reviews, edits, approves; the
  write is a parse-guarded save (`saveRoadmap` refuses to write a document it cannot re-read) and
  the commit is the operator's.

ADR-0010 is untouched: document text lives in git, the DB persists only run outcomes; no observed
table gains a stage/status/task column from this layer.

## Consequences

- `src/core/roadmap-md.ts` + `src/core/roadmap.ts` (test-first, pure); order.md gains the `task:`
  round-trip; the decision-store adapter resolves the structure root per workspace; CLI
  `roadmap show|validate` + `create-work-order --task` + `docs-root` make the spine verifiable
  without GUI (WO-0048).
- The GUI (faz strip, task fill, `sıradaki`, collapsed done fazlar, the ✦ dialog, the detail chip)
  is WO-0049, built on the approved mockup; the AI draft drive, source-doc import, and the WO-less
  session migration are WO-0050.
- Derivation order is pinned: `taskStatusOf` before `fazStatusOf`; kosuyor outranks bekliyor; the
  head's cost is all observed spend (closed + open), with unknown-cost sessions flagged, never
  silently summed.
- Drag-reorder of fazlar stays out (array order IS the order; moving is a file edit), as do
  backlog/sprint/labels/assignees/due dates and estimates — cost and duration are OBSERVED, which is
  the product's difference.

## Alternatives rejected

- **A `work_order.task_ref` column.** The join becomes fast and the document link becomes a cache
  that drifts on every hand edit — ADR-0010 rule 1 written small.
- **Status fields in roadmap.md.** Every drag-to-done board's failure: status declared without
  evidence (ADR-0008's own rejection, restated).
- **A source-format import parser (antreo faz-doc → roadmap).** One format forever carrying
  translation debt; the architect draft session reads any documents the operator points it at
  (WO-0050, the locked decision 2).
- **`.docket/` as the default root.** Defaults are opinions the operator pays for; `docs/` rides the
  convention the repository already has, and the switch is one setting.
