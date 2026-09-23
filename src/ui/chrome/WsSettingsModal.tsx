// Workspace create/edit modal (WO-0014; WO-0031b kit restyle; WO-0033 Defter rewrite). The repo
// section is the operator-selected mockup §A (docs/ui-mockups/ws-repos-v1.html): every connection
// a two-line row — basename on top, full mono path below (middle-truncated, full path in title) —
// and ONE anatomy for both modes. Edit mode commits per action (add/path-edit/remove fire the
// store immediately; Kaydet applies name + decision store only). Form errors sit under the field
// that caused them (persistent while invalid, first-invalid focused on submit); save failures toast
// top-right — a dialog footer carries no error copy (operator review round 2026-08-21). WO-0032:
// edit also carries the deletion entry — quiet (ghost + error ink) here, loud (danger confirm) in
// WsDeleteDialog.
import { useEffect, useRef, useState } from 'react';
import { BookMarked, FolderOpen, Pencil, Plus, X } from 'lucide-react';
import type { RepoId, Workspace } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { AppSettings } from '../../core/app-settings';
import type { BudgetThreshold } from '../../core/budget';
import { DEFAULT_WARN_PERCENT, parseAmount } from '../../core/budget';
import { normalizeDocsRoot } from '../../core/roadmap-md';
import { DEFAULT_PROFILE, sameProfileName } from '../../core/backend-profile';
import { useLabels } from '../data/locale';
import { Button, Dialog, Field, Input, Segmented, Tooltip } from '../kit';
import { toast } from './ToastHost';

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
  settings,
  onClose,
  onSaved,
  onDeleteWorkspace,
  driveLive,
  onBudgetChanged,
  onDocsRootChanged,
}: {
  mode: 'create' | 'edit';
  workspace?: Workspace;
  source: WorkOrderSource;
  /** WO-0059 rev 4: the per-workspace knobs (budget + structure root) MOVED here from the global
   *  settings — they are this workspace's facts, not the console's. Edit mode only. */
  settings?: AppSettings;
  onClose: () => void;
  onSaved: () => void;
  /** WO-0032: edit mode only — hands the workspace up so AppShell can swap this modal for the confirm. */
  onDeleteWorkspace?: (ws: Workspace) => void;
  /** WO-0032: a live drive in this workspace — the Sil entry is absent with the reason (ADR-0001). */
  driveLive?: boolean;
  /** WO-0047: fired when the budget threshold changes — App refreshes its view. */
  onBudgetChanged?: () => void;
  /** WO-0049: fired when the structure root changes — App re-reads the roadmap. */
  onDocsRootChanged?: () => void;
}) {
  const { UI, woIdLabel } = useLabels();
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
  const [acting, setActing] = useState(false); // a per-action store call is in flight
  const [saving, setSaving] = useState(false);

  // ===== WO-0059 rev 4 — the per-workspace knobs MOVED here from the global settings (they are
  // THIS workspace's facts). Edit mode only; the same draft posture the settings section carried:
  // one atomic Kaydet per group, errors under their fields, validity never locks a button.
  const [budgetStored, setBudgetStored] = useState<BudgetThreshold | undefined>(undefined);
  const [capText, setCapText] = useState('');
  const [warnText, setWarnText] = useState('');
  const [monthSpend, setMonthSpend] = useState<{ usd: number; hasUnknown: boolean } | undefined>(undefined);
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [rootText, setRootText] = useState('');
  const [rootTouched, setRootTouched] = useState(false);
  const [rootBusy, setRootBusy] = useState(false);
  // WO-0098: the workspace's DEFAULT backend profile — an instant-write segment (the models posture:
  // a closed enum commits on click). Absent while no profile is configured (an empty group renders
  // absent, ADR-0012) unless a stored default dangles — then it stays, with the reason line.
  const [profileNames, setProfileNames] = useState<string[]>([]);
  const [wsProfile, setWsProfile] = useState<string | undefined>(undefined);
  const wsId = workspace?.id;
  useEffect(() => {
    if (mode !== 'edit' || !wsId || !settings) return;
    let alive = true;
    void settings.getBudget?.(wsId).then((t) => {
      if (!alive) return;
      setBudgetStored(t);
      setCapText(t ? String(t.capUsd) : '');
      setWarnText(t ? String(t.warnPercent) : '');
      setBudgetTouched(false);
    });
    void source.workspaceMonthSpend(wsId).then((s) => { if (alive) setMonthSpend(s); }).catch(() => { if (alive) setMonthSpend(undefined); });
    void settings.getBackendProfiles?.().then((ps) => { if (alive) setProfileNames(ps.map((p) => p.name)); }).catch(() => undefined);
    void settings.getWorkspaceProfile?.(wsId).then((n) => { if (alive) setWsProfile(n); }).catch(() => undefined);
    void settings.getDocsRoot(wsId).then((r) => {
      if (!alive) return;
      setRootText(r);
      setRootTouched(false);
    });
    return () => {
      alive = false;
    };
  }, [mode, wsId, settings, source]);
  const saveWsProfile = async (name: string | undefined): Promise<void> => {
    if (!wsId || !settings) return;
    const prior = wsProfile;
    setWsProfile(name); // optimistic — the row is re-read below
    try {
      await settings.setWorkspaceProfile(wsId, name);
      setWsProfile(await settings.getWorkspaceProfile(wsId));
    } catch {
      setWsProfile(prior);
      toast.push({ kind: 'error', title: UI.saveFailed });
    }
  };
  const capParsed = parseAmount(capText);
  const warnParsed = parseAmount(warnText);
  const capErr = !budgetTouched || budgetBusy ? null : !(capParsed > 0) ? UI.budgetErrCap : null;
  const warnErr = !budgetTouched || budgetBusy ? null : !(warnParsed >= 1 && warnParsed <= 100) ? UI.budgetErrWarn : null;
  const budgetValid = capParsed > 0 && warnParsed >= 1 && warnParsed <= 100;
  const saveBudget = async (): Promise<void> => {
    if (!wsId || !settings) return;
    setBudgetTouched(true);
    if (!budgetValid || budgetBusy) return;
    setBudgetBusy(true);
    try {
      await settings.setBudget?.(wsId, { capUsd: capParsed, warnPercent: warnParsed });
      setBudgetStored(await settings.getBudget?.(wsId));
      onBudgetChanged?.();
    } finally {
      setBudgetBusy(false);
    }
  };
  const clearBudget = async (): Promise<void> => {
    if (!wsId || !settings || budgetBusy) return;
    setBudgetBusy(true);
    try {
      await settings.setBudget?.(wsId, undefined);
      setBudgetStored(await settings.getBudget?.(wsId));
      setBudgetTouched(false);
      onBudgetChanged?.();
    } finally {
      setBudgetBusy(false);
    }
  };
  const rootErr = !rootTouched || rootBusy ? null : normalizeDocsRoot(rootText) === undefined ? UI.docsRootErr : null;
  const saveDocsRoot = async (): Promise<void> => {
    if (!wsId || !settings || rootBusy) return;
    setRootTouched(true);
    const normalized = normalizeDocsRoot(rootText);
    if (normalized === undefined) return;
    setRootBusy(true);
    try {
      await settings.setDocsRoot(wsId, normalized);
      setRootText(normalized);
      setRootTouched(false);
      onDocsRootChanged?.();
    } finally {
      setRootBusy(false);
    }
  };
  /** The add row sits behind a `+ Depo ekle` reveal (operator review: both screens stay clean).
   *  Create keeps it open after a successful Ekle (a listing flow); edit collapses — one action at
   *  a time. Escape collapses it; a failed add keeps it open with its error line. */
  const [adding, setAdding] = useState(false);
  /** repoName → the first OPEN work order whose track uses it (guard (b)'s named reason). */
  const [openWoByRepo, setOpenWoByRepo] = useState<Record<string, string>>({});
  /** the row whose edit input takes focus once it mounts (submit's first-invalid rule); the
   *  sentinel '__draft__' focuses the revealed add row. */
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const DRAFT_FOCUS = '__draft__';
  const nameRef = useRef<HTMLInputElement>(null);

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

  // The decision store is chosen IN THE LIST (operator review r2-r5): an explicit BookMarked-icon
  // button beside ✎ (signal-tinted — same family as the ● marker; the book = the karar deposu's
  // defter, the ribbon = the pick) picks it; the row itself is not a click target. Saved only by
  // Kaydet/Oluştur.
  const effectiveDs = decisionStore || (rows[0]?.name ?? '');

  /** The removal guards (edit mode; AC 4, priority a > b > c). The ✕ stays IN PLACE, dimmed, with
   *  the reason as a hover/focus tooltip naming the unblocking move (ADR-0001 2026-08-21 addendum —
   *  the row already shows what it is, so a standing reason line would be duplicated chrome). The
   *  decision-store guard follows the LIVE selection — what the marker shows is what is protected. */
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
        toast.push({ kind: 'error', title: UI.saveFailed });
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
      setAdding(false); // edit mode: the action landed — the ledger reads tidy again
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

  /** The `+` reveal: the entry row appears focused. Hiding it is one move from two affordances —
   *  the row's ✕ (Vazgeç, operator review r6) and ESC both land here; a landed edit-mode add
   *  collapses it in addPath. */
  function openAdd(): void {
    if (acting || saving) return;
    setDraftErr(null);
    setAdding(true);
    setFocusRow(DRAFT_FOCUS);
  }

  function closeAdd(): void {
    setAdding(false);
    setDraft('');
    setDraftErr(null);
  }

  async function pick(): Promise<void> {
    try {
      const p = await window.docket.pickFolder();
      if (p) await addPath(p);
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed });
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
        setFocusRow(DRAFT_FOCUS); // the revealed row is mounted — the ref callback focuses it
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
      setFocusRow(DRAFT_FOCUS); // the revealed row is mounted — the ref callback focuses it
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
      toast.push({ kind: 'error', title: UI.saveFailed }); // B5: surface, don't swallow (WO-0026)
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
      // An open path editor or the revealed add row swallows the ESC (revert/collapse it, keep the
      // dialog) — Radix hears ESC on the document in capture, so this hook is the only place the
      // close can be refused.
      onEscapeKeyDown={(e) => {
        if (rows.some((r) => r.editing !== undefined)) {
          e.preventDefault();
          setRows((prev) => prev.map((r) => ({ ...r, editing: undefined, err: undefined })));
        } else if (adding) {
          e.preventDefault();
          closeAdd();
        }
      }}
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
          {rows.length === 0 && !adding ? <p className="mb-2 text-[11px] text-inkdim">{UI.wsNoRepos}</p> : null}
          {/* One repo = one card, the console's row language (WorkOrderCard/WsListModal idiom):
              border + bg-bg + px-3 py-2, 13px name, mono-11 dim path — never a boxed ledger list.
              The decision store is picked with an EXPLICIT button beside ✎ (operator review r3 —
              the row itself is not a click target); the ● label marks the pick. */}
          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const guard = guardOf(row);
              const selected = row.name === effectiveDs;
              return (
                <div key={row.name} className="rounded-md border border-hairline bg-bg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{row.name}</span>
                    {selected ? (
                      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-inkdim">
                        <span className="text-signal">●</span> {UI.wsDsMarker}
                      </span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-0.5">
                      {!selected ? (
                        <Tooltip label={UI.wsDsMake}>
                          <button type="button" className="ibtn px-1 text-signal/70" aria-label={UI.wsDsMake} onClick={() => setDecisionStore(row.name)}>
                            <BookMarked className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      ) : null}
                      {row.path ? (
                        <Tooltip label={UI.wsRepoEditAria}>
                          <button type="button" className="ibtn px-1" aria-label={UI.wsRepoEditAria} onClick={() => startEdit(row)}>
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      ) : null}
                      {guard ? (
                        <Tooltip label={guard}>
                          <button type="button" className="ibtn ibtn-danger px-1 opacity-45" aria-label={UI.wsRepoRemoveAria}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      ) : row.path ? (
                        <Tooltip label={UI.wsRepoRemoveAria}>
                          <button type="button" className="ibtn ibtn-danger px-1" aria-label={UI.wsRepoRemoveAria} onClick={() => void removeRow(row)}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      ) : null}
                    </span>
                  </div>
                  {row.editing !== undefined ? (
                    <Input
                      // WO-0059 rev 4: the editor announces its row — the path line's title div
                      // unmounts while editing, so the name here is also the test's stable anchor.
                      aria-label={`${UI.wsRepoEditAria}: ${row.name}`}
                      value={row.editing}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Live validation (operator review r2): the line shows WHILE typing —
                        // the same rules commit will apply, so the refusal is never a surprise.
                        const t = v.trim();
                        const err = !valid(t)
                          ? UI.wsErrPathInvalid
                          : mode === 'edit' && base(t) !== row.name
                            ? UI.wsErrPathName
                            : rows.some((r) => r.name === base(t) && r.name !== row.name)
                              ? UI.wsErrRepoDup
                              : undefined;
                        patchRow(row.name, { editing: v, err });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commitPath(row, row.editing ?? '');
                        }
                      }}
                      onBlur={() => void commitPath(row, row.editing ?? '')}
                      ref={(el) => {
                        if (el && focusRow === row.name) {
                          el.focus();
                          setFocusRow(null);
                        }
                      }}
                      className="mt-1.5 font-mono text-[11px]"
                    />
                  ) : row.path ? (
                    <div className="mt-0.5 truncate font-mono text-[11px] text-inkdim" title={row.path}>
                      {midTrunc(row.path)}
                    </div>
                  ) : null}
                  {row.err ? <span role="alert" className="mt-1 block text-[11px] text-error">{row.err}</span> : null}
                </div>
              );
            })}
          </div>
          {repoErr ? <span role="alert" className="mt-1.5 block text-[11px] text-error">{repoErr}</span> : null}
          {/* The + reveal (operator review): the entry row appears on press — both screens stay
              clean at rest. Create keeps it open after a landed Ekle (a listing flow); edit
              collapses. Escape collapses (the dialog-level hook). */}
          {adding ? (
            <div className="mt-1.5 flex gap-1.5">
              {/* The entry row reads as one tidy bar: two square ghost buttons (Klasör, Vazgeç)
                  flanking a secondary Ekle, every control at the kit's md height (h-8.5 ≈ the
                  Input's ~33.5px — the sm size sat visibly shorter). The ✕ (operator review r6)
                  is the visible Vazgeç — ESC does the same. */}
              <Tooltip label={UI.wsRepoPick}>
                <Button variant="ghost" className="w-8.5 px-0" aria-label={UI.wsRepoPick} locked={acting || saving} onClick={() => void pick()}>
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
              <Input
                ref={(el) => {
                  if (el && focusRow === DRAFT_FOCUS) {
                    el.focus();
                    setFocusRow(null);
                  }
                }}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setDraftErr(null); setRepoErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addDraft(); } }}
                placeholder={UI.wsRepoPlaceholder}
                className="flex-1 font-mono text-[12px]"
              />
              <Button variant="secondary" locked={acting || saving} onClick={() => void addDraft()}>{UI.wsRepoAddManual}</Button>
              <Tooltip label={UI.cancel}>
                <Button variant="ghost" className="w-8.5 px-0 text-inkdim" aria-label={UI.cancel} onClick={closeAdd}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="mt-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {UI.wsRepoAdd}
            </Button>
          )}
          {draftErr ? <span role="alert" className="mt-1.5 block text-[11px] text-error">{draftErr}</span> : null}
        </section>

        {mode === 'edit' && workspace && settings ? (
          /* ===== WO-0059 rev 4: the per-workspace knobs, moved home from the global settings —
             the economics (budget) and the pointer (structure root) of THIS workspace. ===== */
          <section data-ws-knobs="">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.wsRootBudgetLabel}</span>
            <div data-budget-section="" className="grid grid-cols-2 gap-3">
              <Field label={UI.budgetCapLabel} error={capErr}>
                <Input
                  value={capText}
                  inputMode="decimal"
                  aria-label={UI.budgetCapLabel}
                  aria-invalid={capErr !== null}
                  onChange={(e) => { setCapText(e.target.value); setBudgetTouched(true); }}
                />
              </Field>
              <Field
                label={UI.budgetWarnPercentLabel}
                error={warnErr}
                hint={budgetStored ? undefined : `${DEFAULT_WARN_PERCENT}`}
              >
                <Input
                  value={warnText}
                  inputMode="decimal"
                  aria-label={UI.budgetWarnPercentLabel}
                  aria-invalid={warnErr !== null}
                  onChange={(e) => { setWarnText(e.target.value); setBudgetTouched(true); }}
                />
              </Field>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="primary" size="sm" busy={budgetBusy} locked={budgetBusy} onClick={() => void saveBudget()}>
                {UI.budgetSave}
              </Button>
              {budgetStored ? (
                <Button variant="ghost" size="sm" onClick={() => void clearBudget()}>{UI.budgetClear}</Button>
              ) : null}
              {budgetStored && monthSpend ? (
                <span
                  data-budget-month-readout=""
                  className="ml-auto font-mono text-[11px] text-inkdim"
                >
                  {monthSpend.hasUnknown
                    ? UI.budgetMonthReadoutKnown(monthSpend.usd, budgetStored.capUsd)
                    : UI.budgetMonthReadout(monthSpend.usd, budgetStored.capUsd)}
                </span>
              ) : null}
            </div>
            <div data-docs-root-section="">
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[13px] text-ink">{UI.docsRootLabel}</span>
                <Input
                  value={rootText}
                  aria-label={UI.docsRootLabel}
                  aria-invalid={rootErr !== null}
                  className="ml-auto w-44 font-mono"
                  onChange={(e) => { setRootText(e.target.value); setRootTouched(true); }}
                />
                <Button variant="primary" size="sm" busy={rootBusy} locked={rootBusy} onClick={() => void saveDocsRoot()}>
                  {UI.woEditSave}
                </Button>
              </div>
              {rootErr !== null ? (
                <p role="alert" className="mt-1.5 text-[11.5px] text-error">{rootErr}</p>
              ) : (
                <p className="mt-1.5 text-[11px] text-inkdim">{UI.docsRootWarn}</p>
              )}
            </div>
            {profileNames.length > 0 || wsProfile !== undefined ? (
              <div data-ws-profile-section="">
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[13px] text-ink">{UI.wsProfileLabel}</span>
                  <span className="ml-auto">
                    <Segmented
                      size="sm"
                      value={wsProfile !== undefined && profileNames.some((n) => sameProfileName(n, wsProfile)) ? profileNames.find((n) => sameProfileName(n, wsProfile))! : ''}
                      onValueChange={(v) => void saveWsProfile(v === '' ? undefined : v)}
                      options={[{ value: '', label: UI.profileDefaultName }, ...profileNames.map((n) => ({ value: n, label: n }))]}
                    />
                  </span>
                </div>
                {wsProfile !== undefined && !sameProfileName(wsProfile, DEFAULT_PROFILE) && !profileNames.some((n) => sameProfileName(n, wsProfile)) ? (
                  <p role="alert" className="mt-1.5 text-[11.5px] text-error">{UI.profileRefusedTitle(wsProfile, 'workspace')}</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
