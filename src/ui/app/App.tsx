import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkOrder, WorkOrderId, Workspace, WorkspaceId } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import type { SessionRunner } from '../../core/runner';
import { toCardView, toDetailView } from '../../core/derive';
import { UI } from '../data/labels';
import { AppChrome } from '../chrome/AppChrome';
import { useTheme } from '../chrome/use-theme';
import { WoCreateModal } from '../chrome/WoCreateModal';
import { WsSettingsModal } from '../chrome/WsSettingsModal';
import { AppSettingsModal } from '../chrome/AppSettingsModal';
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
  const [detailNonce, setDetailNonce] = useState(0);
  const [woCreateOpen, setWoCreateOpen] = useState(false);
  const [wsCreateOpen, setWsCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  }, [source, selectedId, detailNonce]);

  const cards = useMemo(
    () => workOrders.filter((w) => w.workspace === workspaceId).map(toCardView),
    [workOrders, workspaceId],
  );

  const refreshWorkspaces = useCallback(() => {
    source.getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      setWorkspaceId((prev) => (prev && ws.some((w) => w.id === prev) ? prev : (ws[0]?.id ?? null)));
    });
  }, [source]);

  // After creating a work order, re-fetch the list (mirrors refreshWorkspaces) so the new card appears.
  const refreshWorkOrders = useCallback(() => {
    source.getWorkOrders().then(setWorkOrders);
  }, [source]);

  // Re-load the selected work order + its docs (WO-0016): bumping the nonce re-runs the detail effect,
  // so the detail view reflects a plan approval (stage advanced, plan.md rendered) without re-selection.
  const reloadDetail = useCallback(() => setDetailNonce((n) => n + 1), []);
  const handleApprovePlan = useCallback(
    async (planText: string) => {
      if (!selectedId) return;
      await source.approvePlan(selectedId, planText);
      reloadDetail();
    },
    [source, selectedId, reloadDetail],
  );

  const chrome = workspaceId ? (
    <AppChrome
      workspaces={workspaces}
      workspaceId={workspaceId}
      onSwitch={setWorkspaceId}
      theme={theme}
      setTheme={setTheme}
      source={source}
      onWorkspacesChanged={refreshWorkspaces}
    />
  ) : null;

  let main;
  if (load === 'loading') {
    main = <p className="px-4 py-8 text-sm text-inkdim">{UI.loading}</p>;
  } else if (load === 'error') {
    main = <p className="px-4 py-8 text-sm text-clay">{UI.loadError}</p>;
  } else if (workspaces.length === 0) {
    // Onboarding (ADR-0009): no workspace yet → the only action is to create one. With no workspace the
    // board has no context, so surface workspace creation directly instead of a dead-end empty board.
    // Settings (theme/language) remain reachable: a minimal header carries the gear (AppChrome's gear only
    // renders once a workspace exists).
    main = (
      <>
        <header className="sticky top-0 z-20 border-b border-rule" style={{ background: 'color-mix(in srgb, var(--color-bg) 88%, transparent)', backdropFilter: 'blur(8px)' }}>
          <div className="mx-auto flex max-w-3xl items-center justify-end px-6 py-3.5">
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label={UI.settings} className="rounded p-2 text-[16px] text-inkdim hover:bg-surface2 hover:text-ink">
              ⚙
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">
          <div className="rounded-sm border border-rule bg-surface p-6">
            <h2 className="text-[15px] font-semibold text-ink">{UI.wsCreate}</h2>
            <p className="mt-1 text-[13px] text-inkdim">{UI.noWorkspaceHint}</p>
            <button type="button" onClick={() => setWsCreateOpen(true)} className="btn-primary mt-3 rounded px-4 py-1.5 text-[12px]">
              {UI.wsCreate}
            </button>
          </div>
        </main>
      </>
    );
  } else if (selectedId) {
    main = detail ? (
      <DetailScreen
        detail={toDetailView(detail.wo)}
        docs={detail.docs}
        onBack={() => setSelectedId(null)}
        onApprovePlan={handleApprovePlan}
      />
    ) : (
      <p className="px-4 py-8 text-sm text-inkdim">{UI.loading}</p>
    );
  } else {
    main = <BoardScreen cards={cards} onSelect={setSelectedId} onNewWorkOrder={() => setWoCreateOpen(true)} />;
  }

  const currentWorkspace = useMemo(() => workspaces.find((w) => w.id === workspaceId), [workspaces, workspaceId]);

  return (
    <RunnerContext.Provider value={runner}>
      {chrome}
      {main}
      {woCreateOpen && currentWorkspace ? (
        <WoCreateModal
          workspace={currentWorkspace}
          source={source}
          onClose={() => setWoCreateOpen(false)}
          onCreated={(wo) => {
            setWoCreateOpen(false);
            refreshWorkOrders();
            setSelectedId(wo.id); // navigate to the new work order's detail
          }}
        />
      ) : null}
      {wsCreateOpen ? (
        <WsSettingsModal
          mode="create"
          source={source}
          onClose={() => setWsCreateOpen(false)}
          onSaved={refreshWorkspaces}
        />
      ) : null}
      {settingsOpen ? <AppSettingsModal theme={theme} setTheme={setTheme} onClose={() => setSettingsOpen(false)} /> : null}
    </RunnerContext.Provider>
  );
}
