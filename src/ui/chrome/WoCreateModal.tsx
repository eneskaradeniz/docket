import { useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { RepoId, WorkOrder, Workspace } from '../../core/types';
import type { ReviewMode, WorkOrderSource } from '../../core/source';
import { UI } from '../data/labels';
import { Button, Dialog, Field, Input, Segmented, Textarea } from '../kit';

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
export function WoCreateModal({
  workspace,
  source,
  onClose,
  onCreated,
}: {
  workspace: Workspace;
  source: WorkOrderSource;
  onClose: () => void;
  onCreated: (wo: WorkOrder) => void;
}) {
  // PRODUCT.md §Decisions 6: the decision store is a workspace setting, not a track. For a multi-repo
  // workspace the dedicated decision-store repo is excluded; a single-repo workspace keeps its repo
  // (it serves both roles). Tracks are code repos only.
  const trackOptions: RepoId[] =
    workspace.repos.length > 1 ? workspace.repos.filter((r) => r !== workspace.decisionStore) : workspace.repos;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<RepoId[]>(trackOptions);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('gates');
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null); // B5: a failed save must surface, not vanish

  function toggleTrack(repo: RepoId) {
    setSelectedTracks((prev) => (prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]));
  }

  async function pickContext() {
    try {
      const picked = await window.docket.pickFiles();
      if (picked) setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))]);
    } catch {
      setError(UI.saveFailed);
    }
  }
  function removeContext(i: number) {
    setContextFiles((prev) => prev.filter((_p, idx) => idx !== i));
  }

  async function save() {
    if (!title.trim()) {
      setError(UI.woErrTitle);
      return;
    }
    setError(null);
    try {
      const wo = await source.createWorkOrder({
        workspaceId: workspace.id,
        title: title.trim(),
        description: description.trim(),
        trackRepos: selectedTracks,
        reviewMode,
        contextFiles,
      });
      onCreated(wo);
      onClose();
    } catch {
      setError(UI.saveFailed); // B5: the modal stays open — and says WHY
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.woCreate}
      wide
      footer={
        <>
          {error ? <span className="mr-auto text-[11px] text-error">{error}</span> : null}
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.close}</Button>
          <Button variant="primary" size="sm" onClick={() => void save()}>{UI.woCreateBtn}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="-mt-1 text-[12px] text-inkdim">{UI.woCreateSubtitle}</p>

        <Field label={UI.woTitleLabel}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={UI.woTitlePlaceholder} />
        </Field>

        <Field label={UI.woDescLabel}>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={UI.woDescPlaceholder} className="font-sans text-[13px]" />
        </Field>

        {trackOptions.length > 0 ? (
          <section>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woTracksLabel}</span>
            <p className="mb-2 text-[11px] text-inkdim">{UI.woTracksHint}</p>
            <div className="flex flex-wrap gap-2">
              {trackOptions.map((r) => {
                const checked = selectedTracks.includes(r as RepoId);
                return (
                  <button
                    type="button"
                    key={r as string}
                    aria-pressed={checked}
                    onClick={() => toggleTrack(r)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors ${checked ? 'border-info/60 bg-info/10 text-ink' : 'border-hairline bg-bg text-inkdim hover:text-ink'}`}
                  >
                    <span className={`font-mono text-[11px] ${checked ? 'text-info' : ''}`}>{checked ? '✓' : '○'}</span>
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
                <span key={i} className="inline-flex items-center gap-1 rounded border border-hairline bg-bg px-2 py-0.5 font-mono text-[11px] text-inkdim">
                  {base(p)}
                  <button type="button" onClick={() => removeContext(i)} className="text-error px-0.5" aria-label="kaldır"><X className="h-3 w-3" aria-hidden="true" /></button>
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
              { value: 'gates', label: UI.modeSimple },
              { value: 'every-step', label: UI.modeEveryStep },
            ]}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-inkdim">{reviewMode === 'gates' ? UI.woReviewGates : UI.woReviewEvery}</p>
        </section>
      </div>
    </Dialog>
  );
}
