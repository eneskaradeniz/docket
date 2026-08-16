// AppShell — the console's top bar (WO-0031 "Kontrol Konsolu"). A 48px drag-region title bar (the
// macOS traffic lights live in it via hiddenInset); the wordmark, a compact workspace switcher, the one
// primary action (+ Yeni iş emri) and the settings gear. All copy via labels.ts (ADR-0007); the theme
// toggle is gone (dark-only ruling).
import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import type { Workspace, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { AppSettings } from '../../core/app-settings';
import { UI } from '../data/labels';
import { Button, Tooltip } from '../kit';
import { AppSettingsModal } from './AppSettingsModal';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WsSettingsModal } from './WsSettingsModal';
import { WsListModal } from './WsListModal';

export function AppShell({
  workspaces,
  workspaceId,
  onSwitch,
  source,
  settings,
  onWorkspacesChanged,
  onNewWorkOrder,
}: {
  workspaces: Workspace[];
  workspaceId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
  source: WorkOrderSource;
  settings: AppSettings;
  onWorkspacesChanged: () => void;
  onNewWorkOrder: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wsModal, setWsModal] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingWs, setEditingWs] = useState<Workspace | undefined>(undefined);
  const [wsListOpen, setWsListOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-4 border-b border-hairline bg-surface/85 pl-[92px] pr-4 backdrop-blur-md"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="select-none font-mono text-[12px] font-semibold uppercase tracking-[0.22em] text-ink">
          {UI.productName}
        </span>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WorkspaceSwitcher
            workspaces={workspaces}
            selectedId={workspaceId}
            onSwitch={onSwitch}
            onEdit={(ws) => { setEditingWs(ws); setWsModal('edit'); }}
            onCreate={() => { setEditingWs(undefined); setWsModal('create'); }}
            onOpenList={() => setWsListOpen(true)}
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button variant="primary" size="sm" onClick={onNewWorkOrder}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {UI.newWorkOrder}
          </Button>
          <Tooltip label={UI.settings}>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={UI.settings}
              className="rounded-md p-2 text-inkdim transition-colors hover:bg-raised hover:text-ink"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>
      {settingsOpen ? <AppSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} /> : null}
      {wsModal !== 'closed' ? (
        <WsSettingsModal
          mode={wsModal}
          workspace={editingWs}
          source={source}
          onClose={() => setWsModal('closed')}
          onSaved={onWorkspacesChanged}
        />
      ) : null}
      {wsListOpen ? (
        <WsListModal
          workspaces={workspaces}
          selectedId={workspaceId}
          onSwitch={onSwitch}
          onEdit={(ws) => { setWsListOpen(false); setEditingWs(ws); setWsModal('edit'); }}
          onCreate={() => { setWsListOpen(false); setEditingWs(undefined); setWsModal('create'); }}
          onClose={() => setWsListOpen(false)}
        />
      ) : null}
    </>
  );
}
