import { useEffect, useState } from 'react';
import type { Workspace, WorkspaceId } from '../../core/types';
import { UI } from '../data/labels';

export function WsListModal({
  workspaces,
  selectedId,
  onSwitch,
  onEdit,
  onCreate,
  onClose,
}: {
  workspaces: Workspace[];
  selectedId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
  onEdit: (ws: Workspace) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);
  const filtered = workspaces.filter((w) => w.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center px-4 pt-24" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl rounded-md border border-rule bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{UI.wsListTitle}</h2>
            <p className="mt-0.5 text-[12px] text-inkdim">{UI.wsListSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={UI.close} className="-mr-1.5 -mt-1.5 grid h-7 w-7 place-items-center rounded text-[14px] text-inkdim hover:bg-surface2 hover:text-ink">✕</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={UI.wsListFilter} className="mb-3 w-full rounded border border-rule bg-bg px-3 py-2 text-[14px] text-ink outline-none" />
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
          {filtered.length ? filtered.map((w) => {
            const on = w.id === selectedId;
            return (
              <div key={w.id as string} className={`flex items-center gap-2 rounded px-3 py-2.5 text-[14px] hover:bg-surface2 ${on ? 'font-semibold' : ''}`} style={on ? { background: 'color-mix(in srgb, var(--color-brass) 12%, transparent)' } : undefined}>
                <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={() => { onSwitch(w.id); onClose(); }}>
                  <span className="w-4 text-center text-brass">{on ? '✓' : ''}</span>
                  <span className="text-ink">{w.label}</span>
                </button>
                <button type="button" onClick={() => onEdit(w)} className="grid h-8 w-8 place-items-center rounded border border-rule text-[14px] text-inkdim hover:border-brass hover:text-ink" aria-label={UI.wsSettings}>⚙</button>
              </div>
            );
          }) : <p className="px-3 py-2 text-[13px] text-inkdim">{UI.wsListEmpty}</p>}
        </div>
        <div className="mt-3 border-t border-rule pt-3">
          <button type="button" onClick={() => { onClose(); onCreate(); }} className="alink text-[12px]">{UI.wsListCreate}</button>
        </div>
      </div>
    </div>
  );
}
