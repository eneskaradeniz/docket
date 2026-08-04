import type { Workspace, WorkspaceId } from '../../core/types';
import { UI } from '../data/labels';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function AppChrome({
  workspaces,
  workspaceId,
  onSwitch,
}: {
  workspaces: Workspace[];
  workspaceId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <span className="font-semibold text-slate-900">{UI.productName}</span>
        <WorkspaceSwitcher workspaces={workspaces} selectedId={workspaceId} onSwitch={onSwitch} />
      </div>
    </header>
  );
}
