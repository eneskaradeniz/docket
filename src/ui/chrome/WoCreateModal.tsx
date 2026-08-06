import { useEffect, useState } from 'react';
import type { RepoId, WorkOrder, Workspace } from '../../core/types';
import type { ReviewMode, WorkOrderSource } from '../../core/source';
import { UI } from '../data/labels';

const base = (p: string): string => {
  let s = p;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.split('/').pop() || 'file';
};

// "Yeni iş emri" creation modal (WO-0015). The decision store is excluded from the track list when the
// workspace has a dedicated decision-store repo (PRODUCT.md §Decisions 6); a single-repo workspace keeps
// its one repo as a track (it is both code and the docs/ decision store). Mirrors WsSettingsModal's shell.
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

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  function toggleTrack(repo: RepoId) {
    setSelectedTracks((prev) => (prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]));
  }

  async function pickContext() {
    const picked = await window.docket.pickFiles();
    if (picked) setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))]);
  }
  function removeContext(i: number) {
    setContextFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!title.trim()) return;
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
      /* best-effort — the modal stays open so the operator can retry */
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center px-4 pt-24" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-md border border-rule bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{UI.woCreate}</h2>
            <p className="mt-0.5 text-[12px] text-inkdim">{UI.woCreateSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={UI.close} className="-mr-1.5 -mt-1.5 grid h-7 w-7 place-items-center rounded text-[14px] text-inkdim hover:bg-surface2 hover:text-ink">✕</button>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.woTitleLabel}</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={UI.woTitlePlaceholder}
          className="mb-3 w-full rounded border border-rule bg-bg px-3 py-2 text-[14px] text-ink outline-none"
        />

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.woDescLabel}</label>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={UI.woDescPlaceholder}
          className="mb-3 w-full rounded border border-rule bg-bg px-3 py-2 text-[13px] text-ink outline-none"
        />

        {trackOptions.length > 0 ? (
          <>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.woTracksLabel}</label>
            <p className="mb-2 text-[11px] text-inkdim">{UI.woTracksHint}</p>
            <div className="mb-3 flex flex-wrap gap-2 text-[12px]">
              {trackOptions.map((r) => {
                const checked = selectedTracks.includes(r);
                return (
                  <button
                    type="button"
                    key={r as string}
                    onClick={() => toggleTrack(r)}
                    className={`flex items-center gap-1.5 rounded border border-rule px-2 py-1 ${checked ? 'bg-surface2 text-ink' : 'bg-bg text-inkdim'}`}
                  >
                    <span className={checked ? 'evx' : 'inkdim'}>{checked ? '✓' : '○'}</span>
                    <span className="font-mono text-[11px]">{r as string}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.woContextLabel}</label>
        <div className="mb-3">
          {contextFiles.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {contextFiles.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded border border-rule bg-bg px-2 py-0.5 font-mono text-[11px] text-inkdim">
                  {base(p)}
                  <button type="button" onClick={() => removeContext(i)} className="err px-0.5 text-[12px]">✕</button>
                </span>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={pickContext} className="alink text-[12px]">{UI.woContextAdd}</button>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.woReviewLabel}</label>
        <div className="mb-5 flex flex-col gap-1.5 text-[12px]">
          <label className="flex items-start gap-1.5">
            <input type="radio" name="review" checked={reviewMode === 'gates'} onChange={() => setReviewMode('gates')} className="mt-0.5" style={{ accentColor: 'var(--color-brass)' }} />
            <span>{UI.woReviewGates}</span>
          </label>
          <label className="flex items-start gap-1.5">
            <input type="radio" name="review" checked={reviewMode === 'every-step'} onChange={() => setReviewMode('every-step')} className="mt-0.5" style={{ accentColor: 'var(--color-brass)' }} />
            <span>{UI.woReviewEvery}</span>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost rounded px-4 py-1.5 text-[12px]">{UI.close}</button>
          <button type="button" onClick={save} className="btn-primary rounded px-4 py-1.5 text-[12px]">{UI.woCreateBtn}</button>
        </div>
      </div>
    </div>
  );
}
