import { useMemo, useState } from 'react';
import type { WorkOrderId, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { SessionRunner } from '../../core/runner';
import { toCardView, toDetailView } from '../../core/derive';
import { AppChrome } from '../chrome/AppChrome';
import { BoardScreen } from '../screens/BoardScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { RunnerContext } from '../session/runner-context';

// App receives the data port (WorkOrderSource) and the session-runner port
// (SessionRunner), and never imports an adapter itself. Only the composition root
// (electron/main.ts) imports an adapter. The runner is provided via context so the
// session pane (deep in the detail tree) can reach it without prop drilling.
export function App({ source, runner }: { source: WorkOrderSource; runner: SessionRunner }) {
  const workspaces = source.getWorkspaces();
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>(workspaces[0].id);
  const [selectedId, setSelectedId] = useState<WorkOrderId | null>(null);

  const cards = useMemo(
    () => source.getWorkOrders().filter((w) => w.workspace === workspaceId).map(toCardView),
    [source, workspaceId],
  );
  const workspaceLabel = workspaces.find((w) => w.id === workspaceId)?.label ?? '';

  const chrome = (
    <AppChrome workspaces={workspaces} workspaceId={workspaceId} onSwitch={setWorkspaceId} />
  );

  let main;
  if (selectedId) {
    const wo = source.getWorkOrder(selectedId);
    main = wo ? (
      <DetailScreen
        detail={toDetailView(wo)}
        docs={source.getWorkOrderDocs(selectedId)}
        workspaceLabel={workspaceLabel}
        onBack={() => setSelectedId(null)}
      />
    ) : null;
  } else {
    main = <BoardScreen cards={cards} workspaceLabel={workspaceLabel} onSelect={setSelectedId} />;
  }

  return <RunnerContext.Provider value={runner}>{chrome}{main}</RunnerContext.Provider>;
}
