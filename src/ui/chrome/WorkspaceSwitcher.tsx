import { useEffect, useRef, useState } from 'react';
import type { Workspace, WorkspaceId } from '../../core/types';
import { UI } from '../data/labels';

const MAX_WS = 4;

export function WorkspaceSwitcher({
  workspaces,
  selectedId,
  onSwitch,
  onEdit,
  onCreate,
  onOpenList,
}: {
  workspaces: Workspace[];
  selectedId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
  onEdit: (ws: Workspace) => void;
  onCreate: () => void;
  onOpenList: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const selected = workspaces.find((w) => w.id === selectedId);
  const shown = workspaces.slice(0, MAX_WS);
  const overflow = workspaces.length > MAX_WS;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded">
        <span className="text-lg leading-none text-signal">▎</span>
        <span className="text-[14px] font-semibold tracking-tight text-ink">{selected?.label}</span>
        <span className="font-mono text-[11px] text-inkdim">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-9 w-72 rounded-md border border-hairline bg-surface p-1 shadow-xl">
          {shown.map((w) => {
            const on = w.id === selectedId;
            return (
              <div key={w.id as string} className={`flex items-center gap-1 rounded px-1 py-1 ${on ? 'bg-raised' : 'hover:bg-raised/60'}`}>
                <button type="button" className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-[13px]" onClick={() => { onSwitch(w.id); setOpen(false); }}>
                  <span className="w-3 text-center text-signal">{on ? '✓' : ''}</span>
                  <span className={on ? 'font-semibold text-ink' : 'text-ink'}>{w.label}</span>
                </button>
                <button type="button" onClick={() => { onEdit(w); setOpen(false); }} className="grid h-8 w-8 place-items-center rounded border border-hairline text-[14px] text-inkdim hover:border-inkdim hover:text-ink" aria-label={UI.wsSettings}>⚙</button>
              </div>
            );
          })}
          {overflow ? (
            <button type="button" onClick={() => { onOpenList(); setOpen(false); }} className="mt-1 w-full rounded px-2.5 py-1.5 text-[12px] text-inkdim hover:bg-raised">
              {UI.wsAll} ({workspaces.length}) ▾
            </button>
          ) : null}
          <div className="my-1 border-t border-hairline" />
          <button type="button" onClick={() => { onCreate(); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-[13px] text-signal">
            <span className="font-mono">▸</span> {UI.wsCreate}
          </button>
        </div>
      ) : null}
    </div>
  );
}
