# WO-0007 — plan

> Architect rulings on the three stop-and-ask gates, the resulting design, and the
> implementation path. `mode: plan`; this plan awaits the architect verdict before
> any code is written.

## Objective (restated)

Stand up the Electron shell around the M1 prototype. The composition root moves to
the Electron main process; the renderer is the existing `src/ui/` app — unchanged —
and reaches data only through the `WorkOrderSource` port (`src/core/source.ts`). No
session runner, no SQLite — the shell the rest of M2 bolts onto.

## Architect rulings — the three gates

### 1. Port synchronicity — STAY SYNCHRONOUS

`WorkOrderSource` (`src/core/source.ts`) is synchronous and `App` calls it inline in
render (`src/ui/app/App.tsx:11-34`). Electron IPC is asynchronous. This WO does **not**
make the port async. Instead the fixture dataset crosses the boundary once, up front,
and the preload re-exposes the existing synchronous interface. `core` and `ui`
(including `App`) are not modified.

**Why not async now.** The async cost — Promises on the port, loading states in
`App` and the screens — is justified only when a dynamic data source exists. Fixtures
are static. ADR-0006 wants `core` stable; changing the port's shape for a fixture
scaffold pays SQLite's price before SQLite exists. When SQLite lands (a later M2 WO)
the port goes async in one place and this whole bridge is deleted (TD-017).

**The bridge (throwaway).** Main serializes the fixture source to a snapshot; the
preload fetches it with `ipcRenderer.sendSync` at top level, wraps it in a
`WorkOrderSource`, and exposes it via `contextBridge`. The renderer reads
`window.docket.source`. `sendSync` is acceptable here because the data is instant and
in-memory; it is removed the moment the port goes async.

### 2. Disk layout — `electron/` at the repo root

`electron/main.ts` (composition root, Node; wires the fixture adapter; owns the
`BrowserWindow` and the IPC handler) and `electron/preload.ts` (`contextBridge` +
the sendSync bridge). The pure app stays under `src/{core,ui,adapters}`; the renderer
entry is `src/renderer/index.tsx`. The shell is infra and lives outside `src/`, so
the existing `src/core` / `src/ui` boundary scans are untouched and main/preload are
naturally exempt from the Node-import ban.

### 3. `src/dev-main.tsx` — DELETE; Electron is the sole entry

The renderer entry becomes `src/renderer/index.tsx`, reading `window.docket.source`;
`index.html` is repointed at it. `src/dev-main.tsx` is removed. This honours
ADR-0006 ("the composition root … the Electron main process later") and the order's
objective, and avoids maintaining two wiring paths that must be kept in sync.

**Cost acknowledged.** The plain-Chromium screenshot path (`scripts/shot.mjs`) stops
working, because the renderer now depends on the preload's `window.docket`, which a
bare browser does not provide. `shot.mjs` is already machine-specific and is owned by
WO-0003 / TD-011 (AC11); this WO does not touch it and records the breakage as debt
(TD-018). This WO's screenshot evidence is a manual capture of the Electron window.

## Design

### Process model

```
electron/main.ts        Node. createFixtureSource() → ipcMain handler → snapshot.
                        BrowserWindow(contextIsolation: on, nodeIntegration: off,
                        sandbox: on). Loads the Vite URL (dev) / dist/index.html (prod).
electron/preload.ts     ipcRenderer.sendSync('docket:get-source-snapshot') once,
                        wraps the result as a WorkOrderSource, exposes it via
                        contextBridge as window.docket.source. Exposes nothing else.
src/renderer/index.tsx  createRoot(...).render(<App source={window.docket.source} />)
src/{core,ui,adapters}  unchanged. App still takes `source: WorkOrderSource`.
```

### IPC contract (throwaway, synchronous)

- Channel `docket:get-source-snapshot` (sendSync). Main returns
  `{ workspaces, workOrders, docs }` drawn from `createFixtureSource()`.
- Preload wraps it:
  `getWorkspaces: () => snap.workspaces`, `getWorkOrders: () => snap.workOrders`,
  `getWorkOrder: id => snap.workOrders.find(w => w.id === id)`,
  `getWorkOrderDocs: id => snap.docs[id] ?? { order: '', plan: '' }`.
- No identity is constructed renderer-side: branded ids are runtime strings, survive
  JSON, and are only ever *passed through*. Construction stays in the fixture adapter
  (ADR-0003).
- Types: `src/renderer/preload.d.ts` augments `Window { docket: { source:
  WorkOrderSource } }`.

### Build & dev pipeline

