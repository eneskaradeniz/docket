import { useMemo, useState } from 'react';
import type { WorkOrderId, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import { toCardView, toDetailView } from '../../core/derive';
import { AppChrome } from '../chrome/AppChrome';
import { BoardScreen } from '../screens/BoardScreen';
import { DetailScreen } from '../screens/DetailScreen';

// App receives the data port (WorkOrderSource) and never imports an adapter itself.
// The composition root (src/dev-main.tsx) is the only module that does.
export function App({ source }: { source: WorkOrderSource }) {
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

  if (selectedId) {
    const wo = source.getWorkOrder(selectedId);
    if (wo) {
      return (
        <>
          {chrome}
          <DetailScreen
            detail={toDetailView(wo)}
            docs={source.getWorkOrderDocs(selectedId)}
            workspaceLabel={workspaceLabel}
            onBack={() => setSelectedId(null)}
          />
        </>
      );
    }
  }

  return (
    <>
      {chrome}
      <BoardScreen cards={cards} workspaceLabel={workspaceLabel} onSelect={setSelectedId} />
    </>
  );
}
