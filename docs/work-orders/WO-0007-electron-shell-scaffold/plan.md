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

**Tooling choice (researched): `vite-plugin-electron/simple`.** It drops into the
existing `vite.config.ts` — the repo's tool, not a new build-tool/CLI — accepts
`electron/main.ts` + `electron/preload.ts` entries (so it does **not** impose a
`src/main` layout), and is Vite-8 / rolldown compatible. Rejected: hand-rolling
esbuild + a `concurrently`/`wait-on` orchestrator (fragile wiring to own for a
one-time scaffold), and `electron-vite` standalone (replaces the build tool with its
own CLI + config — the most magic, against the repo's plain-tools ethos). One new
devDep beyond `electron`: `vite-plugin-electron`.

- Renderer: existing Vite (entry → `src/renderer/index.tsx` via `index.html`), HMR.
- Main + preload: built by the plugin (Vite's bundler) alongside the renderer. The
  preload is emitted as CommonJS — required, because `sandbox: true` runs the
  preload without an ESM context (Electron docs; confirmed). The bundler handles it.
- `npm run dev` = `vite`: the plugin builds main/preload, spawns Electron on the Vite
  URL, and rebuilds on change. Renderer HMR preserved.
- `npm run build` = `vite build` (renderer → `dist/`, main/preload → `dist-electron/`);
  `package.json` `"main": "dist-electron/main.js"`; `npm start` = `electron .`.
- Typecheck: `tsconfig.electron.json` (Node lib, `@types/node`, `include: ["electron"]`)
  for main/preload; the existing `tsconfig.json` keeps `src`. A `typecheck` script
  runs `tsc --noEmit` over both; CI is updated to call it.

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

1. Add devDeps `electron` + `vite-plugin-electron`; add npm scripts `dev` (`vite`),
   `build` (`vite build`), `start` (`electron .`), `typecheck`; set `package.json`
   `"main": "dist-electron/main.js"`.
2. `electron/main.ts`: window with the security defaults; `ipcMain` snapshot handler
   delegating to `createFixtureSource()`; dev-vs-prod load URL.
3. `electron/preload.ts`: sendSync snapshot → `WorkOrderSource` wrapper →
   `contextBridge.exposeInMainWorld('docket', { source })`.
4. `src/renderer/index.tsx` (replaces `src/dev-main.tsx`); `src/renderer/preload.d.ts`
   Window types; repoint `index.html` to `/src/renderer/index.tsx`.
5. `tsconfig.electron.json`; `typecheck` runs `tsc --noEmit` over both projects; CI
   updated to call `typecheck`.
6. `vite.config.ts`: register `vite-plugin-electron/simple` with `main.entry` and
   `preload.input` pointed at `electron/`.
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

- **Sandboxed-preload module format — RESOLVED by research.** `sandbox: true` runs
  the preload without an ESM context (Electron docs); the plugin therefore emits the
  preload as CommonJS. No empirical guessing — verify the emitted
  `dist-electron/preload.js`.
- **ESM main path handling.** `__dirname` is unavailable under ESM; use
  `import.meta.url` (+ `fileURLToPath`) to resolve `dist/` / `dist-electron/`.
- **`sendSync` lifetime.** Must not survive past the SQLite WO; TD-017 pins the
  deletion.
- **Plugin output paths / `electron .` wiring.** Confirm `dist-electron/{main,preload}.js`
  are the plugin's actual outputs and that `package.json` `main` + the preload path in
  `main.ts` agree; verify by running `npm start` on the build.

## Tech debt to open (closure gate)

- **TD-017** — The IPC source bridge is synchronous and throwaway. `WorkOrderSource`
  stays sync; when SQLite lands the port must go async and the `sendSync` channel +
  preload wrapper are deleted. medium, open, addressed by the SQLite WO.
- **TD-018** — `scripts/shot.mjs` no longer works against the app: the renderer now
  requires the preload's `window.docket`, which a bare Chromium lacks. The screenshot
  story (including an Electron-window capture) is reconciled in WO-0003, which
  already owns AC11 / TD-011. low, open.
