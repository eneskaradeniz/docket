import type { Workspace, WorkspaceId } from '../../core/types';

export function WorkspaceSwitcher({
  workspaces,
  selectedId,
  onSwitch,
}: {
  workspaces: Workspace[];
  selectedId: WorkspaceId;
  onSwitch: (id: WorkspaceId) => void;
}) {
  return (
    <nav className="flex gap-1">
      {workspaces.map((w) => (
        <button
          key={w.id as string}
          type="button"
          onClick={() => onSwitch(w.id)}
          className={`rounded-md px-2 py-1 text-xs transition ${
            w.id === selectedId ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {w.label}
        </button>
      ))}
    </nav>
  );
}
