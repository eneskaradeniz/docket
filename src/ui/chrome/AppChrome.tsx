import { useState } from 'react';
import type { Workspace, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { AppSettings } from '../../core/app-settings';
import { UI } from '../data/labels';
import { AppSettingsModal } from './AppSettingsModal';
import type { ThemeMode } from './use-theme';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WsSettingsModal } from './WsSettingsModal';
import { WsListModal } from './WsListModal';

export function AppChrome({
  workspaces,
  workspaceId,
  onSwitch,
  theme,
  setTheme,
  source,
  settings,
  onWorkspacesChanged,
}: {
  workspaces: Workspace[];
  workspaceId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  source: WorkOrderSource;
  settings: AppSettings;
  onWorkspacesChanged: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wsModal, setWsModal] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingWs, setEditingWs] = useState<Workspace | undefined>(undefined);
  const [wsListOpen, setWsListOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-20 border-b border-rule"
        style={{ background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)', backdropFilter: 'blur(8px)' }}
      >
        <div className="mx-auto flex max-w-3xl items-center px-6 py-3.5">
          <WorkspaceSwitcher
            workspaces={workspaces}
            selectedId={workspaceId}
            onSwitch={onSwitch}
            onEdit={(ws) => { setEditingWs(ws); setWsModal('edit'); }}
            onCreate={() => { setEditingWs(undefined); setWsModal('create'); }}
            onOpenList={() => setWsListOpen(true)}
          />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={UI.settings}
            className="ml-auto rounded p-2 text-[16px] text-inkdim hover:bg-surface2 hover:text-ink"
          >
            ⚙
          </button>
        </div>
      </header>
      {settingsOpen ? (
        <AppSettingsModal theme={theme} setTheme={setTheme} settings={settings} onClose={() => setSettingsOpen(false)} />
      ) : null}
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
