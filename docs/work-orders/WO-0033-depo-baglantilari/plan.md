---
id: WO-0033
title: Plan — depo bağlantıları (ports → store → bridge → Defter UI → vocabulary → E2E)
workspace: docket
status: pending-approval
---

# WO-0033 — Plan

Implements order.md @ 7d28943. Every AC maps to a step below; every step names its files.

## Stance (the three stop-and-ask gates, resolved per the order's own wording)

1. **Per-action commit in edit mode** — taken as the order states it: add/edit/remove fire the
   store immediately; `Kaydet` applies name + decision store only. Not staged-then-Kaydet.
2. **Guard (b) semantics** — an OPEN work order's track blocks removal; closed-WO references do
   not (history keeps the basename string). Open = `gateInputs.closureDocsSha == null`. Data-loss
   stance: removing a repo an open WO still writes to is the one removal that can orphan live
   work, so it alone is guarded.
3. **`ACTION_LABELS.merge_track` renaming** — in. Rendered nowhere today; ADR-0012 r4's de-jargon
   note anticipated exactly this change ('Depoyu birleştir').

## C3 — core ports, store, IPC bridge (one green commit)

### `src/core/source.ts`

New view type next to `RepoConnectionInput`:

```ts
export interface RepoConnectionView { id: RepoId; path: string }
```

Two port methods on `WorkOrderSource`, placed beside `addRepoConnection`/`removeRepoConnection`
(src/core/source.ts:70-71), with doc comments:

- `repoConnections(id: WorkspaceId): Promise<RepoConnectionView[]>` — the connection table's
  rows: `{ id: basename(local_path), path: local_path }`. The basename IS the RepoId (the
  invariant every writer already follows). Fixture-seeded repos have no connection row and
  therefore do not appear — the UI handles a definition row without a path.
- `updateRepoPath(id: WorkspaceId, repoId: RepoId, newPath: string): Promise<void>` — rewrites
  `connection.local_path` only. Throws when `repoBase(newPath) !== repoId` (identity is the
  basename; a different name is a different repo) and when no connection row matches; in both
  cases nothing is written.

### `src/adapters/store/index.ts`

- `repoConnections`: `SELECT local_path FROM connection WHERE workspace_id = ?` → map through
  `rid(repoBase(...))`. No new SQL surface.
- `updateRepoPath`: basename check first (throw), then find the row by basename match, `UPDATE
  connection SET local_path = ? WHERE workspace_id = ? AND repo_remote = ?`. `workspace_repo`
  and `repo_remote` are untouched.
