// Workspace create/edit modal (WO-0014; WO-0031b kit restyle; WO-0033 Defter rewrite). The repo
// section is the operator-selected mockup §A (docs/ui-mockups/ws-repos-v1.html): every connection
// a two-line row — basename on top, full mono path below (middle-truncated, full path in title) —
// and ONE anatomy for both modes. Edit mode commits per action (add/path-edit/remove fire the
// store immediately; Kaydet applies name + decision store only). Form errors sit under the field
// that caused them (persistent while invalid, first-invalid focused on submit); the footer's single
// line is save failures only. WO-0032: edit also carries the deletion entry — quiet (ghost + error
// ink) here, loud (danger confirm) in WsDeleteDialog.
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, FolderOpen, Pencil, X } from 'lucide-react';
import type { RepoId, Workspace } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import { UI, woIdLabel } from '../data/labels';
import { Button, Dialog, Field, Input } from '../kit';

const base = (p: string): string => {
  let s = p;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.split('/').pop() || 'repo';
};
const valid = (p: string): boolean => p.startsWith('/') && p.length > 1 && !p.endsWith('/');
// Middle truncation: the head names the machine, the tail names the repo — an end-ellipsis would
// hide exactly the distinguishing half. Budget 60 chars; the full path rides `title`.
const midTrunc = (p: string): string => (p.length > 60 ? `${p.slice(0, 44)}…${p.slice(-15)}` : p);

/** One ledger row, both modes (WO-0033). Edit rows carry the locked identity as `repoId` — the
 *  branded RepoId straight from `Workspace.repos` (its source; ADR-0003 forbids branding it here,
 *  so the port call takes that field, never a cast). `name` is the displayed basename: edit rows
 *  show the RepoId as text, create rows derive it from the path until Oluştur commits.
 *  `editing` present ⇒ the path line is an input holding that text; `err` is the row's line. */
type Row = { repoId?: RepoId; name: string; path: string; err?: string; editing?: string };

