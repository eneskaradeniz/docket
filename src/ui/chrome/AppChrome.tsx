import { useState } from 'react';
import type { Workspace, WorkspaceId } from '../../core/types';
import { UI } from '../data/labels';
import { AppSettingsModal } from './AppSettingsModal';
import type { ThemeMode } from './use-theme';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function AppChrome({
  workspaces,
  workspaceId,
  onSwitch,
  theme,
  setTheme,
}: {
  workspaces: Workspace[];
  workspaceId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <header
        className="sticky top-0 z-20 border-b border-rule"
        style={{ background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)', backdropFilter: 'blur(8px)' }}
      >
        <div className="mx-auto flex max-w-3xl items-center px-6 py-3.5">
          <WorkspaceSwitcher workspaces={workspaces} selectedId={workspaceId} onSwitch={onSwitch} />
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
        <AppSettingsModal theme={theme} setTheme={setTheme} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  );
}
