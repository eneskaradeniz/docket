// AppShell — the console's top bar (WO-0031 "Kontrol Konsolu"). A 48px drag-region title bar (the
// macOS traffic lights live in it via hiddenInset); the wordmark, a compact workspace switcher, the one
// primary action (+ Yeni iş emri) and the settings gear. All copy via the locale bundles (ADR-0007);
// the theme selector lives in Settings (WO-0040) — no header toggle.
import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import type { Workspace, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { AppSettings } from '../../core/app-settings';
import { useLabels } from '../data/locale';
import { Button, Segmented, Tooltip } from '../kit';
import { AppbarDriveChip } from './AppbarDriveChip';
import { AppSettingsModal } from './AppSettingsModal';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WsDeleteDialog } from './WsDeleteDialog';
import { WsSettingsModal } from './WsSettingsModal';
import { WsListModal } from './WsListModal';

/** WO-0049: the sibling surfaces — the board and the roadmap (ADR-0016 karar 4); WO-0054 adds
 *  the third, the usage month (`Kullanım`); WO-0072 adds the fourth, the workspace overview
 *  (`Genel bakış` — its label key is `overviewTitle`, the WO's own pinned vocabulary). */
export type Surface = 'board' | 'roadmap' | 'usage' | 'overview';

/** WO-0060: the drive/limit chip's input — ACCOUNT health at a glance. `running` is the drive
 *  count (the architecture runs one at a time; 0/1); `limitResetAt` is the account-wide in-effect
 *  stamp (App folds every WO's rows + the live stamp through core's `limitInEffect`); `limitWarn`
 *  carries the provider's own warning window while a drive runs — its PRESENCE is the amber arm,
 *  so this file never hears the fold's status word. Presentational: no drive-store import. */
export interface AppbarActivity {
  running: number;
  limitResetAt?: string;
  limitWarn?: { window: string; utilization: number | null; resetAt: string | null };
}

export function AppShell({
  workspaces,
  workspaceId,
  onSwitch,
  source,
  settings,
  onWorkspacesChanged,
  onNewWorkOrder,
  onDeleteWorkspace,
  wsWoCount,
  wsDriveLive,
  onBudgetChanged,
  onDocsRootChanged,
  surface,
  onSurfaceChange,
  driveActivity,
}: {
  workspaces: Workspace[];
  /** null on an empty database — the brand + gear stay; the workspace-dependent parts are absent. */
  workspaceId: WorkspaceId | null;
  onSwitch: (id: WorkspaceId) => void;
  source: WorkOrderSource;
  settings: AppSettings;
  onWorkspacesChanged: () => void;
  onNewWorkOrder: () => void;
  /** WO-0032: delete the workspace (full cascade) — App owns the post-delete cleanup + refresh. */
  onDeleteWorkspace: (ws: Workspace) => Promise<void>;
  /** WO-0032: the workspace's work-order count — the confirm dialog's consequence line. */
  wsWoCount: (id: WorkspaceId) => number;
  /** WO-0032: any live drive in the workspace — gates the Sil entry (ADR-0001: absent + reason). */
  wsDriveLive: (id: WorkspaceId) => boolean;
  /** WO-0047: fired when the budget threshold changes in the settings modal — App refreshes its view. */
  onBudgetChanged: () => void;
  /** WO-0049: fired when the structure root changes — App re-reads the roadmap. */
  onDocsRootChanged: () => void;
  /** WO-0049: the active sibling surface — the switch sits beside `+ Yeni iş emri`. */
  surface: Surface;
  onSurfaceChange: (s: Surface) => void;
  /** WO-0060: the drive/limit chip's facts — account-wide, so it renders OUTSIDE the
   *  `workspaceId !== null` guard: an account fact is not workspace-scoped. */
  driveActivity: AppbarActivity;
}) {
  const { UI } = useLabels();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // WO-0032: 'delete' is the confirm that renders OVER 'edit' (the WO dialogs' pattern — the
  // invoker stays mounted, Vazgeç returns to it with edits intact); only a successful delete
  // closes both, so a deleted workspace's settings modal never reappears.
  const [wsModal, setWsModal] = useState<'closed' | 'create' | 'edit' | 'delete'>('closed');
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
        {workspaceId !== null ? (
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
        ) : null}
        <div className="ml-auto flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* WO-0060: first child of the no-drag cluster, outside the workspace guard — a chip in the
              drag half would swallow window drags; the account fact outlives workspaces. */}
          <AppbarDriveChip activity={driveActivity} />
          {workspaceId !== null ? (
            <>
              <Segmented
                size="sm"
                value={surface}
                onValueChange={onSurfaceChange}
                options={[
                  { value: 'board', label: UI.surfaceBoard },
                  { value: 'roadmap', label: UI.surfaceRoadmap },
                  { value: 'usage', label: UI.surfaceUsage },
                  { value: 'overview', label: UI.overviewTitle },
                ]}
              />
              <Button variant="primary" size="sm" onClick={onNewWorkOrder}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {UI.newWorkOrder}
              </Button>
            </>
          ) : null}
          <Tooltip label={UI.settings}>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={UI.settings}
              className="ibtn"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>
      {settingsOpen ? (
        <AppSettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {(wsModal === 'edit' || wsModal === 'delete') && editingWs ? (
        <WsSettingsModal
          mode="edit"
          workspace={editingWs}
          source={source}
          settings={settings}
          onClose={() => setWsModal('closed')}
          onSaved={onWorkspacesChanged}
          onDeleteWorkspace={() => setWsModal('delete')}
          driveLive={wsDriveLive(editingWs.id)}
          onBudgetChanged={onBudgetChanged}
          onDocsRootChanged={onDocsRootChanged}
        />
      ) : null}
      {wsModal === 'create' ? (
        <WsSettingsModal
          mode="create"
          workspace={editingWs}
          source={source}
          onClose={() => setWsModal('closed')}
          onSaved={onWorkspacesChanged}
        />
      ) : null}
      {wsModal === 'delete' && editingWs ? (
        <WsDeleteDialog
          workspace={editingWs}
          woCount={wsWoCount(editingWs.id)}
          onDelete={onDeleteWorkspace}
          onCancel={() => setWsModal('edit')}
          onDeleted={() => setWsModal('closed')}
        />
      ) : null}
      {wsListOpen && workspaceId !== null ? (
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
