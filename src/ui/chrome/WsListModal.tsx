import { useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import type { Workspace, WorkspaceId } from '../../core/types';
import { UI } from '../data/labels';
import { Button, Dialog, Input, Tooltip } from '../kit';

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
  const filtered = workspaces.filter((w) => w.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.wsListTitle}
      closeAria={UI.dialogCloseAria}
      wide
      footer={
        <Button variant="secondary" size="sm" onClick={() => { onClose(); onCreate(); }}>{UI.wsListCreate}</Button>
      }
    >
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={UI.wsListFilter} className="mb-3" />
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        {filtered.length ? filtered.map((w) => {
          const on = w.id === selectedId;
          return (
            <div
              key={w.id as string}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-[14px] transition-colors ${on ? 'bg-raised font-semibold' : 'irow'}`}
            >
              <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={() => { onSwitch(w.id); onClose(); }}>
                <span className={`w-4 text-center ${on ? 'text-signal' : ''}`}>{on ? <Check className="inline h-3.5 w-3.5" aria-hidden="true" /> : null}</span>
                <span className="text-ink">{w.label}</span>
              </button>
              <Tooltip label={UI.wsSettings}>
                <button
                  type="button"
                  onClick={() => onEdit(w)}
                  className="ibtn h-8 w-8 border border-hairline"
                  aria-label={UI.wsSettings}
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          );
        }) : <p className="px-3 py-2 text-[13px] text-inkdim">{UI.wsListEmpty}</p>}
      </div>
    </Dialog>
  );
}
