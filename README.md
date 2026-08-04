# Docket

A local-only desktop console for driving Claude Code sessions through a review pipeline.

Docket runs Claude Code in separate roles — **architect**, **implementer**, **verifier** — and advances a
work order to the next stage only when the evidence for that stage exists: a PR URL, a commit sha, a CI
conclusion, `path:line` pointers that actually resolve at that sha.

**Status: pre-alpha.** Design in progress. Nothing runs yet.

## Invariants

These are the product's character. They are not configurable.

1. **No transition without evidence.** Every stage gate names what it requires. Missing evidence means the
   transition does not exist in the UI — not disabled, absent.
2. **Documents are never copied into the app database.** Work orders, ADRs, plans, ROADMAP and contracts
   live in git. Docket stores state, session ids and evidence pointers. Two copies means one goes stale.
3. **Session lifecycle is the app's decision, not the operator's memory.** New work order means a clean
   session. A fix on an existing PR means the same session continues.
4. **Plan mode vs. direct is an explicit field.** Work requiring design decisions runs in plan mode.
   Surgical work with a predetermined edit runs direct.
5. **Merge is not closure.** A work order closes only when the documentation gate is satisfied.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Workspace** | One project: a set of repos plus one designated decision store. Defined in `.workflow/workspace.yaml`, versioned in git. |
| **Decision store** | A *role*, not a repo. In a multi-repo project it is a dedicated repo. In a single-repo project it is a folder inside that repo. |
| **Work order** | The unit of work. Lives in the decision store. Advances through a fixed pipeline. |
| **Track** | Per-repo lane inside a work order: its own session, PR, CI run and merge. Tracks may declare `depends_on`. |
| **Gate** | A named evidence requirement between two stages. |
| **Briefing** | The context bundle Docket assembles from the decision store for a fresh session's first prompt. |

## Pipeline

```
work order written
  -> plan requested (implementer, plan mode)
  -> plan ready
  -> architect approval        [gate: architect verdict + plan committed]
  -> implementation            (stop-and-ask gates may fire here)
  -> PR opened                 [gate: pr_url + head_sha]         per track
  -> CI                        [gate: all required checks green] per track
  -> verification              [gate: verifier report + resolvable pointers]
  -> architect audit
  -> merge                     per track, respecting depends_on
  -> CLOSURE GATE              [gate: doc updates proven by commit sha]
  -> closed
```

## Stack

Electron + TypeScript + React + Tailwind. xterm.js for transcript rendering, SQLite for state.
See `docs/adr/ADR-0004-technology-stack.md`.

## Repository layout

```
.workflow/workspace.yaml   this project's own workspace definition (Docket manages itself)
docs/adr/                  architecture decision records
docs/work-orders/          work orders, one directory each
docs/tech-debt.md          open debt, a closure-gate input
ROADMAP.md                 milestones, a closure-gate input
```

## Developing

```sh
npm install                  # install dependencies
npm run dev                  # Vite dev server with HMR
npm test                     # run the test suite once (vitest)
npm run test:watch           # re-run tests on change
npm run build                # tsc --noEmit, then vite build
npm run check:boundaries     # the layering/identity greps CI runs
```

`check:boundaries` enforces the rules in `CLAUDE.md` mechanically; see
`docs/adr/ADR-0011-repository-conventions-and-mechanical-enforcement.md`.
