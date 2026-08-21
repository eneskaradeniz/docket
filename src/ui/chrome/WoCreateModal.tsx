import { useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { RepoId, WorkOrder, Workspace } from '../../core/types';
import type { PermissionRule, ReviewMode, WorkOrderSource } from '../../core/source';
import { useLabels } from '../data/locale';
import { Button, Dialog, Field, Input, Segmented, Textarea, Tooltip } from '../kit';
import { toast } from './ToastHost';

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
  onClose,
  onCreated,
}: {
  workspace: Workspace;
  source: WorkOrderSource;
  /** The Settings default — the preselected rule (WO-0031c; the WO carries its own from here on). */
  defaultRule: PermissionRule;
  onClose: () => void;
  /** `withPlan` = the "Oluştur ve plan iste ⏎" path: create AND auto-start the architect (v3 §1). */
  onCreated: (wo: WorkOrder, withPlan?: boolean) => void;
}) {
  const { PERMISSION_RULE_LABELS, UI } = useLabels();
  // PRODUCT.md §Decisions 6: the decision store is a workspace setting, not a track. For a multi-repo
  // workspace the dedicated decision-store repo is excluded; a single-repo workspace keeps its repo
  // (it serves both roles). Tracks are code repos only.
  const trackOptions: RepoId[] =
    workspace.repos.length > 1 ? workspace.repos.filter((r) => r !== workspace.decisionStore) : workspace.repos;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<RepoId[]>(trackOptions);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('gates');
  const [permissionRule, setPermissionRule] = useState<PermissionRule>(defaultRule);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function toggleTrack(repo: RepoId) {
    setSelectedTracks((prev) => (prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]));
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
    try {
      const wo = await source.createWorkOrder({
        workspaceId: workspace.id,
        title: title.trim(),
        description: description.trim(),
        trackRepos: selectedTracks,
        reviewMode,
        contextFiles,
        permissionRule,
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
