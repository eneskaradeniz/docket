import { useEffect, useRef, useState } from 'react';
import type { Workspace, WorkspaceId } from '../../core/types';

// Read-only workspace popover (WO-0013). CRUD + repo connections come in WO-0014; here it just
// switches, with the current workspace marked. Closes on outside-click and Escape.
export function WorkspaceSwitcher({
  workspaces,
  selectedId,
  onSwitch,
}: {
  workspaces: Workspace[];
  selectedId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const selected = workspaces.find((w) => w.id === selectedId);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded">
        <span className="text-lg leading-none text-brass">▎</span>
        <span className="text-[14px] font-semibold tracking-tight text-ink">{selected?.label}</span>
        <span className="font-mono text-[11px] text-inkdim">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-9 w-60 rounded-md border border-rule bg-surface p-1 shadow-xl">
          {workspaces.map((w) => {
            const on = w.id === selectedId;
            return (
              <button
                key={w.id as string}
                type="button"
                onClick={() => {
                  onSwitch(w.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] hover:bg-surface2"
                style={on ? { background: 'color-mix(in srgb, var(--color-brass) 12%, transparent)' } : undefined}
              >
                <span className="w-3 text-center text-brass">{on ? '✓' : ''}</span>
                <span className={`flex-1 ${on ? 'font-semibold text-ink' : 'text-ink'}`}>{w.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
