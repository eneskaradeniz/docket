import { useEffect, useMemo, useState } from 'react';
import type { WorkOrder, WorkOrderId, Workspace, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { SessionRunner } from '../../core/runner';
import { toCardView, toDetailView } from '../../core/derive';
import { UI } from '../data/labels';
import { AppChrome } from '../chrome/AppChrome';
import { useTheme } from '../chrome/use-theme';
import { BoardScreen } from '../screens/BoardScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { RunnerContext } from '../components/session/runner-context';

type LoadState = 'loading' | 'ready' | 'error';

// App receives the data port (WorkOrderSource) and the session-runner port (SessionRunner),
// and never imports an adapter itself. Only the composition root (electron/main.ts) imports
// an adapter. The data port is async (WO-0009 — SQLite); workspaces + work orders load once
// on mount, the selected work order + its docs load on selection, each with a state for the
// in-flight/failed case. The runner is provided via context for the session pane.
export function App({ source, runner }: { source: WorkOrderSource; runner: SessionRunner }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [load, setLoad] = useState<LoadState>('loading');
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | null>(null);
  const [selectedId, setSelectedId] = useState<WorkOrderId | null>(null);
  const [detail, setDetail] = useState<{ wo: WorkOrder; docs: { order: string; plan: string } } | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    let cancelled = false;
    Promise.all([source.getWorkspaces(), source.getWorkOrders()])
      .then(([ws, wos]) => {
        if (cancelled) return;
        setWorkspaces(ws);
        setWorkOrders(wos);
        setWorkspaceId(ws[0]?.id ?? null);
        setLoad('ready');
      })
      .catch(() => {
        if (!cancelled) setLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Load the work order + its docs when one is selected (docs are not stored — ADR-0010).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    Promise.all([source.getWorkOrder(selectedId), source.getWorkOrderDocs(selectedId)])
      .then(([wo, docs]) => {
        if (cancelled || !wo) return;
        setDetail({ wo, docs });
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source, selectedId]);

  const cards = useMemo(
    () => workOrders.filter((w) => w.workspace === workspaceId).map(toCardView),
    [workOrders, workspaceId],
  );

  const chrome = workspaceId ? (
    <AppChrome
      workspaces={workspaces}
      workspaceId={workspaceId}
      onSwitch={setWorkspaceId}
      theme={theme}
      setTheme={setTheme}
    />
  ) : null;

  let main;
  if (load === 'loading') {
    main = <p className="px-4 py-8 text-sm text-inkdim">{UI.loading}</p>;
  } else if (load === 'error') {
    main = <p className="px-4 py-8 text-sm text-clay">{UI.loadError}</p>;
  } else if (selectedId) {
    main = detail ? (
      <DetailScreen
        detail={toDetailView(detail.wo)}
        docs={detail.docs}
        onBack={() => setSelectedId(null)}
      />
    ) : (
      <p className="px-4 py-8 text-sm text-inkdim">{UI.loading}</p>
    );
  } else {
    main = <BoardScreen cards={cards} onSelect={setSelectedId} />;
  }

  return <RunnerContext.Provider value={runner}>{chrome}{main}</RunnerContext.Provider>;
}
