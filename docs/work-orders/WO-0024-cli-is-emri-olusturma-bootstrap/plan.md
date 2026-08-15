# WO-0024 — CLI work-order creation (bootstrap)

## Context

TD-032: the CLI can drive an existing WO but cannot create one — every workspace/WO must be born in the GUI.
This WO makes the CLI self-sufficient end-to-end. Scope is `src/cli/` + tests only; `createWorkspace`/`createWorkOrder`
already exist on the store port (`src/core/source.ts:45,55`) and SQLite adapter (`src/adapters/store/index.ts:634,645`).
Working tree is clean (only the untracked WO doc); nothing from the earlier interrupted session survives.

## Key facts that shape the design

- `src/cli/index.ts` is a boundary-exempt composition root (widened in `cb3750a`); a new `src/cli/create.ts` is NOT
  exempt → it must be pure over plain strings: no `wid`/`rid`/`as XxxId`, no `../adapters/*` imports. Branding and
  store calls stay in `index.ts`.
- `parseArgs` (index.ts:20-37) is last-value-wins → can't collect repeated `--track`. Decision: mappers parse their
  own raw argv slice; `parseArgs` stays untouched.
- index.ts:209 refuses a non-existent db for every command but `doctor` → must exempt `create-workspace`
  (`createStore` creates + migrates a fresh db file).
- All six `CreateWorkOrderInput` fields are required — CLI fills `description: ''` / `contextFiles: []` defaults.
- Validation is caller-side today (mirror `WoCreateModal.tsx:28-32,59-62`): title non-empty, review-mode ∈
  {gates, every-step} (reject, never silently default), tracks = workspace code repos minus decision store
  (single-repo workspace keeps its repo).
- `--workspace W` resolved by the command handler via `store.getWorkspaces()`: exact id match, else label match,
  else rc!=0. `--track` values resolved against `workspace.repos` slugs; unknown slug → clear error.
- Unknown command currently exits 0 via `help()`; WO item 3 ("hatalarda rc!=0") → print help to stderr, return 2.
- Exit-code convention: 0 success / 1 runtime failure / 2 usage error. No new dependencies; vitest, tests colocated
  (`src/cli/__tests__/`), real-store behavior already covered by `store.test.ts` — CLI tests stay pure.

## Implementation

1. **`src/cli/create.ts`** (new, pure): 
   - `parseCreateWorkspaceArgs(argv): { ok: true; input: CreateWorkspaceInput } | { ok: false; error: string }` —
     handles `--label`, `--repo`, `--decision-store` (optional). Plain strings; `repos: [{ path }]` unbranded.
   - `parseCreateWorkOrderArgs(argv)` — same union; parses `--workspace`, `--title`, optional `--description`,
     repeatable `--track` (collect all), optional `--review-mode` (default `gates`, invalid → error listing valid
     values), fills `description: ''` / `contextFiles: []` defaults; workspace + tracks remain plain strings
     (draft, not branded).
   - `resolveTracks(repos: string[], decisionStore: string, requested?: string[]): { ok; tracks: string[] } | { ok: false; error }` —
     validates slugs against workspace repos, applies decision-store subtraction (multi-repo only), default =
     all code tracks.
2. **`src/cli/index.ts`**: `create-workspace` / `create-work-order` commands following the existing handler pattern;
   db-existence guard exempts `create-workspace`; workspace id/label lookup + `rid()` branding here; help updated;
   unknown-command → rc 2; success prints created ids (e.g. `created WO-00NN "<title>"`).
3. **`src/cli/__tests__/create.test.ts`**: pure mapper tests — happy paths, defaults, every error branch
   (missing flags, blank title, invalid review-mode, unknown/decision-store track, repeatable --track), no IPC/DB.
4. **Closure**: ROADMAP.md + docs/tech-debt.md (TD-032 closed) in the same PR.

## Verification

- `npm test`, `npm run typecheck` (both tsconfigs), `npm run build`, `npm run check:boundaries` — all green.
- Manual sandbox run: `DDB=$(mktemp -u); npx tsx src/cli/index.ts --db $DDB create-workspace --label deneme --repo <tmp repo>`
  then `create-work-order --workspace deneme --title "..." --track ...`, then `ls`/`show` + error cases (rc!=0);
  confirm order.md written under the repo's decision store.

## Steps

```steps
[
  { "role": "implementer", "aim": "implement create-workspace/create-work-order + mapper tests + docs", "scope": "docket" },
  { "role": "verifier", "aim": "verify tests, boundaries, sandbox end-to-end run", "scope": "docket" }
]
```
