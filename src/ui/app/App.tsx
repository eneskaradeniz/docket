import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StepView, WorkOrder, WorkOrderId, Workspace, WorkspaceId } from '../../core/types';
import type { PermissionRule, UpdateWorkOrderInput, WorkOrderSource } from '../../core/source';
import type { SessionRunner } from '../../core/runner';
import { toCardView, toDetailView } from '../../core/derive';
import { orderMdCarriesRule, parseOrderMd } from '../../core/order-md';
import { UI, woIdLabel } from '../data/labels';
import { AppShell } from '../chrome/AppShell';
import type { AppSettings } from '../../core/app-settings';
import { WoCreateModal } from '../chrome/WoCreateModal';
import { WsSettingsModal } from '../chrome/WsSettingsModal';
import { AppSettingsModal } from '../chrome/AppSettingsModal';
import { BoardScreen } from '../screens/BoardScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { InviteHero } from '../components/InviteHero';
import { createDriveStore, DriveStoreContext } from '../components/session/drive-store';
import { ViewModeProvider } from '../data/view-mode';
import { ToastHost, toast } from '../chrome/ToastHost';

type LoadState = 'loading' | 'ready' | 'error';

// App receives the data port (WorkOrderSource) and the session-runner port (SessionRunner),
// and never imports an adapter itself. Only the composition root (electron/main.ts) imports
// an adapter. The data port is async (WO-0009 — SQLite); workspaces + work orders load once
// on mount, the selected work order + its docs load on selection, each with a state for the
// in-flight/failed case. The runner is provided via context for the session pane.
export function App({ source, settings, runner }: { source: WorkOrderSource;
  settings: AppSettings; runner: SessionRunner }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [load, setLoad] = useState<LoadState>('loading');
  const [loadNonce, setLoadNonce] = useState(0); // B4: the board-load retry trigger (WO-0026)
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | null>(null);
  const [selectedId, setSelectedId] = useState<WorkOrderId | null>(null);
  const [detail, setDetail] = useState<{ wo: WorkOrder; docs: { order: string; plan: string }; steps: StepView[] } | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [detailError, setDetailError] = useState(false); // B3: a failed detail load must not render as loading (WO-0026)
  const [woCreateOpen, setWoCreateOpen] = useState(false);
  const [wsCreateOpen, setWsCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  }, [source, loadNonce]);

  // Load the work order + its docs when one is selected (docs are not stored — ADR-0010).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(false);
      return;
    }
    let cancelled = false;
    setDetailError(false);
    // WO-0031f Y-2: the Çizelge surface died, so the event stream no longer rides the detail state —
    // the fetch stays (the stored stream and its port are untouched; rare events surface via the
    // audit row's detail and the step metas), the payload just stops crossing into the UI.
    Promise.all([source.getWorkOrder(selectedId), source.getWorkOrderDocs(selectedId), source.getWorkOrderSteps(selectedId)])
      .then(([wo, docs, steps]) => {
        if (cancelled) return;
        // A resolved-but-missing work order is the same surface as a failure: an honest error, not a spinner.
        if (!wo) {
          setDetailError(true);
          return;
        }
        setDetail({ wo, docs, steps });
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(true);
        }
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
    async (planText: string, opts?: { editedCount?: number }) => {
      if (!selectedId) return;
      await source.approvePlan(selectedId, planText, opts);
      reloadDetail();
    },
    [source, selectedId, reloadDetail],
  );
  // WO-0031c: inline WO editing (title/description/reviewMode/permissionRule) + the ask-card decisions.
  const handleUpdateWorkOrder = useCallback(
    async (patch: UpdateWorkOrderInput) => {
      if (!selectedId) return;
      await source.updateWorkOrder(selectedId, patch);
      reloadDetail();
      refreshWorkOrders();
    },
    [source, selectedId, reloadDetail, refreshWorkOrders],
  );
  const handleRecordPermissionDecision = useCallback(
    async (input: { allowed: boolean; tool: string; target: string }) => {
      if (!selectedId) return;
      await source.recordPermissionDecision(selectedId, input);
      reloadDetail();
    },
    [source, selectedId, reloadDetail],
  );
  // The Settings DEFAULT rule (the strip badge's fallback for pre-rule work orders; the create modal's default).
  const [defaultRule, setDefaultRule] = useState<PermissionRule>('risky_excluded');
  useEffect(() => {
    void settings.getPermissionRule?.().then((r) => setDefaultRule(r ?? 'risky_excluded'));
  }, [settings]);
  // "Oluştur ve plan iste" (WO-0031c): after creating, navigate AND auto-start the architect.
  const [autoPlanFor, setAutoPlanFor] = useState<WorkOrderId | null>(null);
  const handleOverrideVerdict = useCallback(
    async (idx: number) => {
      if (!selectedId) return;
      await source.overrideStepVerdict(selectedId, idx);
      reloadDetail();
    },
    [source, selectedId, reloadDetail],
  );
  const handleCloseWorkOrder = useCallback(
    async (note: string) => {
      if (!selectedId) return;
      await source.closeWorkOrder(selectedId, note);
      reloadDetail();
      refreshWorkOrders();
    },
    [source, selectedId, reloadDetail, refreshWorkOrders],
  );
  const handleDeleteWorkOrder = useCallback(async () => {
    if (!selectedId) return;
    await source.deleteWorkOrder(selectedId);
    setSelectedId(null);
    refreshWorkOrders();
  }, [source, selectedId, refreshWorkOrders]);
  const handleGetStepVerdict = useCallback((idx: number) => source.getStepVerdict(selectedId!, idx), [source, selectedId]);
  const handleResetStep = useCallback((idx: number) => source.resetStep(selectedId!, idx), [source, selectedId]);

  // WO-0031d: the REAL appbar always renders once data is ready — an empty database keeps the brand
  // and the normal Settings gear (no second, lesser chrome); the workspace-dependent parts of the
  // shell are absent until a workspace exists.
  const chrome = load !== 'loading' ? (
    <AppShell
      workspaces={workspaces}
      workspaceId={workspaceId}
      onSwitch={setWorkspaceId}
      settings={settings}
      source={source}
      onWorkspacesChanged={refreshWorkspaces}
      onNewWorkOrder={() => setWoCreateOpen(true)}
    />
  ) : null;

  let main;
  if (load === 'loading') {
    main = <p className="px-4 py-8 text-sm text-inkdim">{UI.loading}</p>;
  } else if (load === 'error') {
    main = (
      <div className="px-6 py-8">
        <div className="rounded-md border border-hairline bg-surface p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-error">{UI.loadError}</p>
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => setLoadNonce((n) => n + 1)} className="irow border border-hairline px-3 py-1 text-xs text-inkdim">
              {UI.loadRetry}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (workspaces.length === 0) {
    // Empty database (ADR-0009 + ADR-0012 r2): the appbar above is the real one; the body is the
    // invitation — one line, one CTA (create the first workspace; the first work order follows).
    main = <InviteHero cta={UI.wsCreate} onCta={() => setWsCreateOpen(true)} />;
  } else if (selectedId) {
    main = detailError ? (
      <div className="px-6 py-8">
        <div className="rounded-md border border-hairline bg-surface p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-error">{UI.detailLoadError}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setSelectedId(null)} className="irow border border-hairline px-3 py-1 text-xs text-inkdim">
              {UI.backToBoard}
            </button>
            <button type="button" onClick={() => setDetailNonce((n) => n + 1)} className="irow border border-hairline px-3 py-1 text-xs text-inkdim">
              {UI.loadRetry}
            </button>
          </div>
        </div>
      </div>
    ) : detail ? (
      <DetailScreen
        detail={toDetailView(detail.wo, detail.steps, parseOrderMd(detail.docs.order).reviewMode)}
        docs={detail.docs}
        permissionRule={orderMdCarriesRule(detail.docs.order) ? parseOrderMd(detail.docs.order).permissionRule : defaultRule}
        onBack={() => setSelectedId(null)}
        onApprovePlan={handleApprovePlan}
        onUpdateWorkOrder={handleUpdateWorkOrder}
        onRecordPermissionDecision={handleRecordPermissionDecision}
        onCloseWorkOrder={handleCloseWorkOrder}
        onOverrideVerdict={handleOverrideVerdict}
        onGetStepReport={(idx, role) => source.getStepReport(selectedId, idx, role)}
        onGetStepVerdict={handleGetStepVerdict}
        onResetStep={handleResetStep}
        reloadDetail={reloadDetail}
        onDelete={handleDeleteWorkOrder}
        autoRequestPlan={autoPlanFor !== null && autoPlanFor === selectedId}
      />
    ) : (
      <p className="px-4 py-8 text-sm text-inkdim">{UI.loading}</p>
    );
  } else {
    main = <BoardScreen cards={cards} onSelect={setSelectedId} onNewWorkOrder={() => setWoCreateOpen(true)} />;
  }

  const currentWorkspace = useMemo(() => workspaces.find((w) => w.id === workspaceId), [workspaces, workspaceId]);

  // WO-0028 / Bulgu 12: the app-level drive store — drives outlive pane navigation. When ANY drive ends
  // (wherever the operator is), the board aggregates refresh and the open detail (if any) reloads, so
  // cost/stage/steps are honest without navigating anywhere.
  // WO-0031c — the notification contract, all in ONE place: an event from a work order you are NOT
  // looking at toasts (haber amber / hata red); the SAME rule keeps on-screen results as screen changes,
  // never toasts. The window title carries the waiting counter; a background ask also raises the OS
  // notification (click → focus + go).
  const driveStore = useMemo(() => createDriveStore(runner), [runner]);
  const selectedIdRef = useRef<WorkOrderId | null>(null);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    // key → branded WO id lives in the store (captured at start — no ui-side cast, ADR-0003)
    const woOf = (key: string): WorkOrderId | undefined => driveStore.woId(key);
    const isBackground = (key: string): boolean => {
      const wo = woOf(key);
      return wo !== undefined && selectedIdRef.current !== wo;
    };
    const goTo = (key: string): void => {
      const wo = woOf(key);
      if (wo !== undefined) setSelectedId(wo);
    };
    driveStore.onEnd = (key) => {
      refreshWorkOrders();
      setDetailNonce((n) => n + 1);
      const wo = woOf(key);
      if (isBackground(key) && wo !== undefined) {
        toast.push({ kind: 'news', title: woIdLabel(wo), body: UI.toastAskBody, onActivate: () => goTo(key) });
      }
    };
    // WO-0029 / B13+B14: the board flips to "Çalışıyor" the moment a background drive starts, and to
    // "Seni bekliyor" when an ask surfaces — the card derives both from the recorded rows; the refresh
    // was the missing half.
    driveStore.onStarted = () => refreshWorkOrders();
    driveStore.onAsk = (key) => {
      refreshWorkOrders();
      const wo = woOf(key);
      if (isBackground(key) && wo !== undefined) {
        const title = UI.toastAskTitle(woIdLabel(wo));
        toast.push({ kind: 'news', title, body: UI.toastAskBody, onActivate: () => goTo(key) });
        try {
          if (typeof Notification !== 'undefined') {
            const n = new Notification(title, { body: UI.toastAskBody });
            n.onclick = () => {
              window.focus();
              goTo(key);
            };
          }
        } catch {
          // notification surface unavailable — the toast + title already carry the news
        }
      }
    };
    driveStore.onError = (key) => {
      refreshWorkOrders();
      const wo = woOf(key);
      if (isBackground(key) && wo !== undefined) {
        toast.push({ kind: 'error', title: UI.toastErrTitle(woIdLabel(wo)) });
      }
    };
  }, [driveStore, refreshWorkOrders]);

  // The window-title counter: "(n) izin bekliyor" while any work order waits on the operator.
  useEffect(() => {
    const waiting = workOrders.filter((w) => w.sessions.some((s) => s.status === 'stopped_asking')).length;
    document.title = waiting > 0 ? UI.titlePending(waiting) : UI.productName;
  }, [workOrders]);

  return (
    <ViewModeProvider>
      <DriveStoreContext.Provider value={driveStore}>
      {chrome}
      {main}
      <ToastHost />
      {woCreateOpen && currentWorkspace ? (
        <WoCreateModal
          workspace={currentWorkspace}
          source={source}
          defaultRule={defaultRule}
          onClose={() => setWoCreateOpen(false)}
          onCreated={(wo, withPlan) => {
            setWoCreateOpen(false);
            refreshWorkOrders();
            setSelectedId(wo.id); // navigate to the new work order's detail
            if (withPlan) setAutoPlanFor(wo.id); // "Oluştur ve plan iste": the architect starts on arrival
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
      {settingsOpen ? <AppSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} /> : null}
      </DriveStoreContext.Provider>
    </ViewModeProvider>
  );
}