- **Basename-collision refusal (AC 9)**: shared guard used by `createWorkspaceRow`
  (src/adapters/store/index.ts:423) and `addRepoConnectionRow` (:475) — if the workspace already
  defines a repo with the same basename, throw `duplicate repo: <basename>` BEFORE any write.
  Today `INSERT OR REPLACE` silently swallows the second repo (workspace_repo PK collapses,
  connection row overwrites). Both writers become `async` wrappers so the refusal REJECTS (the
  WO-0032 deleteWorkspace ruling: the UI's try/catch depends on the await contract).
- `removeRepoConnection` is unchanged (deletes by path).

### `src/adapters/store/store.test.ts` — new tests in the workspace-CRD describe

1. `repoConnections` returns `{id, path}[]` for a created workspace (2 repos → 2 rows, ids =
   basenames).
2. `updateRepoPath` rewrites the path, keeps `repo_remote` + `workspace_repo` intact.
3. `updateRepoPath` with a different basename throws and changes nothing.
4. `updateRepoPath` on an unknown repo throws.
5. `addRepoConnection` with an existing basename rejects; the workspace still has one row (the
   silent-swallow regression).
6. `createWorkspace` with duplicate basenames in input rejects.

### Bridge

`electron/preload.ts` (the `source` object, after `removeRepoConnection`) +
`electron/main.ts` (beside the existing repo-connection handlers, main.ts:125-126): two channels
`docket:source:repo-connections`, `docket:source:update-repo-path`. No renderer-side type
declares a partial source, so typecheck enforces the pair. These are the only two
`WorkOrderSource` implementers.

## C4 — the Defter modal + vocabulary (one green commit)

### `src/ui/kit/Input.tsx`

`Field`'s error span (:29) gains `role="alert"` — kit-wide, the error line announces.

### `src/ui/chrome/WsSettingsModal.tsx` — rewrite of the repo section + error model

**Row model** (both modes — one anatomy, AC 5):

```ts
type Row = { id: string; path: string; err?: string; editing?: boolean };
```

- create: rows live in local state, `id = base(path)` recomputed as the path changes (free path
  edit — the row is not yet anything); never sent until `Oluştur`.
- edit: rows load once on mount from `repoConnections(workspace.id)` merged onto
  `workspace.repos` order (definition rows without a connection row keep `path: ''` and get no
  ✎ — nothing to edit, nothing to remove through this UI); `id` is the RepoId and is LOCKED.

**Row anatomy** (mockup §A): top line = validity glyph (`Check` proceed / `CircleAlert` error,
h-3.5) · basename (12.5px semibold) · `● karar deposu` marker when the row is the effective
decision store (`decisionStore || allRepos[0]`) · right-aligned actions. Second line = full mono
path, middle-truncated by slice (≈ head 44 + '…' + tail 15 over 60 chars — never `.replace`),
full path in `title`, `overflow-hidden whitespace-nowrap`. Third line, only while `err`:
`role="alert"` error line (11px, text-error). No per-row hover styling beyond `.ibtn` (ADR-0012).

**Actions per row**:

- ✎ `ibtn`, aria `wsRepoEditAria` — swaps the path line for a mono `Input` seeded with the
  current path; Enter/blur commits, ESC-abort is not built (dialog-level ESC wins, the accepted
  WoCreateModal stance). Commit validation: `valid()` first, then (edit mode only)
  `base(new) === row.id`; failure → row `err` (persists while invalid, clears when ✎ reopens)
  and the attempted text stays in the input. Edit-mode commit fires
  `source.updateRepoPath(ws.id, row.id, newPath)`; store refusal → row `err`. Create-mode commit
  just rewrites local state.
- ✕ `ibtn ibtn-danger`, aria `wsRepoRemoveAria` — confirmless. Create: drop the row. Edit: fire
  `source.removeRepoConnection(ws.id, row.path)` then refresh rows from `repoConnections` and
  call `onSaved()` (the workspace definition changed — the App list must not go stale).
- **Guards (edit mode only; AC 4)** — checked in priority a > b > c; when a guard hits, ✕ is
  absent and its reason line stands in the actions slot (10-11px, inkdim):
  - (a) `row.id === workspace.decisionStore` → `'karar deposu kaldırılamaz'`
  - (b) any WO of this workspace with `gateInputs.closureDocsSha == null` whose
    `tracks.some(t => t.repo === row.id)` → `` `${woIdLabel(wo.id)} kullanıyor` `` (first/lowest
    WO; `getWorkOrders()` loaded once on mount, edit mode only)
  - (c) `rows.length === 1` → `'son depo kaldırılamaz'`
- No path (`path === ''`, fixture definition) → ✎ and ✕ both absent (nothing to act on).

**Add row** (unchanged position, mockup §A): draft input + `Ekle` + `Klasör`. `Ekle`/Enter:
empty → no-op; invalid → `draftErr` under the add row; basename collides with a row →
`draftErr` = 'Bu adda depo zaten var.' (create mode checks locally; edit mode lets the store
refusal produce the same line, draft retained). Edit mode fires `addRepoConnection`
immediately on a valid non-colliding draft, then refreshes rows + `onSaved()`. Empty ledger
(create mode): one line `Henüz depo yok.` above the add row (ADR-0012: 1 line, ≤1 action).

**Error model (AC 6)** — three slots, never the footer:

- `nameErr` under Ad via `Field error` — set on submit when name empty; clears on edit.
- row `err` / `draftErr` as above.
- footer `error` keeps ONLY save failures (`UI.saveFailed`) — `createWorkspace` /
  `updateWorkspace` rejections.

**Submit (`Oluştur` / `Kaydet`)**:

1. Draft absorption: non-empty valid draft → absorb first (create: append row; edit: fire the
   immediate add and let its failure abort the submit with `draftErr`). A non-empty INVALID
   draft is not absorbed — it becomes `draftErr` and aborts.
2. Validate in visual order: name → rows (any `!valid(path)` row blocks; create also requires ≥1
   valid row → `wsErrRepo` under the section) → draft (covered by 1).
3. First-invalid focus: name input via ref; an invalid row enters `editing` and focuses its
   input; `wsErrRepo` focuses the draft input. (`useRef` + callback refs; `Input` already
   forwards refs, Input.tsx:9.)
4. Create: `createWorkspace` with row paths; edit: `updateWorkspace(label,
   decisionStorePath)` ONLY — the `for…await addRepoConnection` batch (WsSettingsModal.tsx:91)
   dies.
5. `busy` + `locked` on the submit Button while in flight (the honest in-flight state; never a
   `disabled` attribute — ADR-0001). Ekle/row buttons sit out during flight via one `acting`
   flag (double-fire on Ekle would surface as a collision error otherwise).

**Decision-store select (AC 7)**: state initializes from `workspace?.decisionStore ?? ''`
(today `''` + `allRepos[0]` fallback, WsSettingsModal.tsx:174). Options come from the LIVE rows
(post-removal), not the stale prop. Marker on the row follows the same effective value.

### `src/ui/data/labels.ts` — vocabulary pass (AC 8)

| key | old | new |
|---|---|---|
| `wsSettings` | Workspace ayarları | Çalışma alanı ayarları |
| `wsReposLabel` | Repo bağlantıları | Depo bağlantıları |
| `wsRepoPlaceholder` | yerel repo yolu | yerel depo yolu |
| `wsErrRepo` | En az bir geçerli **repo** yolu ekle… | En az bir geçerli **depo** yolu ekle… |
| `woTracksLabel` | Repolar | Depolar |
| `secTracks` | Repolar | Depolar |
| `woContextLabel` | Context (dosya) | Bağlam dosyaları |
| `ACTION_LABELS.merge_track` | Track'i mergele | Depoyu birleştir (+ the D3 comment shrinks to the merge-is-not-a-UI-action fact) |
| `ABSENT_REASON_LABELS.depends_on_open` | Bağımlı track merge olmadı | Bağımlı depo merge olmadı |
| `UI.stepBlockedHint` | kapsam bir track ile eşleşmiyor | kapsam bir depoyla eşleşmiyor |

New keys: `wsRepoEditAria` 'Depo yolunu düzenle', `wsRepoRemoveAria` 'Depoyu kaldır',
`wsErrPathInvalid` 'Tam yol değil — / ile başlamalı.', `wsErrPathName` 'Depo adı değişemez — yol
aynı depoya işaret etmeli.', `wsErrRepoDup` 'Bu adda depo zaten var.', `wsNoRepos` 'Henüz depo
yok.', `wsDsMarker` 'karar deposu', `wsGuardDs` 'karar deposu kaldırılamaz', `wsGuardOpenWo`
`(wo: string) => \`${wo} kullanıyor\``, `wsGuardLast` 'son depo kaldırılamaz'.

Review check after the edit: `grep -in 'repo\|workspace\|track' src/ui/data/labels.ts` — hits
allowed only in comments and the evidence interpolations' variable names, never in display
string literals. PR/CI/ADR/ROADMAP/order.md words stay English by the order's own rule.

### `src/ui/chrome/WoCreateModal.tsx`

Labels ride the pass (`woTracksLabel`, `woContextLabel`). The free fix from Notes, taken:
context chips (WoCreateModal.tsx:140-142) gain `title={p}` (full path on hover). Zero-track WO
validation and ESC behavior stay out (order Notes).

## C5 — E2E (one commit)

`e2e/ui.mjs`, placed AFTER the WO-0032 block (net-zero on the shared db: every added repo is
removed before the spec ends):

1. **Ledger + guards + edit + collision** (on the `e2e` workspace): open settings via the
   switcher gear → single row shows basename + the seeded root path (assert text + `title`);
   ✕ absent with a guard reason (DS + last repo). Type a second path `/tmp/e2e-ikinci-depo` →
   Ekle → two rows, second has ✕. Collision: type `/tmp/other/repo` → Ekle → 'Bu adda depo
   zaten var.' line, still two rows. ✎ the second row → retype
   `/tmp/yeni/yol/e2e-ikinci-depo` → Enter → path line updates. ✎ → `/tmp/farkli-ad` → Enter →
   basename error line, old path restored on reopen. ✕ the second row → back to one row (net
   zero). Screenshot `ws-repos-ledger@980.png`.
2. **(c) surface** (on the `raf` workspace): settings → one row, ✕ absent, reason present.
3. **Create flow** — folded into the existing empty-DB spec's second app, before its closing
   asserts: submit empty → 'Ad gerekli.' under Ad (+ `document.activeElement` is the name
   input); type `apps/web` → Ekle → ! glyph + 'Tam yol değil' line; Oluştur → dialog stays;
   ✎-fix to `/tmp/web` (same basename) → line clears; ✕ the row; type a valid draft and click
   Oluştur WITHOUT Ekle → absorbed, workspace created → existing zero-WO hero asserts unchanged.
4. **Selector updates** (stale after the vocabulary pass): `aria-label="Workspace ayarları"` ×2
   (:850, :907) → 'Çalışma alanı ayarları'; `placeholder="yerel repo yolu"` (:947) → 'yerel
   depo yolu'; the gone-surface assert (:591) 'Repolar' → 'Depolar' (the detail surface stays
   gone — new word, same claim).

`npm run test:ui` = build + driver; exit code is the failing-spec count. Expected total: 36
existing + ~3 new ≈ 39.

## Commit sequence (every commit typecheck+test green)

1. `7d28943` docs — order + mockup (done)
2. docs — this plan
3. feat — ports + store + bridge (+ store tests)
4. feat — Defter modal + kit `role="alert"` + vocabulary
5. test — E2E specs + selector updates
6. close — order.md Closure + ROADMAP + tech-debt (post-merge, WO-0032 pattern)

PR `wo-0033-depo-baglantilari` → `main`; evidence per order.md (plan_approval = this file's
approval, pr_open, ci_green incl. `check:boundaries`, verification, closure docs).

## Verification pointers (for the verifier's report)

- AC1/2/3 → store tests + E2E spec 1; AC4 → E2E 1+2 (guards (a)/(c); (b) by code + running);
- AC5/6 → E2E 3 + the modal source (error slots, focus refs, busy lock);
- AC7 → E2E 1 (select opens on the saved value — assert `select` value on open);
- AC8 → labels.ts diff + the grep review check; AC9 → store test 5 + E2E collision step;
- AC10 → CI.
