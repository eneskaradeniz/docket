import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StepView, WorkOrder, WorkOrderId, Workspace, WorkspaceId } from '../../core/types';
import type { PermissionRule, UpdateWorkOrderInput, WorkOrderSource } from '../../core/source';
import type { SessionRunner } from '../../core/runner';
import type { WorkspaceBudgetView } from '../../core/budget';
import { DEFAULT_WARN_PERCENT, workspaceBudgetView } from '../../core/budget';
import { overlayLiveDrive, toCardView, toDetailView } from '../../core/derive';
import { orderMdCarriesRule, parseOrderMd } from '../../core/order-md';
import { roadmapTaskOf, type RoadmapView } from '../../core/roadmap';
import { DEFAULT_DOCS_ROOT } from '../../core/roadmap-md';
import { useLabels } from '../data/locale';
import { AppShell, type Surface } from '../chrome/AppShell';
import type { AppSettings } from '../../core/app-settings';
import { WoCreateModal } from '../chrome/WoCreateModal';
import { WsSettingsModal } from '../chrome/WsSettingsModal';
import { BoardScreen } from '../screens/BoardScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { RoadmapScreen } from '../screens/RoadmapScreen';
import { InviteHero } from '../components/InviteHero';
import type { WoSpawnPrefill } from '../components/roadmap/TaskRow';
import { createDriveStore, DriveStoreContext, useActiveDrive } from '../components/session/drive-store';
import { ToastHost, toast } from '../chrome/ToastHost';

type LoadState = 'loading' | 'ready' | 'error';

