import { useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { RepoId, WorkOrder, Workspace } from '../../core/types';
import type { PermissionRule, ReviewMode, WorkOrderSource } from '../../core/source';
import { useLabels } from '../data/locale';
import { Button, Dialog, Field, Input, Segmented, Textarea, Tooltip } from '../kit';
import { toast } from './ToastHost';
import type { WoSpawnPrefill } from '../components/roadmap/TaskRow';

const base = (p: string): string => {
  let s = p;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.split('/').pop() || 'file';
};

// "Yeni iş emri" creation modal (WO-0015; WO-0031 kit restyle — pulled forward from Phase B after the
// operator hit the half-cut legacy popup at min window size). The decision store is excluded from the
// track list when the workspace has a dedicated decision-store repo (PRODUCT.md §Decisions 6); a
// single-repo workspace keeps its one repo as a track. The Dialog's flex column + internal scroll keep
// it fully inside the viewport at ANY window size ≥ min.
// WO-0036: form errors sit under the field that caused them (persistent while invalid, first-invalid
// focused on submit); save failures toast top-right (hata) — a dialog footer carries no error copy
// (operator review round, 2026-08-21; the toast ladder sits above the dialog overlay by design).
export function WoCreateModal({
  workspace,
  source,
  defaultRule,
  prefill,
  onClose,
  onCreated,
}: {
  workspace: Workspace;
  source: WorkOrderSource;
  /** The Settings default — the preselected rule (WO-0031c; the WO carries its own from here on). */
  defaultRule: PermissionRule;
  /** WO-0049 (mockup kare 06): the roadmap task's spawn seed — the uneditable context line + the
   *  seeded fields + `task:` into order.md. Undefined = the plain board flow, untouched. */
  prefill?: WoSpawnPrefill;
  onClose: () => void;
  /** `withPlan` = the "Oluştur ve plan iste ⏎" path: create AND auto-start the architect (v3 §1). */
  onCreated: (wo: WorkOrder, withPlan?: boolean) => void;
}) {
  const { PERMISSION_RULE_LABELS, UI, fazLabel } = useLabels();
  // PRODUCT.md §Decisions 6: the decision store is a workspace setting, not a track. For a multi-repo
  // workspace the dedicated decision-store repo is excluded; a single-repo workspace keeps its repo
  // (it serves both roles). Tracks are code repos only.
  const trackOptions: RepoId[] =
    workspace.repos.length > 1 ? workspace.repos.filter((r) => r !== workspace.decisionStore) : workspace.repos;

  // WO-0049: the spawn seeds title/description/tracks — SEEDS, not locks; everything stays editable
  // ("gerisi bugünkü akışın aynısı"). The repo compare is a plain string compare against branded ids
  // — no identity constructor runs in ui (ADR-0003); an unresolvable seed leaves all tracks on, the
  // plain default.
  const seededTracks = prefill?.repo !== undefined && trackOptions.some((r) => (r as string) === prefill.repo)
    ? trackOptions.filter((r) => (r as string) === prefill.repo)
    : trackOptions;
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [description, setDescription] = useState(prefill?.note ?? '');
  const [selectedTracks, setSelectedTracks] = useState<RepoId[]>(prefill !== undefined ? seededTracks : trackOptions);
  // WO-0071: per-track depends_on picks — the track's RepoId keyed by its string form (a plain
  // string compare against branded ids, the seededTracks precedent; no identity constructor in ui).
  const [depSelection, setDepSelection] = useState<Record<string, RepoId[]>>({});
  const [reviewMode, setReviewMode] = useState<ReviewMode>('gates');
  const [permissionRule, setPermissionRule] = useState<PermissionRule>(defaultRule);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  // WO-0088: the wave worktree — the WO's own working copy; empty = the connection table resolves.
  const [cwd, setCwd] = useState('');
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function toggleTrack(repo: RepoId) {
    const on = selectedTracks.includes(repo);
    setSelectedTracks(on ? selectedTracks.filter((r) => r !== repo) : [...selectedTracks, repo]);
    // A deselected track loses its own picks AND every pick naming it — a stale entry must not
    // resurrect as a dependency when the repo comes back.
    if (on) {
      setDepSelection((prev) => {
        const next: Record<string, RepoId[]> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k !== (repo as string)) next[k] = v.filter((x) => x !== repo);
        }
        return next;
      });
    }
  }

  function toggleDep(track: RepoId, dep: RepoId) {
    setDepSelection((prev) => {
      const cur = prev[track as string] ?? [];
      const next = cur.includes(dep) ? cur.filter((x) => x !== dep) : [...cur, dep];
      const record: Record<string, RepoId[]> = { ...prev, [track as string]: next };
      if (next.length === 0) delete record[track as string];
      return record;
    });
  }

  async function pickContext() {
    try {
      const picked = await window.docket.pickFiles();
      if (picked) setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))]);
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed }); // B5: surface, don't vanish — as a toast
    }
  }
  function removeContext(i: number) {
    setContextFiles((prev) => prev.filter((_p, idx) => idx !== i));
  }

  async function save(withPlan = false) {
    // WO-0036: the refusal lands under the field and takes the focus — the WsSettingsModal contract.
    if (!title.trim()) {
      setTitleErr(UI.woErrTitle);
      titleRef.current?.focus();
      return;
    }
    setTitleErr(null);
    // WO-0071: only tracks WITH ≥1 pick enter the payload; a pick naming a since-deselected track
    // never rides. Empty map → the field stays absent (the pre-WO-0071 call, byte-for-byte).
    const picked = selectedTracks
      .map((t) => ({ repo: t, dependsOn: (depSelection[t as string] ?? []).filter((d) => selectedTracks.includes(d)) }))
      .filter((e) => e.dependsOn.length > 0);
    try {
      const wo = await source.createWorkOrder({
        workspaceId: workspace.id,
        title: title.trim(),
        description: description.trim(),
        trackRepos: selectedTracks,
        reviewMode,
        contextFiles,
        permissionRule,
        // WO-0049: the task→WO link — the task identity, written regardless of the track selection.
        ...(prefill !== undefined ? { taskRef: prefill.taskId } : {}),
        ...(picked.length > 0 ? { trackDependencies: picked } : {}),
        ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
      });
      onCreated(wo, withPlan);
      onClose();
    } catch {
      // B5: the modal stays open (the draft survives) — the refusal itself is a toast, never footer copy.
      toast.push({ kind: 'error', title: UI.saveFailed });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.woCreate}
      closeAria={UI.dialogCloseAria}
      wide
      // WO-0036: Radix would focus the first focusable (the close X); preventDefault lets the
      // title Input's autoFocus win — the DetailStrip edit dialog's workaround, ported.
      onOpenAutoFocus={(e) => e.preventDefault()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.close}</Button>
          <Button variant="secondary" size="sm" onClick={() => void save()}>{UI.woCreateBtn}</Button>
          <Button variant="primary" size="sm" className="min-w-[150px]" onClick={() => void save(true)}>{UI.createAndPlan}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {prefill !== undefined ? (
          // Kare 06: the ONE uneditable line — where this WO comes from. Display-only (not focusable);
          // the seeded fields below it stay fully editable.
          <div
            data-task-context
            className="flex items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-1.5"
          >
            <span className="font-mono text-[10.5px] tracking-wide text-signal">
              {UI.roadmapSpawnContext(fazLabel(prefill.fazId), prefill.ordinal, prefill.title, prefill.repo)}
            </span>
          </div>
        ) : null}
        <Field label={UI.woTitleLabel} error={titleErr}>
          <Input
            ref={titleRef}
            autoFocus
            aria-required="true"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleErr(null); }}
            placeholder={UI.woTitlePlaceholder}
          />
        </Field>

        <Field label={UI.woDescLabel}>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={UI.woDescPlaceholder} className="font-sans text-[13px]" />
        </Field>

        {trackOptions.length > 0 ? (
          <section>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woTracksLabel}</span>
            <div className="flex flex-wrap gap-2">
              {trackOptions.map((r) => {
                const checked = selectedTracks.includes(r);
                return (
                  <button
                    type="button"
                    key={r as string}
                    aria-pressed={checked}
                    onClick={() => toggleTrack(r)}
                    className={`ichip inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${checked ? 'ichip-on' : ''}`}
                  >
                    <span aria-hidden="true" className={`font-mono text-[11px] ${checked ? 'text-info' : ''}`}>{checked ? '✓' : '○'}</span>
                    <span className="font-mono text-[11px]">{r as string}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* WO-0071: the per-track depends_on picker — absent below 2 selected tracks (one track has
            nothing to depend on, ADR-0001); a track's own chip is simply never rendered, so
            self-dependence has no path in (the store validator is the second layer). */}
        {selectedTracks.length >= 2 ? (
          <section>
            <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.createDependsTitle}</span>
            <span className="mb-2 block text-[11px] text-inkdim">{UI.createDependsHint}</span>
            <div className="flex flex-col gap-2">
              {selectedTracks.map((t) => (
                <div key={t as string} className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-[88px] font-mono text-[11px]">{t as string}</span>
                  {selectedTracks
                    .filter((o) => o !== t)
                    .map((o) => {
                      const on = (depSelection[t as string] ?? []).includes(o);
                      return (
                        <button
                          type="button"
                          key={o as string}
                          aria-pressed={on}
                          onClick={() => toggleDep(t, o)}
                          className={`ichip inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${on ? 'ichip-on' : ''}`}
                        >
                          <span aria-hidden="true" className={`font-mono text-[11px] ${on ? 'text-info' : ''}`}>{on ? '✓' : '○'}</span>
                          <span className="font-mono text-[11px]">{o as string}</span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woContextLabel}</span>
          {contextFiles.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {contextFiles.map((p, i) => (
                <span key={p} title={p} className="inline-flex items-center gap-1 rounded border border-hairline bg-bg px-2 py-0.5 font-mono text-[11px] text-inkdim">
                  {base(p)}
                  <Tooltip label={UI.removeAria}><button type="button" onClick={() => removeContext(i)} className="ibtn ibtn-danger px-0.5" aria-label={UI.removeAria}><X className="h-3 w-3" aria-hidden="true" /></button></Tooltip>
                </span>
              ))}
            </div>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void pickContext()}>
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {UI.woContextAdd}
          </Button>
        </section>

        {/* WO-0088: the per-WO working copy — the wave worktree; absent = the connection table. */}
        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woCwdLabel}</span>
          <input
            type="text"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder={UI.woCwdPlaceholder}
            aria-label={UI.woCwdLabel}
            className="w-full rounded-md border border-hairline bg-bg px-2 py-1.5 font-mono text-[12px] text-ink placeholder:text-inkdim focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
          />
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woReviewLabel}</span>
          <Segmented
            value={reviewMode}
            onValueChange={setReviewMode}
            options={[
              { value: 'gates', label: UI.reviewModeGatesShort },
              { value: 'every-step', label: UI.reviewModeEveryShort },
            ]}
          />
        </section>

        {/* WO-0031c: the rule lives on the work order; Settings holds only this default. */}
        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.permRuleQuestion}</span>
          <Segmented
            value={permissionRule}
            onValueChange={setPermissionRule}
            options={[
              { value: 'ask_every', label: PERMISSION_RULE_LABELS.ask_every },
              { value: 'risky_excluded', label: PERMISSION_RULE_LABELS.risky_excluded },
              { value: 'full_auto', label: PERMISSION_RULE_LABELS.full_auto },
            ]}
          />
        </section>
      </div>
    </Dialog>
  );
}