- Renderer: existing Vite (entry → `src/renderer/index.tsx` via `index.html`),
  unchanged config, HMR in dev.
- Main + preload: compiled by `esbuild` (a dev watcher + a prod build) to the module
  format the pinned Electron version requires for a sandboxed preload (verify
  CJS-vs-ESM against the version — sandboxed preloads have historically required
  CJS). New devDeps: `electron`, `esbuild`, `concurrently`, `wait-on`.
- `npm run dev`: `concurrently` → Vite (renderer) + esbuild watch (main/preload) +
  Electron loading the Vite URL once `wait-on` sees the port. Renderer HMR preserved.
- `npm run build`: Vite build (renderer → `dist/`) + esbuild build (main/preload →
  `dist/`). A `start` script launches the built app (`electron .`).
- Typecheck: a `tsconfig.electron.json` (Node lib, `electron` + `@types/node` types,
  `include: ["electron"]`) for main/preload; the existing `tsconfig.json` keeps
  `src`. CI's `tsc --noEmit` covers both.

### Boundary-check changes (`scripts/check-boundaries.mjs`)

- `COMPOSITION_ROOT` → a set `COMPOSITION_ROOTS = new Set(['electron/main.ts'])`
  (`src/dev-main.tsx` dropped). Check 4 allows adapter imports only there.
- Extend the file walk to cover `electron/` so the rules hold project-wide; check 4
  then enforces "adapter imports only in `electron/main.ts`" across both roots.
- Extend check 3 (Node imports) to `src/renderer/` (browser code must stay
  Node-free). `src/core` and `src/ui` already covered.
- `electron` is not in the vendor-name list; main/preload add no vendor names and no
  identity-constructor calls, so checks 1/2a stay clean.

## Task breakdown

1. Add devDeps (`electron`, `esbuild`, `concurrently`, `wait-on`) and the npm scripts
   (`dev`, `build`, `start`).
2. `electron/main.ts`: window with the security defaults; `ipcMain` snapshot handler
   delegating to `createFixtureSource()`; dev-vs-prod load URL.
3. `electron/preload.ts`: sendSync snapshot → `WorkOrderSource` wrapper →
   `contextBridge.exposeInMainWorld('docket', { source })`.
4. `src/renderer/index.tsx` (replaces `src/dev-main.tsx`); `src/renderer/preload.d.ts`
   Window types; repoint `index.html` to `/src/renderer/index.tsx`.
5. `tsconfig.electron.json`; ensure `tsc --noEmit` typechecks both projects.
6. esbuild scripts for main/preload (dev watch + prod build).
7. Update `scripts/check-boundaries.mjs` per above; `npm run check:boundaries` clean.
8. Run: `npm run dev` (Electron shows the board), `npm run build` + launch, full CI
   locally (tsc / test / build / boundaries green).
9. Capture the Electron-window screenshot for verification evidence.

## Verification (AC → how checked)

- **AC1:** Electron-window screenshot vs. the known M1 board (two workspaces, six
  card states).
- **AC2 / AC3 / AC4:** `npm run check:boundaries` clean; spot-check the
  composition-root and Node-import rules against the new layout.
- **AC5:** read `electron/main.ts` + `electron/preload.ts` — the three flags and the
  single exposed surface.
- **AC6:** `npm run build`, then launch the `dist` build.
- **AC7:** CI green (tsc / test / build / boundaries).

## Risks

- **Sandboxed-preload module format.** ESM preloads under `sandbox: true` have been
  uneven across Electron versions; if the pinned version rejects ESM, compile the
  preload to CJS (esbuild `format: 'cjs'`). Resolve empirically, not by assumption.
- **ESM main path handling.** `__dirname` is unavailable under ESM; use
  `import.meta.url` (+ `fileURLToPath`) to resolve `dist/index.html`.
- **`sendSync` lifetime.** Must not survive past the SQLite WO; TD-017 pins the
  deletion.
- **Dev orchestration fragility.** `wait-on` + `concurrently` is the usual pair; if
  it proves flaky, a small node orchestrator replaces it.

## Tech debt to open (closure gate)

- **TD-017** — The IPC source bridge is synchronous and throwaway. `WorkOrderSource`
  stays sync; when SQLite lands the port must go async and the `sendSync` channel +
  preload wrapper are deleted. medium, open, addressed by the SQLite WO.
- **TD-018** — `scripts/shot.mjs` no longer works against the app: the renderer now
  requires the preload's `window.docket`, which a bare Chromium lacks. The screenshot
  story (including an Electron-window capture) is reconciled in WO-0003, which
  already owns AC11 / TD-011. low, open.
