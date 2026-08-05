import { useEffect, useState } from 'react';
import type { Workspace } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import { UI } from '../data/labels';

const base = (p: string): string => {
  let s = p;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.split('/').pop() || 'repo';
};
const valid = (p: string): boolean => p.startsWith('/') && p.length > 1 && !p.endsWith('/');

// Workspace create/edit modal (WO-0014). Create = full form (name + folder-picked repos + decision
// store). Edit = rename + set decision store + add repos. Mirrors AppSettingsModal's shell.
export function WsSettingsModal({
  mode,
  workspace,
  source,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  workspace?: Workspace;
  source: WorkOrderSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workspace?.label ?? '');
  const [paths, setPaths] = useState<string[]>([]);
  const [decisionStore, setDecisionStore] = useState('');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const allRepos = [
    ...(workspace?.repos.map((r) => r as string) ?? []),
    ...paths.map(base),
  ];

  async function pick() {
    const p = await window.docket.pickFolder();
    if (p) setPaths((prev) => [...prev, p]);
  }
  function removePath(i: number) {
    setPaths((prev) => prev.filter((_, idx) => idx !== i));
  }
  async function save() {
    if (!name.trim()) return;
    try {
      if (mode === 'create') {
        await source.createWorkspace({
          label: name.trim(),
          repos: paths.map((p) => ({ path: p })),
          decisionStorePath: decisionStore || undefined,
        });
      } else if (workspace) {
        await source.updateWorkspace(workspace.id, { label: name.trim(), decisionStorePath: decisionStore || undefined });
        for (const p of paths) {
          await source.addRepoConnection(workspace.id, { path: p });
        }
      }
      onSaved();
      onClose();
    } catch {
      /* best-effort — the caller can retry */
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center px-4 pt-24" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-md border border-rule bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{mode === 'create' ? UI.wsCreate : UI.wsSettings}</h2>
            <p className="mt-0.5 text-[12px] text-inkdim">{UI.wsSettingsSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={UI.close} className="-mr-1.5 -mt-1.5 grid h-7 w-7 place-items-center rounded text-[14px] text-inkdim hover:bg-surface2 hover:text-ink">✕</button>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.wsNameLabel}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mb-4 w-full rounded border border-rule bg-bg px-3 py-2 text-[14px] text-ink outline-none" />

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.wsReposLabel}</label>
        <p className="mb-2 text-[11px] text-inkdim">{UI.wsReposHint}</p>
        {mode === 'edit' && workspace ? (
          <div className="mb-2 flex flex-col gap-1">
            {workspace.repos.map((r) => (
              <div key={r as string} className="flex items-center gap-2 rounded border border-rule bg-bg px-2 py-1.5">
                <span className="font-mono text-[12px] text-inkdim">↳ {r as string}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mb-2 flex flex-col gap-1.5">
          {paths.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded border border-rule bg-bg px-2 py-1.5">
              <span className={`text-[12px] ${valid(p) ? 'evx' : 'err'}`}>{valid(p) ? '✓' : '✕'}</span>
              <span className="flex-1 font-mono text-[11px] text-inkdim">{p}</span>
              <button type="button" onClick={() => removePath(i)} className="err px-1 text-[14px]">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={pick} className="alink mb-4 text-[12px]">{UI.wsRepoAdd}</button>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">{UI.wsDecisionStore}</label>
        <select value={decisionStore} onChange={(e) => setDecisionStore(e.target.value)} className="mb-5 w-full rounded border border-rule bg-bg px-3 py-2 text-[14px] text-ink outline-none">
          <option value="">{UI.wsDecisionSameRepo}</option>
          {allRepos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost rounded px-4 py-1.5 text-[12px]">{UI.close}</button>
          <button type="button" onClick={save} className="btn-primary rounded px-4 py-1.5 text-[12px]">{mode === 'create' ? UI.wsCreateBtn : UI.wsSave}</button>
        </div>
      </div>
    </div>
  );
}