export function WsSettingsModal({
  mode,
  workspace,
  source,
  onClose,
  onSaved,
  onDeleteWorkspace,
  driveLive,
}: {
  mode: 'create' | 'edit';
  workspace?: Workspace;
  source: WorkOrderSource;
  onClose: () => void;
  onSaved: () => void;
  /** WO-0032: edit mode only — hands the workspace up so AppShell can swap this modal for the confirm. */
  onDeleteWorkspace?: (ws: Workspace) => void;
  /** WO-0032: a live drive in this workspace — the Sil entry is absent with the reason (ADR-0001). */
  driveLive?: boolean;
}) {
  const [name, setName] = useState(workspace?.label ?? '');
  // Edit mode seeds from the definition (basename order); paths arrive from repoConnections on
  // mount. The prop snapshot goes stale the moment a per-action mutation lands — rows are the
  // modal's own source of truth afterwards.
  const [rows, setRows] = useState<Row[]>(
    mode === 'edit' ? (workspace?.repos ?? []).map((r) => ({ repoId: r, name: r as string, path: '' })) : [],
  );
  const [draft, setDraft] = useState('');
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [repoErr, setRepoErr] = useState<string | null>(null);
  // AC 7: edit mode opens on the SAVED decision store (today it always showed allRepos[0]).
  const [decisionStore, setDecisionStore] = useState<string>(
    mode === 'edit' ? ((workspace?.decisionStore as string | undefined) ?? '') : '',
  );
  const [error, setError] = useState<string | null>(null); // footer — save failures only
  const [acting, setActing] = useState(false); // a per-action store call is in flight
  const [saving, setSaving] = useState(false);
  /** repoName → the first OPEN work order whose track uses it (guard (b)'s named reason). */
  const [openWoByRepo, setOpenWoByRepo] = useState<Record<string, string>>({});
  /** the row whose edit input takes focus once it mounts (submit's first-invalid rule). */
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  function rowsFrom(ws: Workspace, conns: { id: RepoId; path: string }[]): Row[] {
    const byBase = new Map(conns.map((c) => [c.id as string, c.path]));
    // Definition order carries; a repo without a connection row (fixture-seeded) keeps path '' —
    // no ✎/✕, no path line: nothing to act on through this surface.
    return ws.repos.map((r) => ({ repoId: r, name: r as string, path: byBase.get(r as string) ?? '' }));
  }

  // Edit-mode load: connections (paths) + the fresh definition (order) + the open-WO map (guard b).
  useEffect(() => {
    if (mode !== 'edit' || !workspace) return;
    let alive = true;
    void (async () => {
      const [conns, wss, wos] = await Promise.all([
        source.repoConnections(workspace.id),
        source.getWorkspaces(),
        source.getWorkOrders(),
      ]);
      if (!alive) return;
      setRows(rowsFrom(wss.find((w) => w.id === workspace.id) ?? workspace, conns));
      const map: Record<string, string> = {};
      // Guard (b) semantics (order's ruling): an OPEN work order's track blocks removal; closed-WO
      // references do not — history keeps the basename string. Open = no closure sha.
      for (const w of wos) {
        if (w.workspace !== workspace.id || w.gateInputs.closureDocsSha != null) continue;
        for (const t of w.tracks) if (!(t.repo as string in map)) map[t.repo as string] = woIdLabel(w.id);
      }
      setOpenWoByRepo(map);
    })();
    return () => {
      alive = false;
    };
  }, [mode, workspace, source]);

  /** Refetch rows after a per-action edit-mode mutation; returns what it set (submit validates on
   *  the returned value — setState is not readable in the same tick). */
  async function reloadRows(): Promise<Row[]> {
    if (!workspace) return rows;
    const [conns, wss] = await Promise.all([source.repoConnections(workspace.id), source.getWorkspaces()]);
    const next = rowsFrom(wss.find((w) => w.id === workspace.id) ?? workspace, conns);
    setRows(next);
    return next;
  }

  const allRepos = rows.map((r) => r.name);
  const effectiveDs = decisionStore || allRepos[0] || '';

  /** The removal guards (edit mode; AC 4, priority a > b > c): the ✕ is absent and the reason
   *  stands in its place. The decision-store guard follows the LIVE selection — what the marker
   *  shows is what is protected. */
  function guardOf(row: Row): string | null {
    if (mode !== 'edit') return null;
    if (effectiveDs && row.name === effectiveDs) return UI.wsGuardDs;
    if (openWoByRepo[row.name]) return UI.wsGuardOpenWo(openWoByRepo[row.name]);
    if (rows.length === 1) return UI.wsGuardLast;
    return null;
  }

  function setRowErr(rowName: string, err: string | null): void {
    setRows((prev) => prev.map((r) => (r.name === rowName ? { ...r, err: err ?? undefined } : r)));
  }
  function patchRow(rowName: string, patch: Partial<Row>): void {
    setRows((prev) => prev.map((r) => (r.name === rowName ? { ...r, ...patch } : r)));
  }
  function startEdit(row: Row): void {
    if (acting || saving) return;
    patchRow(row.name, { editing: row.path, err: undefined });
    setFocusRow(row.name);
  }

  /** ✎ commit (Enter/blur). A failed validation KEEPS the editor open with the attempted text —
   *  reverting would silently discard what the operator typed. ESC reverts. */
  async function commitPath(row: Row, next: string): Promise<void> {
    const t = next.trim();
    if (t === row.path) {
      patchRow(row.name, { editing: undefined, err: undefined });
      return;
    }
    if (!valid(t)) {
      setRowErr(row.name, UI.wsErrPathInvalid);
      return;
    }
    if (rows.some((r) => r.name === base(t) && r.name !== row.name)) {
      setRowErr(row.name, UI.wsErrRepoDup);
      return;
    }
    if (mode === 'edit' && workspace) {
      if (!row.repoId) return;
      // Name locked in edit mode: identity is the basename; a different name is a different repo.
      if (base(t) !== row.name) {
        setRowErr(row.name, UI.wsErrPathName);
        return;
      }
      setActing(true);
      try {
        await source.updateRepoPath(workspace.id, row.repoId, t);
        patchRow(row.name, { path: t, editing: undefined, err: undefined });
      } catch {
        setRowErr(row.name, UI.wsErrPathName); // the store refusal carries the same ruling
      } finally {
        setActing(false);
      }
    } else {
      // Create mode: a free move — the row is not yet anything, identity follows the path.
      patchRow(row.name, { name: base(t), path: t, editing: undefined, err: undefined });
    }
  }

  /** Confirmless removal (WO-0032 ruling: re-adding = typing a path — below the 440px confirm
   *  class). Create: drop the row. Edit: fire the store, refetch, hand the refresh up. */
  async function removeRow(row: Row): Promise<void> {
    if (acting || saving) return;
    if (mode === 'edit' && workspace) {
      setActing(true);
      try {
        await source.removeRepoConnection(workspace.id, row.path);
        await reloadRows();
        onSaved();
      } catch {
        setError(UI.saveFailed);
        return;
      } finally {
        setActing(false);
      }
    } else {
      setRows((prev) => prev.filter((r) => r.name !== row.name));
    }
    if (decisionStore === row.name) setDecisionStore('');
    setRepoErr(null);
  }

  /** The add row's commit (Ekle/Enter/pick/absorb). Returns the success; failures keep the draft
   *  and put their line under the add row. Edit mode fires the store immediately. */
  async function addPath(p: string): Promise<boolean> {
    if (acting || saving) return false;
    const t = p.trim();
    if (!valid(t)) {
      setDraftErr(UI.wsErrPathInvalid);
      return false;
    }
    if (rows.some((r) => r.name === base(t))) {
      setDraftErr(UI.wsErrRepoDup);
      return false;
    }
    if (mode === 'edit' && workspace) {
      setActing(true);
      try {
        await source.addRepoConnection(workspace.id, { path: t });
      } catch {
        setDraftErr(UI.wsErrRepoDup); // the store's collision refusal surfaces the same line
        return false;
      } finally {
        setActing(false);
      }
      await reloadRows();
      onSaved();
    } else {
      setRows((prev) => [...prev, { name: base(t), path: t }]);
    }
    setDraftErr(null);
    return true;
  }

  async function addDraft(): Promise<void> {
    if (!draft.trim()) return;
    if (await addPath(draft)) setDraft('');
  }

  async function pick(): Promise<void> {
    try {
      const p = await window.docket.pickFolder();
      if (p) await addPath(p);
    } catch {
      setError(UI.saveFailed);
    }
  }

  async function submit(): Promise<void> {
    if (acting || saving) return;
    // 1 — draft absorption BEFORE validation (AC 6): a valid draft becomes a row (edit mode: the
    // immediate add fires here); an invalid non-empty draft is itself the first invalid field.
    let working = rows;
    const t = draft.trim();
    if (t) {
      const ok = await addPath(t);
      if (ok) {
        setDraft('');
        working = mode === 'edit' && workspace ? await reloadRows() : [...rows, { name: base(t), path: t }];
      } else {
        draftRef.current?.focus();
        return;
      }
    }
    // 2 — validate in visual order; the first invalid field takes focus.
    if (!name.trim()) {
      setNameErr(UI.wsErrName);
      nameRef.current?.focus();
      return;
    }
    // An open editor (or its error, or an invalid path) blocks: commit it first.
    const badRow = working.find((r) => r.err || r.editing !== undefined || !valid(r.path));
    if (badRow) {
      setRows((prev) =>
        prev.map((r) =>
          r.name === badRow.name
            ? { ...r, editing: r.editing ?? r.path, err: r.err ?? (!valid(r.path) ? UI.wsErrPathInvalid : undefined) }
            : r,
        ),
      );
      setFocusRow(badRow.name);
      return;
    }
    if (mode === 'create' && !working.some((r) => valid(r.path))) {
      setRepoErr(UI.wsErrRepo);
      draftRef.current?.focus();
      return;
    }
    setRepoErr(null);
    // 3 — fire. Create sends the rows; edit sends name + decision store ONLY (repo changes went
    // out per action already — the old staged addRepoConnection batch died with this rewrite).
    setSaving(true);
    try {
      if (mode === 'create') {
        await source.createWorkspace({
          label: name.trim(),
          repos: working.map((r) => ({ path: r.path })),
          decisionStorePath: decisionStore || undefined,
        });
      } else if (workspace) {
        await source.updateWorkspace(workspace.id, { label: name.trim(), decisionStorePath: decisionStore || undefined });
      }
      onSaved();
      onClose();
    } catch {
      setError(UI.saveFailed); // B5: surface, don't swallow (WO-0026)
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={mode === 'create' ? UI.wsCreate : UI.wsSettings}
      closeAria={UI.dialogCloseAria}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            {mode === 'edit' && workspace && onDeleteWorkspace ? (
              driveLive ? (
                <span className="readout">{UI.wsDeleteGateReason}</span>
              ) : (
                <Button variant="ghost" size="sm" className="text-error" onClick={() => onDeleteWorkspace(workspace)}>{UI.wsDelete}</Button>
              )
            ) : null}
            {error ? <span role="alert" className="text-[11px] text-error">{error}</span> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.close}</Button>
          <Button variant="primary" size="sm" busy={saving} locked={saving || acting} onClick={() => void submit()}>
            {mode === 'create' ? UI.wsCreateBtn : UI.wsSave}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={UI.wsNameLabel} error={nameErr}>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => { setName(e.target.value); setNameErr(null); }}
          />
        </Field>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.wsReposLabel}</span>
          {rows.length === 0 ? <p className="mb-2 text-[11px] text-inkdim">{UI.wsNoRepos}</p> : null}
          {rows.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-hairline bg-bg">
              {rows.map((row, i) => {
                const guard = guardOf(row);
                return (
                  <div key={`${row.name}:${i}`} className={i > 0 ? 'border-t border-hairline' : ''}>
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      {row.path ? (
                        valid(row.path) ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-proceed" aria-hidden="true" />
                        ) : (
                          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-error" aria-hidden="true" />
                        )
                      ) : null}
                      <span className="text-[12.5px] font-semibold text-ink">{row.name}</span>
                      {row.name === effectiveDs ? (
                        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-inkdim">
                          <span className="text-signal">●</span> {UI.wsDsMarker}
                        </span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-0.5">
                        {row.path ? (
                          <button type="button" className="ibtn px-1" aria-label={UI.wsRepoEditAria} onClick={() => startEdit(row)}>
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : null}
                        {guard ? (
                          <span className="text-[10.5px] text-inkdim">{guard}</span>
                        ) : row.path ? (
                          <button type="button" className="ibtn ibtn-danger px-1" aria-label={UI.wsRepoRemoveAria} onClick={() => void removeRow(row)}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {row.editing !== undefined ? (
                      <Input
                        value={row.editing}
                        onChange={(e) => {
                          const v = e.target.value;
                          patchRow(row.name, { editing: v, err: undefined });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitPath(row, row.editing ?? '');
                          } else if (e.key === 'Escape') {
                            // Revert without closing the dialog (stop the ESC reaching Radix).
                            e.stopPropagation();
                            e.preventDefault();
                            patchRow(row.name, { editing: undefined, err: undefined });
                          }
                        }}
                        onBlur={() => void commitPath(row, row.editing ?? '')}
                        ref={(el) => {
                          if (el && focusRow === row.name) {
                            el.focus();
                            setFocusRow(null);
                          }
                        }}
                        className="mx-2.5 mb-2 font-mono text-[11px]"
                      />
                    ) : row.path ? (
                      <div className="ml-[22px] mb-1 truncate font-mono text-[11px] text-inkdim" title={row.path}>
                        {midTrunc(row.path)}
                      </div>
                    ) : null}
                    {row.err ? <span role="alert" className="mb-1.5 ml-[22px] block text-[11px] text-error">{row.err}</span> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {repoErr ? <span role="alert" className="mt-1.5 block text-[11px] text-error">{repoErr}</span> : null}
          {/* Path entry: type a path + Add, or pick a folder. Both append a ledger row (edit mode:
              the append is the store call itself). */}
          <div className="mt-2 flex gap-1.5">
            <Input
              ref={draftRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setDraftErr(null); setRepoErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addDraft(); } }}
              placeholder={UI.wsRepoPlaceholder}
              className="flex-1 font-mono text-[12px]"
            />
            <Button variant="secondary" size="sm" locked={acting || saving} onClick={() => void addDraft()}>{UI.wsRepoAddManual}</Button>
            <Button variant="ghost" size="sm" locked={acting || saving} onClick={() => void pick()}>
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {UI.wsRepoPick}
            </Button>
          </div>
          {draftErr ? <span role="alert" className="mt-1.5 block text-[11px] text-error">{draftErr}</span> : null}
        </section>

        {allRepos.length >= 2 ? (
          <Field label={UI.wsDecisionStore}>
            <select
              value={effectiveDs}
              onChange={(e) => setDecisionStore(e.target.value)}
              className="w-full rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-[13px] text-ink focus-visible:border-signal focus-visible:outline-none"
            >
              {allRepos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