// App receives the data port (WorkOrderSource) and the session-runner port (SessionRunner),
// and never imports an adapter itself. Only the composition root (electron/main.ts) imports
// an adapter. The data port is async (WO-0009 — SQLite); workspaces + work orders load once
// on mount, the selected work order + its docs load on selection, each with a state for the
// in-flight/failed case. The runner is provided via context for the session pane.
export function App({ source, settings, runner }: { source: WorkOrderSource;
  settings: AppSettings; runner: SessionRunner }) {
  const { UI, woIdLabel } = useLabels();
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
  // WO-0049: the sibling surface (ADR-0016 karar 4). Detail renders OVER either surface — clearing
  // selectedId reveals the last one, so the roadmap → WO chip → detail → back round-trip needs no
  // second state.
  const [surface, setSurface] = useState<Surface>('board');
  // WO-0049: the roadmap view (undefined = loading) + the effective structure root. Read once per
  // mount/entry (WO-0048 R2) + at the moments the facts move (drive ends, a WO's task link changes,
  // a save, a root switch) — never on a timer.
  const [roadmap, setRoadmap] = useState<RoadmapView | undefined>(undefined);
  const [docsRoot, setDocsRoot] = useState<string>(DEFAULT_DOCS_ROOT);
  // WO-0049: the roadmap's `▸ İş emri aç` opens the create modal PRE-FILLED (kare 06); undefined =
  // the plain board flow.
  const [spawnTask, setSpawnTask] = useState<WoSpawnPrefill | undefined>(undefined);

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

  // The detail's order.md, parsed ONCE per load (WO-0045: the flow mode joined review mode + the
  // effective rule here — three parses per render was one too many).
  const parsedOrder = useMemo(
    () => parseOrderMd(detail?.docs.order ?? ''),
    [detail],
  );

  // WO-0049 (kare 07): the detail band's task chip. A `task:` ref resolves against the ready view;
  // an orphan ref (or a read roadmap that is absent/invalid) degrades to the qualifier — never a
  // lie, never a raw id; an unlinked WO carries no chip, and an UNREAD roadmap (in flight/failed)
  // renders nothing either — "not in the roadmap" is a claim only a finished read can make.
  const detailTaskChip = useMemo<{ fazId: string; taskTitle: string } | 'missing' | undefined>(() => {
    const ref = parsedOrder.taskRef;
    if (ref === undefined) return undefined;
    if (roadmap === undefined) return undefined;
    if (roadmap.kind !== 'ready') return 'missing';
    const loc = roadmapTaskOf(roadmap, ref);
    return loc !== undefined ? { fazId: loc.fazId, taskTitle: loc.taskTitle } : 'missing';
  }, [parsedOrder, roadmap]);

  // WO-0028 / Bulgu 12: the app-level drive store — drives outlive pane navigation. Created before
  // the cards memo because the board reads its live snapshot (base-mobile trial).
  const driveStore = useMemo(() => createDriveStore(runner), [runner]);
  // base-mobile trial: the ONE active drive's facts (identity-stable between transitions — it does
  // NOT re-render per transcript line). One subscription feeds the board overlay, the Sil gate and
  // the title counter, so all three agree with the detail screen.
  const activeDrive = useActiveDrive(driveStore);

  const cards = useMemo(
    () =>
      workOrders
        .filter((w) => w.workspace === workspaceId)
        .map((wo) =>
          overlayLiveDrive(toCardView(wo), activeDrive !== undefined && activeDrive.woId === wo.id ? activeDrive : undefined),
        ),
    [workOrders, workspaceId, activeDrive],
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
  // 2026-08-23 ("Bitti = kaydet"): the editor's finish persists the edited steps as the PENDING
  // plan — the memory-only stage died with navigation, taking "saved" edits with it.
  const handleSavePlanDraft = useCallback(
    async (planText: string) => {
      if (!selectedId) return;
      await source.savePlanDraft(selectedId, planText);
      reloadDetail();
    },
    [source, selectedId, reloadDetail],
  );
  // "İlk öneriye dön": read the agent's snapshotted original / restore it as the pending plan.
  const handleGetOriginalPlan = useCallback(
    async () => (selectedId ? source.getOriginalPlan(selectedId) : null),
    [source, selectedId],
  );
  const handleRestoreOriginalPlan = useCallback(async () => {
    if (!selectedId) return;
    await source.restoreOriginalPlan(selectedId);
    reloadDetail();
  }, [source, selectedId, reloadDetail]);
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
  // 2026-08-23 (operator, live run: "geri dönüp tekrar girince otomatik ajanı çalıştırıyor"): the
  // flag is ONE-SHOT — it dies the moment the detail it named consumes it. It used to stick for
  // the app's whole lifetime, so EVERY re-entry of that work order re-fired the auto-start (a
  // stopped session restarted itself on the next visit). The clear is gated on the detail DATA
  // (DetailScreen mounts only then): on that commit the child's effect runs before this one, so
  // WorkOrderDetail sees the true prop exactly once.
  useEffect(() => {
    if (autoPlanFor !== null && detail?.wo.id === autoPlanFor) setAutoPlanFor(null);
  }, [autoPlanFor, detail]);
  const handleOverrideVerdict = useCallback(
    async (idx: number) => {
      if (!selectedId) return;
      await source.overrideStepVerdict(selectedId, idx);
      reloadDetail();
    },
    [source, selectedId, reloadDetail],
  );
  // WO-0045: retract a queued note from a STOPPED drive — the SDK queue died with the process, the
  // persisted row is the only queue; the store rewrites it + audits (steer_retracted).
  const handleRetractSteerNote = useCallback(
    async (sessionId: string, noteId: string): Promise<boolean> => {
      if (!selectedId) return false;
      return source.retractSteerNote(selectedId, sessionId, noteId);
    },
    [source, selectedId],
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
    // The store's second half of the delete: a deleted WO's live fold must not outlive its row —
    // the next WO to recycle its number would inherit a foreign transcript (WO-0037/0038 E2E bug).
    driveStore.forgetWo(selectedId);
    setSelectedId(null);
    refreshWorkOrders();
  }, [source, selectedId, refreshWorkOrders, driveStore]);
  // WO-0032: delete a workspace (full cascade). If the OPEN detail belonged to it, return to the
  // board; refreshWorkspaces falls back to another workspace — or the hero when none remain.
  const handleDeleteWorkspace = useCallback(
    async (ws: Workspace) => {
      await source.deleteWorkspace(ws.id);
      setSelectedId((prev) => (prev && workOrders.some((w) => w.id === prev && w.workspace === ws.id) ? null : prev));
      refreshWorkspaces();
      refreshWorkOrders();
    },
    [source, workOrders, refreshWorkspaces, refreshWorkOrders],
  );
  // The workspace's WO count (the confirm's consequence line) + its liveness (the Sil gate): both
  // derive from the loaded workOrders — the same recorded rows the store guard reads (B13's mechanism).
  const wsWoCount = useCallback((id: WorkspaceId) => workOrders.filter((w) => w.workspace === id).length, [workOrders]);
  const wsDriveLive = useCallback(
    (id: WorkspaceId) => {
      // Rows carry a started drive; the LIVE fact closes the boot window, where no row exists yet
      // (the store-side guard cannot see a pre-row drive either — this UI gate is the practical
      // close; base-mobile trial).
      const liveWs = activeDrive !== undefined ? workOrders.find((w) => w.id === activeDrive.woId)?.workspace : undefined;
      return workOrders.some((w) => w.workspace === id && w.sessions.some((s) => s.status === 'running')) || liveWs === id;
    },
    [workOrders, activeDrive],
  );

  // WO-0047: the workspace's budget view — threshold + the month's observed spend + status, read
  // together (undefined when no threshold: the surfaces show nothing, the gate fails open).
  // Refreshed at exactly the moments a session row's cost can change (the drive-store hooks below
  // ride the same triggers as refreshWorkOrders) plus on raise/settings change.
  const [budget, setBudget] = useState<WorkspaceBudgetView | undefined>(undefined);
  const refreshBudget = useCallback(() => {
    if (!workspaceId) {
      setBudget(undefined);
      return;
    }
    void Promise.all([source.workspaceMonthSpend(workspaceId), settings.getBudget?.(workspaceId)])
      .then(([spend, threshold]) => {
        setBudget(threshold ? workspaceBudgetView(spend.usd, spend.hasUnknown, threshold) : undefined);
      })
      .catch(() => setBudget(undefined));
  }, [source, settings, workspaceId]);
  useEffect(() => {
    refreshBudget();
  }, [refreshBudget]);
  // WO-0049: the roadmap view + the effective root, read together. The absent case is one stat
  // (TD-055's join only runs when a roadmap.md exists); refreshes ride the same moments budget
  // does (the drive hooks below) + surface entry + detail open + every save/root switch.
  const refreshRoadmap = useCallback(() => {
    if (!workspaceId) {
      setRoadmap(undefined);
      return;
    }
    void Promise.all([source.getRoadmap(workspaceId), settings.getDocsRoot(workspaceId)])
      .then(([view, root]) => {
        setRoadmap(view);
        setDocsRoot(root);
      })
      .catch(() => setRoadmap(undefined));
  }, [source, settings, workspaceId]);
  useEffect(() => {
    refreshRoadmap();
  }, [refreshRoadmap]);
  // The screen's own read-once-per-entry (WO-0048 R2) + the detail chip's freshness: every detail
  // open re-reads (a hand-edit between visits must not show a stale task title).
  useEffect(() => {
    if (surface === 'roadmap') refreshRoadmap();
  }, [surface, refreshRoadmap]);
  useEffect(() => {
    if (selectedId !== null) refreshRoadmap();
  }, [selectedId, refreshRoadmap]);
  // The refusal card's RAISE action (WO-0047): a PERMANENT settings write (the operator's ruling —
  // no one-month override); the warn ratio keeps the stored value, defaulting to 80.
  const handleRaiseBudget = useCallback(
    async (capUsd: number) => {
      if (!workspaceId) return;
      const existing = await settings.getBudget?.(workspaceId);
      await settings.setBudget?.(workspaceId, { capUsd, warnPercent: existing?.warnPercent ?? DEFAULT_WARN_PERCENT });
      refreshBudget();
    },
    [workspaceId, settings, refreshBudget],
  );
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
      onDeleteWorkspace={handleDeleteWorkspace}
      wsWoCount={wsWoCount}
      wsDriveLive={wsDriveLive}
      onBudgetChanged={refreshBudget}
      onDocsRootChanged={refreshRoadmap}
      surface={surface}
      onSurfaceChange={setSurface}
    />
  ) : null;

  // The active workspace — needed by the main chain below (the roadmap screen takes it as a prop).
  const currentWorkspace = useMemo(() => workspaces.find((w) => w.id === workspaceId), [workspaces, workspaceId]);

  let main;
  if (load === 'loading') {
    // TD-037: the named load line — what is actually being read, never a bare 'Yükleniyor…'.
    main = <p className="loadline px-4 py-8">{UI.loadWorkOrders}</p>;
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
    main = <InviteHero line={UI.inviteFirstWs} cta={UI.wsCreate} onCta={() => setWsCreateOpen(true)} />;
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
        detail={toDetailView(detail.wo, detail.steps, parsedOrder.reviewMode, parsedOrder.flowMode)}
        docs={detail.docs}
        permissionRule={orderMdCarriesRule(detail.docs.order) ? parsedOrder.permissionRule : defaultRule}
        onBack={() => setSelectedId(null)}
        onApprovePlan={handleApprovePlan}
        onSavePlanDraft={handleSavePlanDraft}
        onGetOriginalPlan={handleGetOriginalPlan}
        onRestoreOriginalPlan={handleRestoreOriginalPlan}
        onUpdateWorkOrder={handleUpdateWorkOrder}
        onRecordPermissionDecision={handleRecordPermissionDecision}
        onCloseWorkOrder={handleCloseWorkOrder}
        onOverrideVerdict={handleOverrideVerdict}
        onRetractSteerNote={handleRetractSteerNote}
        onGetStepReport={(idx, role) => source.getStepReport(selectedId, idx, role)}
        onGetStepVerdict={handleGetStepVerdict}
        onResetStep={handleResetStep}
        budget={budget}
        onRaiseBudget={handleRaiseBudget}
        reloadDetail={reloadDetail}
        onDelete={handleDeleteWorkOrder}
        autoRequestPlan={autoPlanFor !== null && autoPlanFor === selectedId}
        taskChip={detailTaskChip}
      />
    ) : (
      <p className="loadline px-4 py-8">{UI.loadSteps}</p>
    );
  } else if (surface === 'roadmap') {
    // WO-0049: the sibling surface, keyed by workspace like the board (a fresh surface on swap).
    // currentWorkspace is non-null here — the branch sits under workspaces.length > 0.
    main = currentWorkspace ? (
      <RoadmapScreen
        key={workspaceId ?? 'none'}
        view={roadmap}
        workspace={currentWorkspace}
        docsRoot={docsRoot}
        source={source}
        onSpawn={(p) => setSpawnTask(p)}
        onOpenWo={setSelectedId}
        onRefresh={refreshRoadmap}
      />
    ) : null;
  } else {
    // keyed by workspace (WO-0031f H-1): switching workspaces is a fresh surface, not a state
    // transition of the old one — the all-done pulse must not fire across the swap.
    main = (
      <BoardScreen
        key={workspaceId ?? 'none'}
        cards={cards}
        budget={budget}
        onSelect={setSelectedId}
        onNewWorkOrder={() => setWoCreateOpen(true)}
      />
    );
  }

  // WO-0028 / Bulgu 12: the app-level drive store (created above the cards memo). When ANY drive ends
  // (wherever the operator is), the board aggregates refresh and the open detail (if any) reloads, so
  // cost/stage/steps are honest without navigating anywhere.
  // WO-0031c — the notification contract, all in ONE place: an event from a work order you are NOT
  // looking at toasts (haber amber / hata red); the SAME rule keeps on-screen results as screen changes,
  // never toasts. The window title carries the waiting counter; a background ask also raises the OS
  // notification (click → focus + go).
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
      refreshBudget(); // WO-0047: the terminal record lands the drive's cost — the month figure moves
      refreshRoadmap(); // WO-0049: a closed/opened WO flips its task's derived status
      setDetailNonce((n) => n + 1);
      const wo = woOf(key);
      if (isBackground(key) && wo !== undefined) {
        toast.push({ kind: 'news', title: woIdLabel(wo), body: UI.toastAskBody, onActivate: () => goTo(key) });
      }
    };
    // WO-0029 / B13+B14: the board flips to "Çalışıyor" the moment a background drive starts, and to
    // "Seni bekliyor" when an ask surfaces — the card derives both from the recorded rows; the refresh
    // was the missing half.
    driveStore.onStarted = () => {
      refreshWorkOrders();
      refreshBudget(); // WO-0047: a resumed drive's accumulated cost rides the row from the start
      refreshRoadmap();
    };
    // base-mobile trial: the pipeline returns the session row to 'running' when the last ask is
    // answered, but nothing else fires for ask_resolved — refresh here so the rows snapshot agrees
    // with the fold. Without it the board card bounces working → Seni bekliyor → settled when the
    // drive ends and the live overlay lifts off a stale stopped_asking row.
    driveStore.onAskResolved = () => {
      refreshWorkOrders();
      refreshBudget();
      refreshRoadmap();
    };
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
      refreshBudget(); // WO-0047: an erroring drive still records its observed cost
      refreshRoadmap();
      const wo = woOf(key);
      if (isBackground(key) && wo !== undefined) {
        toast.push({ kind: 'error', title: UI.toastErrTitle(woIdLabel(wo)) });
      }
    };
  }, [driveStore, refreshWorkOrders, refreshBudget, refreshRoadmap, UI, woIdLabel]);

  // The window-title counter: "(n) izin bekliyor" while any work order waits on the operator. The
  // live fold outranks a stale stopped_asking row — an ask the operator already answered is being
  // worked, not waited on (base-mobile trial; the row refresh follows via onAskResolved).
  useEffect(() => {
    const staleActive = activeDrive !== undefined && activeDrive.status !== 'stopped_asking' ? activeDrive.woId : undefined;
    const waiting = workOrders.filter((w) => w.sessions.some((s) => s.status === 'stopped_asking') && w.id !== staleActive).length;
    document.title = waiting > 0 ? UI.titlePending(waiting) : UI.productName;
  }, [workOrders, activeDrive, UI]);

  return (
    <DriveStoreContext.Provider value={driveStore}>
      {chrome}
      {main}
      <ToastHost />
      {(woCreateOpen || spawnTask !== undefined) && currentWorkspace ? (
        <WoCreateModal
          workspace={currentWorkspace}
          source={source}
          defaultRule={defaultRule}
          prefill={spawnTask}
          onClose={() => {
            setWoCreateOpen(false);
            setSpawnTask(undefined);
          }}
          onCreated={(wo, withPlan) => {
            setWoCreateOpen(false);
            setSpawnTask(undefined);
            refreshWorkOrders();
            refreshRoadmap(); // WO-0049: the spawned WO flips its task's row (kosuyor + the chip)
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
    </DriveStoreContext.Provider>
  );
}
