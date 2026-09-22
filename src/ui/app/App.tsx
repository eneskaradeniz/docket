import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RepoId, StepView, WorkOrder, WorkOrderId, Workspace, WorkspaceId } from '../../core/types';
import type { BriefingCheck, PermissionRule, RoadmapDraft, UpdateWorkOrderInput, WorkOrderSource } from '../../core/source';
import type { SessionRunner } from '../../core/runner';
import type { ForgeIssueRow, ForgeView, ForgeWatch } from '../../core/forge';
import type { SystemHealth, SystemHealthWatch } from '../../core/health';
import type { WorkspaceBudgetView } from '../../core/budget';
import type { ChangesBridge } from '../components/detail/ChangesSection';
import { DEFAULT_WARN_PERCENT, workspaceBudgetView } from '../../core/budget';
import { limitInEffect, overlayLiveDrive, toCardView, toDetailView } from '../../core/derive';
import { orderMdCarriesRule, parseOrderMd } from '../../core/order-md';
import { roadmapTaskOf, type RoadmapView } from '../../core/roadmap';
import { DEFAULT_DOCS_ROOT } from '../../core/roadmap-md';
import type { WorkspaceUsageView } from '../../core/usage';
import type { ChromeNavigate } from '../../core/tray-menu';
import type { WorkspaceOverview } from '../../core/overview';
import { useLabels } from '../data/locale';
import { AppShell, type AppbarActivity, type Surface } from '../chrome/AppShell';
import type { AppSettings } from '../../core/app-settings';
import { WoCreateModal, type WoIssuePrefill } from '../chrome/WoCreateModal';
import { WsSettingsModal } from '../chrome/WsSettingsModal';
import { Button, Dialog } from '../kit';
import { BoardScreen } from '../screens/BoardScreen';
import { HealthSection } from '../components/HealthSection';
import { DetailScreen } from '../screens/DetailScreen';
import { RoadmapScreen } from '../screens/RoadmapScreen';
import { UsageScreen } from '../screens/UsageScreen';
import { OverviewScreen } from '../screens/OverviewScreen';
import { InviteHero } from '../components/InviteHero';
import type { WoSpawnPrefill } from '../components/roadmap/TaskRow';
import { createDriveStore, DriveStoreContext, useActiveDrives, useDriveActivity } from '../components/session/drive-store';
import { ToastHost, toast } from '../chrome/ToastHost';

type LoadState = 'loading' | 'ready' | 'error';

// App receives the data port (WorkOrderSource) and the session-runner port (SessionRunner),
// and never imports an adapter itself. Only the composition root (electron/main.ts) imports
// an adapter. The data port is async (WO-0009 — SQLite); workspaces + work orders load once
// on mount, the selected work order + its docs load on selection, each with a state for the
// in-flight/failed case. The runner is provided via context for the session pane.
export function App({ source, settings, runner, forge: forgeWatch, health: healthWatch, changes: changesBridge, chromeNav }: { source: WorkOrderSource;
  settings: AppSettings; runner: SessionRunner; forge?: ForgeWatch; health?: SystemHealthWatch; changes?: ChangesBridge;
  /** WO-0100: the native chrome's navigate push (tray rows, Pano'ya dön, the menu's Ayarlar…). */
  chromeNav?: { onNavigate: (cb: (p: ChromeNavigate) => void) => () => void } }) {
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
  // WO-0100: the native menu's `Ayarlar…` — a request counter the shell turns into the settings modal.
  const [settingsRequest, setSettingsRequest] = useState(0);
  // WO-0049: the roadmap view (undefined = loading) + the effective structure root. Read once per
  // mount/entry (WO-0048 R2) + at the moments the facts move (drive ends, a WO's task link changes,
  // a save, a root switch) — never on a timer.
  const [roadmap, setRoadmap] = useState<RoadmapView | undefined>(undefined);
  const [docsRoot, setDocsRoot] = useState<string>(DEFAULT_DOCS_ROOT);
  // WO-0049: the roadmap's `▸ İş emri aç` opens the create modal PRE-FILLED (kare 06); undefined =
  // the plain board flow.
  const [spawnTask, setSpawnTask] = useState<WoSpawnPrefill | undefined>(undefined);
  // WO-0092: the issue spawn — the prefilled create modal (single) and the counted batch confirm.
  const [spawnIssue, setSpawnIssue] = useState<WoIssuePrefill | undefined>(undefined);
  const [batchIssue, setBatchIssue] = useState<WoIssuePrefill[] | undefined>(undefined);
  const [batchCreating, setBatchCreating] = useState(false);
  // WO-0092 fix round (m3): the create phase is retry-honest — the refs already created ride this
  // list, a mid-batch failure keeps the confirm open, and a re-click creates only the remainder.
  const [batchDoneRefs, setBatchDoneRefs] = useState<string[]>([]);
  // The issue↔WO join (view-time, no DB column): {woId → 'owner/repo#N'}, refreshed at the same
  // moments the board list is — a WO deleted manually drops out and the issue row stays honest.
  const [issueRefs, setIssueRefs] = useState<Record<string, string>>({});

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

  // WO-0090 — the briefing check: order.md's pointers resolved read-at-sha (each repo at its HEAD,
  // the sha a fresh drive starts from), read at detail open + every reload — the PRE-DRIVE moment.
  // Its own effect + resilient catch: a failed read (an adapter throw) degrades to undefined —
  // "could not look", never a failure, and never a broken detail load.
  const [briefingCheck, setBriefingCheck] = useState<BriefingCheck | undefined>(undefined);
  useEffect(() => {
    if (!selectedId) {
      setBriefingCheck(undefined);
      return;
    }
    let cancelled = false;
    source
      .briefingCheck(selectedId)
      .then((check) => {
        if (!cancelled) setBriefingCheck(check);
      })
      .catch(() => {
        if (!cancelled) setBriefingCheck(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [source, selectedId, detailNonce]);

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

  // WO-0092 — the issue rows' spawned-WO chips: the view-time join over issueRefs × the loaded
  // work orders (this workspace only). A WO deleted manually drops out; the map stays honest.
  const spawnedWoByIssue = useMemo(() => {
    const m = new Map<string, WorkOrderId[]>();
    for (const w of workOrders) {
      if (w.workspace !== workspaceId) continue;
      const ref = issueRefs[w.id as string];
      if (ref === undefined) continue;
      m.set(ref, [...(m.get(ref) ?? []), w.id]);
    }
    return m;
  }, [workOrders, workspaceId, issueRefs]);

  // WO-0028 / Bulgu 12: the app-level drive store — drives outlive pane navigation. Created before
  // the cards memo because the board reads its live snapshot (base-mobile trial).
  const driveStore = useMemo(() => createDriveStore(runner), [runner]);
  // WO-0088: the RUNNING drives' facts — ONE entry per live WO drive (N at once; identity-stable
  // between transitions — it does NOT re-render per transcript line). One subscription feeds the
  // board overlays, the Sil gate and the title counter, so all three agree with the detail screen.
  const activeDrives = useActiveDrives(driveStore);
  // WO-0060: the appbar chip's facts — a SECOND subscription on the same store; activitySnapshot's
  // primitive content-compare keeps it silent per streamed line and per ~30s windows-pull emit.
  const driveActivity = useDriveActivity(driveStore);

  // WO-0091: the stall clock — a drive going silent fires NO event, so the board would never
  // re-derive the verdict on time alone. This slow tick re-reads the snapshots against the wall
  // clock while any drive runs (the content-compare keeps every tick between crossings free); the
  // panes need nothing — their own 1s ticker already re-derives the staleness line.
  useEffect(() => {
    if (activeDrives.length === 0) return;
    const t = setInterval(() => driveStore.stallTick(), 30_000);
    return () => clearInterval(t);
  }, [driveStore, activeDrives.length]);

  // WO-0088: each card overlays ITS OWN live drive — the snapshot whose woId matches (the draft
  // never overlays a board card, the locked ruling).
  const cards = useMemo(
    () =>
      workOrders
        .filter((w) => w.workspace === workspaceId)
        .map((wo) =>
          overlayLiveDrive(toCardView(wo), activeDrives.find((s) => s.woId === wo.id)),
        ),
    [workOrders, workspaceId, activeDrives],
  );

  // WO-0060: the chip's input. The limit is an ACCOUNT fact → every WO's rows flatten into
  // limitInEffect (App holds the unfiltered list), and the live stamp covers the ✦ draft, which has
  // no rows at all. The amber arm folds into `limitWarn`'s presence — AppShell never hears the
  // fold's status word. Date.now() in a memo is deliberate: stamps move only when these deps move;
  // the chip's own ticker owns every subsequent second.
  const appbarActivity = useMemo<AppbarActivity>(() => {
    const running = driveActivity?.running ?? 0;
    return {
      running,
      limitResetAt: limitInEffect(
        workOrders.flatMap((w) => w.sessions),
        driveActivity?.limitResetAt,
        Date.now(),
      ),
      ...(running > 0 && driveActivity?.limitStatus === 'warning' && driveActivity.limitSubject
        ? { limitWarn: driveActivity.limitSubject }
        : {}),
    };
  }, [workOrders, driveActivity]);

  const refreshWorkspaces = useCallback(() => {
    source.getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      setWorkspaceId((prev) => (prev && ws.some((w) => w.id === prev) ? prev : (ws[0]?.id ?? null)));
    });
  }, [source]);

  // WO-0064 — the forge observation loop, ADR-0010's cadence: open/switch (the workspace effect
  // below), window focus, a 60 s background tick, after board-affecting actions (riding
  // refreshWorkOrders), and the section's own Yenile. A failed trigger degrades silently — the
  // next trigger re-reads, and the view keeps the last scan's facts. The view is keyed to the
  // workspace it scanned: a switch shows NO forge section until the new workspace's own view
  // lands (the old one never bleeds across). The watch is optional: present only when the
  // composition root wired the forge (the bridge group).
  const [forge, setForge] = useState<{ ws: WorkspaceId; view: ForgeView } | undefined>(undefined);
  const refreshForge = useCallback(() => {
    if (!forgeWatch || !workspaceId) return;
    forgeWatch
      .reconcile(workspaceId)
      .catch(() => {})
      .then(() => forgeWatch.view(workspaceId))
      .then((v) => setForge({ ws: workspaceId, view: v }))
      .catch(() => {});
  }, [forgeWatch, workspaceId]);
  const refreshForgeRef = useRef<() => void>(() => {});
  refreshForgeRef.current = refreshForge;
  useEffect(() => {
    refreshForge();
  }, [refreshForge]); // open + workspace switch
  useEffect(() => {
    if (!forgeWatch) return;
    const tick = (): void => refreshForgeRef.current();
    window.addEventListener('focus', tick);
    const t = setInterval(tick, 60_000); // the slow background interval (ADR-0010)
    return () => {
      window.removeEventListener('focus', tick);
      clearInterval(t);
    };
  }, [forgeWatch]);

  // WO-0092 — the detail band's issue chip: the order.md `issue:` ref; the ↗ url resolves from
  // the landed forge view's cache (view-time, zero calls). Unresolvable (no view / not on the
  // open page) degrades to the ref chip without the link — never a guessed url.
  const detailIssueChip = useMemo<{ ref: string; url?: string } | undefined>(() => {
    const ref = parsedOrder.issueRef;
    if (ref === undefined) return undefined;
    const view = forge !== undefined && workspaceId !== null && forge.ws === workspaceId ? forge.view : undefined;
    const row = view?.repos.flatMap((r) => r.issues).find((i) => i.ref === ref);
    return row !== undefined ? { ref, url: row.url } : { ref };
  }, [parsedOrder, forge, workspaceId]);

  // After creating a work order, re-fetch the list (mirrors refreshWorkspaces) so the new card appears.
  const refreshWorkOrders = useCallback(() => {
    source.getWorkOrders().then(setWorkOrders);
    // WO-0092: the issue-link join rides the same action funnel — created/deleted WOs move it.
    if (workspaceId !== null) {
      source.woIssueRefs(workspaceId).then(setIssueRefs).catch(() => setIssueRefs({}));
    }
    refreshForgeRef.current(); // "after any action it takes" — the board's action funnel (WO-0064)
  }, [source, workspaceId]);
  // WO-0092: the join's workspace-entry read (the actions funnel above covers the rest).
  useEffect(() => {
    if (workspaceId === null) {
      setIssueRefs({});
      return;
    }
    source.woIssueRefs(workspaceId).then(setIssueRefs).catch(() => setIssueRefs({}));
  }, [source, workspaceId]);

  // WO-0092 — the single spawn: ONE drill-down (the body's only fetch), then the NORMAL create
  // dialog prefilled — the operator edits before save. A failed drill-down rethrows the
  // displayable reason: the row refuses in place, nothing is written (the shaped unknown).
  // Fix round (m5): the track seed resolves through the CONNECTION ROW (the landed forge view's
  // repo path slug) — never the forge repo name compared against a path slug.
  const connectionSlugFor = useCallback(
    (wsId: WorkspaceId, repoRemote: string): string | undefined => {
      const view = forge !== undefined && forge.ws === wsId ? forge.view : undefined;
      const repo = view?.repos.find((r) => r.repoRemote === repoRemote);
      return repo !== undefined ? (repo.path.split('/').filter(Boolean).at(-1) ?? undefined) : undefined;
    },
    [forge],
  );
  const handleSpawnIssue = useCallback(
    async (repoRemote: string, issue: ForgeIssueRow) => {
      if (forgeWatch === undefined || workspaceId === null) return;
      const detail = await forgeWatch.issueDetail(workspaceId, repoRemote, issue.number);
      const slug = connectionSlugFor(workspaceId, repoRemote);
      setSpawnIssue({
        ref: issue.ref,
        ...(detail.title !== undefined ? { title: detail.title } : {}),
        ...(detail.body !== undefined ? { body: detail.body } : {}),
        ...(slug !== undefined ? { repo: slug } : {}),
      });
    },
    [forgeWatch, workspaceId, connectionSlugFor],
  );
  // WO-0092 — the counted batch: EVERY drill-down first (a single failure refuses the whole
  // batch, nothing written), then the ONE counted confirm gates the N creates.
  const handleBatchSpawnIssues = useCallback(
    async (repoRemote: string, issues: ForgeIssueRow[]) => {
      if (forgeWatch === undefined || workspaceId === null) return;
      const prefills: WoIssuePrefill[] = [];
      for (const issue of issues) {
        const detail = await forgeWatch.issueDetail(workspaceId, repoRemote, issue.number);
        const slug = connectionSlugFor(workspaceId, repoRemote);
        prefills.push({
          ref: issue.ref,
          ...(detail.title !== undefined ? { title: detail.title } : {}),
          ...(detail.body !== undefined ? { body: detail.body } : {}),
          ...(slug !== undefined ? { repo: slug } : {}),
        });
      }
      setBatchDoneRefs([]); // a fresh confirm owns a fresh done-list (m3)
      setBatchIssue(prefills);
    },
    [forgeWatch, workspaceId, connectionSlugFor],
  );

  // WO-0066 — the health look, ADR-0010's cadence (mount + focus + the slow tick; view-only).
  // A failed look resolves undefined and the LAST observation stays — the strip never flickers
  // into nothing, and the first-run gate blocks on OBSERVED degradation only.
  const [systemHealth, setSystemHealth] = useState<SystemHealth | undefined>(undefined);
  const refreshHealth = useCallback(() => {
    healthWatch?.systemHealth().then((h) => { if (h) setSystemHealth(h); }).catch(() => {});
  }, [healthWatch]);
  const refreshHealthRef = useRef(refreshHealth);
  refreshHealthRef.current = refreshHealth;
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]); // mount
  useEffect(() => {
    if (!healthWatch) return;
    const tick = (): void => refreshHealthRef.current();
    window.addEventListener('focus', tick);
    const t = setInterval(tick, 60_000);
    return () => {
      window.removeEventListener('focus', tick);
      clearInterval(t);
    };
  }, [healthWatch]);

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
      // close; base-mobile trial). WO-0088: ANY live drive of the workspace counts.
      const liveWsIds = new Set(
        activeDrives.map((s) => workOrders.find((w) => w.id === s.woId)?.workspace).filter((ws) => ws !== undefined),
      );
      return workOrders.some((w) => w.workspace === id && w.sessions.some((s) => s.status === 'running')) || liveWsIds.has(id);
    },
    [workOrders, activeDrives],
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
  // WO-0050: the workspace's pending ✦ draft row rides the same read — the TASLAK card's source
  // (it descends at plan_ready via the store's onPlanReady hook, not a beat later at onEnd).
  const [roadmapDraft, setRoadmapDraft] = useState<RoadmapDraft | null>(null);
  const refreshRoadmap = useCallback(() => {
    if (!workspaceId) {
      setRoadmap(undefined);
      setRoadmapDraft(null);
      return;
    }
    void Promise.all([source.getRoadmap(workspaceId), settings.getDocsRoot(workspaceId), source.getRoadmapDraft(workspaceId)])
      .then(([view, root, draft]) => {
        setRoadmap(view);
        setDocsRoot(root);
        setRoadmapDraft(draft);
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
  // WO-0054: the usage month — the pure read (the derivation is core's; the port is one channel).
  // Same cadence as the roadmap read: workspace entry + surface entry + the four drive hooks.
  const [usage, setUsage] = useState<WorkspaceUsageView | undefined>(undefined);
  const refreshUsage = useCallback(() => {
    if (!workspaceId) {
      setUsage(undefined);
      return;
    }
    void source
      .workspaceUsage(workspaceId)
      .then(setUsage)
      .catch(() => setUsage(undefined));
  }, [source, workspaceId]);
  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);
  useEffect(() => {
    if (surface === 'usage') refreshUsage();
  }, [surface, refreshUsage]);
  // WO-0072: the workspace overview — the projection is derived per read (never cached), so the
  // read-once-per-mount/switch cadence is the whole contract: workspace entry + surface entry,
  // exactly the usage read's shape. The drive hooks deliberately do NOT refresh it (the roadmap
  // nonce interplay is not needed either): re-entering the surface re-reads, and a stale glance
  // until then is the TD-055 read-once stance.
  const [overview, setOverview] = useState<WorkspaceOverview | undefined>(undefined);
  const refreshOverview = useCallback(() => {
    if (!workspaceId) {
      setOverview(undefined);
      return;
    }
    void source
      .workspaceOverview(workspaceId)
      .then(setOverview)
      .catch(() => setOverview(undefined));
  }, [source, workspaceId]);
  useEffect(() => {
    refreshOverview();
  }, [refreshOverview]);
  useEffect(() => {
    if (surface === 'overview') refreshOverview();
  }, [surface, refreshOverview]);
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
      onSwitch={(id) => {
        // WO-0074 (the WO-0032 precedent): a workspace switch lands on the new workspace's BOARD —
        // the open detail belonged to the previous workspace, and keeping it rendered a foreign WO
        // under a foreign header. A same-workspace re-pick keeps the open detail.
        setWorkspaceId(id);
        setSelectedId((prev) => (prev && detail?.wo.workspace === id ? prev : null));
      }}
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
      driveActivity={appbarActivity}
      settingsRequest={settingsRequest}
    />
  ) : null;

  // WO-0100 — the native chrome's navigate push. The latest request is held until the board data is
  // ready; a WO the list does not know yet triggers ONE list refresh, then a retry — still unknown
  // is a silent no-op. No new surface: the same state moves the in-app routes already make.
  const chromeNavRef = useRef<ChromeNavigate | null>(null);
  const chromeNavRetryRef = useRef<WorkOrder[] | null>(null); // the list the refresh was asked over
  const [chromeNavNonce, setChromeNavNonce] = useState(0);
  useEffect(() => {
    if (chromeNav === undefined) return;
    return chromeNav.onNavigate((p) => {
      chromeNavRef.current = p;
      chromeNavRetryRef.current = null;
      setChromeNavNonce((n) => n + 1);
    });
  }, [chromeNav]);
  useEffect(() => {
    const p = chromeNavRef.current;
    if (p === null || load === 'loading') return;
    // Settings needs only the mounted shell (AppShell renders for any load but 'loading', the
    // error card included); the board-bound requests wait for the data.
    if (p.kind !== 'settings' && load !== 'ready') return;
    const done = (): void => {
      chromeNavRef.current = null;
      chromeNavRetryRef.current = null;
    };
    if (p.kind === 'wo') {
      const wo = workOrders.find((w) => w.id === p.id);
      if (wo === undefined) {
        if (chromeNavRetryRef.current === null) {
          chromeNavRetryRef.current = workOrders;
          refreshWorkOrders();
        } else if (chromeNavRetryRef.current !== workOrders) {
          done(); // refreshed and still unknown
        }
        return;
      }
      done();
      // the WO-0074 rule: the detail belongs to its own workspace
      setWorkspaceId(wo.workspace);
      setSelectedId(wo.id);
    } else if (p.kind === 'draft') {
      done();
      if (!workspaces.some((w) => w.id === p.workspaceId)) return;
      setWorkspaceId(p.workspaceId);
      setSelectedId(null);
      setSurface('roadmap');
    } else if (p.kind === 'board') {
      done();
      setSelectedId(null);
      setSurface('board');
    } else {
      done();
      setSettingsRequest((n) => n + 1);
    }
  }, [chromeNavNonce, load, workOrders, workspaces, refreshWorkOrders]);

  // The active workspace — needed by the main chain below (the roadmap screen takes it as a prop).
  const currentWorkspace = useMemo(() => workspaces.find((w) => w.id === workspaceId), [workspaces, workspaceId]);

  // WO-0092 — the counted batch's execution: N creates AFTER the confirm, sequential numbers via
  // the store's own allocation, each WO carrying its own `issue:` link (the taskRef idiom).
  const batchTracksFor = useCallback(
    (repo: string | undefined): RepoId[] => {
      if (currentWorkspace === undefined) return [];
      const tracks: RepoId[] =
        currentWorkspace.repos.length > 1
          ? currentWorkspace.repos.filter((r) => r !== currentWorkspace.decisionStore)
          : currentWorkspace.repos;
      return repo !== undefined && tracks.some((r) => (r as string) === repo)
        ? tracks.filter((r) => (r as string) === repo)
        : tracks;
    },
    [currentWorkspace],
  );
  const runBatchSpawn = useCallback(async () => {
    if (batchIssue === undefined || workspaceId === null) return;
    // WO-0092 fix round (m3): retry-honest — a mid-batch failure keeps the confirm open and the
    // created refs stay done; a re-click creates ONLY the remainder (no duplicate issue links).
    const remaining = batchIssue.filter((p) => !batchDoneRefs.includes(p.ref));
    if (remaining.length === 0) {
      setBatchIssue(undefined);
      return;
    }
    setBatchCreating(true);
    try {
      for (const p of remaining) {
        await source.createWorkOrder({
          workspaceId,
          title: p.title ?? p.ref, // a title-less wire row falls back to its own ref
          description: p.body ?? '',
          trackRepos: batchTracksFor(p.repo),
          reviewMode: 'gates',
          contextFiles: [],
          permissionRule: defaultRule,
          issueRef: p.ref,
        });
        setBatchDoneRefs((cur) => [...cur, p.ref]);
      }
      toast.push({ kind: 'confirm', title: UI.issueBatchToast(remaining.length) });
      setBatchIssue(undefined);
      refreshWorkOrders();
    } catch {
      // the honest partial state: the confirm stays open, its count now names the remainder
      toast.push({ kind: 'error', title: UI.saveFailed });
    } finally {
      setBatchCreating(false);
    }
  }, [batchIssue, batchDoneRefs, workspaceId, source, batchTracksFor, defaultRule, UI, refreshWorkOrders]);

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
    // WO-0066 — the FIRST-RUN gate: while git or the agent identity is OBSERVED degraded, the
    // create action is ABSENT with the reason lines (ADR-0001 — never disabled); a failed look
    // hides only itself, and the gate never fires again once any workspace exists.
    const byTool = (t: 'git' | 'agent') => systemHealth?.checks.find((c) => c.tool === t);
    const gateDegraded = [byTool('git'), byTool('agent')].some((c) => c && c.state !== 'ok');
    main = (
      <main className="mx-auto w-full max-w-[840px] px-5 py-5">
        {systemHealth && <HealthSection health={systemHealth} />}
        {gateDegraded ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 px-6">
            <p className="font-mono text-[11px] text-inkdim">{UI.healthCreateWaits}</p>
          </div>
        ) : (
          <InviteHero line={UI.inviteFirstWs} cta={UI.wsCreate} onCta={() => setWsCreateOpen(true)} />
        )}
      </main>
    );
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
        issueChip={detailIssueChip}
        onOpenIssueExternal={(url: string) => void window.docket.shell?.openExternal(url)}
        changes={changesBridge}
        briefingCheck={briefingCheck}
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
        draft={roadmapDraft}
        onSpawn={(p) => setSpawnTask(p)}
        onOpenWo={setSelectedId}
        onRefresh={refreshRoadmap}
        onRaiseBudget={handleRaiseBudget}
        budgetHasUnknown={budget?.hasUnknown ?? false}
      />
    ) : null;
  } else if (surface === 'usage') {
    // WO-0054: the third surface, keyed by workspace like its siblings (a fresh surface on swap).
    main = currentWorkspace ? (
      <UsageScreen
        key={workspaceId ?? 'none'}
        view={usage}
        budget={budget}
        workspace={currentWorkspace}
        woIds={workOrders.filter((w) => w.workspace === workspaceId).map((w) => w.id)}
      />
    ) : null;
  } else if (surface === 'overview') {
    // WO-0072: the fourth surface — the read-only projection, keyed by workspace like its siblings.
    main = currentWorkspace ? (
      <OverviewScreen
        key={workspaceId ?? 'none'}
        view={overview}
        health={systemHealth}
        forge={forge && workspaceId !== null && forge.ws === workspaceId ? forge.view : undefined}
        forgePending={forgeWatch !== undefined && !(forge !== undefined && forge.ws === workspaceId)}
        onRefreshForge={refreshForge}
        onPrDetail={
          workspaceId !== null && forgeWatch
            ? (repoRemote: string, number: number) => forgeWatch.prDetail(workspaceId, repoRemote, number)
            : undefined
        }
        onPrDiff={
          workspaceId !== null && forgeWatch
            ? (repoRemote: string, number: number) => forgeWatch.prDiff(workspaceId, repoRemote, number)
            : undefined
        }
        onOpenExternal={(url: string) => void window.docket.shell?.openExternal(url)}
        onSpawnIssue={workspaceId !== null && forgeWatch ? (repoRemote, issue) => handleSpawnIssue(repoRemote, issue) : undefined}
        onBatchSpawnIssues={workspaceId !== null && forgeWatch ? (repoRemote, issues) => handleBatchSpawnIssues(repoRemote, issues) : undefined}
        spawnedWoIdsByIssue={spawnedWoByIssue}
        onSelect={setSelectedId}
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
  // WO-0050 (review f6): the draft ask toast is BACKGROUND-gated like the WO one — no toast when
  // the operator is already looking at the roadmap surface with nothing open over it.
  const surfaceRef = useRef<Surface>(surface);
  surfaceRef.current = surface;
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
      refreshUsage(); // WO-0054: the terminal usage rows land — the ledger's figures move
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
      refreshUsage(); // WO-0054: the drive's first rows join the ledger
    };
    // base-mobile trial: the pipeline returns the session row to 'running' when the last ask is
    // answered, but nothing else fires for ask_resolved — refresh here so the rows snapshot agrees
    // with the fold. Without it the board card bounces working → Seni bekliyor → settled when the
    // drive ends and the live overlay lifts off a stale stopped_asking row.
    driveStore.onAskResolved = () => {
      refreshWorkOrders();
      refreshBudget();
      refreshRoadmap();
      refreshUsage(); // WO-0054: the same refresh moment the ask's records need
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
      // WO-0050 (D13): the draft drive's ask reaches the operator wherever they are — the toast
      // lands on the roadmap surface (there is no WO card to flip). Background-gated (review f6):
      // already on the roadmap with nothing open → the card is in view, no toast.
      if (wo === undefined && driveStore.wsId(key) !== undefined && !(surfaceRef.current === 'roadmap' && selectedIdRef.current === null)) {
        const title = UI.roadmapDraftAskToast;
        const goDraft = (): void => {
          setSelectedId(null);
          setSurface('roadmap');
        };
        toast.push({ kind: 'news', title, body: UI.toastAskBody, onActivate: goDraft });
        try {
          if (typeof Notification !== 'undefined') {
            const n = new Notification(title, { body: UI.toastAskBody });
            n.onclick = () => {
              window.focus();
              goDraft();
            };
          }
        } catch {
          // notification surface unavailable — the toast + title already carry the news
        }
      }
    };
    // WO-0050: the TASLAK card descends the MOMENT the proposal lands (plan_ready is mid-drive —
    // the architect session keeps running its stop notice after it); the row read is the card's.
    driveStore.onPlanReady = () => {
      refreshRoadmap();
    };
    driveStore.onError = (key) => {
      refreshWorkOrders();
      refreshBudget(); // WO-0047: an erroring drive still records its observed cost
      refreshRoadmap();
      refreshUsage(); // WO-0054: an erroring drive's observed rows land with it
      const wo = woOf(key);
      if (isBackground(key) && wo !== undefined) {
        toast.push({ kind: 'error', title: UI.toastErrTitle(woIdLabel(wo)) });
      }
    };
  }, [driveStore, refreshWorkOrders, refreshBudget, refreshRoadmap, refreshUsage, UI, woIdLabel]);

  // The window-title counter: "(n) izin bekliyor" while any work order waits on the operator. The
  // live fold outranks a stale stopped_asking row — an ask the operator already answered is being
  // worked, not waited on (base-mobile trial; the row refresh follows via onAskResolved).
  // WO-0050 (D13): the draft drive's held asks count too (the current workspace's key — a draft
  // only ever runs for the workspace it was started from).
  const draftAsks = useSyncExternalStore(
    driveStore.subscribe,
    () => driveStore.get(`${workspaceId ?? ''}:draft`)?.state.pendingAsks.length ?? 0,
  );
  useEffect(() => {
    // WO-0088: a live drive that is NOT parked on an ask hides its row's stale stopped_asking
    // state — now a SET (N drives run at once).
    const staleActives = new Set(
      activeDrives.filter((s) => s.status !== 'stopped_asking').map((s) => s.woId),
    );
    const waiting =
      workOrders.filter((w) => w.sessions.some((s) => s.status === 'stopped_asking') && !staleActives.has(w.id)).length + draftAsks;
    document.title = waiting > 0 ? UI.titlePending(waiting) : UI.productName;
  }, [workOrders, activeDrives, draftAsks, UI]);

  return (
    <DriveStoreContext.Provider value={driveStore}>
      {chrome}
      {main}
      <ToastHost />
      {(woCreateOpen || spawnTask !== undefined || spawnIssue !== undefined) && currentWorkspace ? (
        <WoCreateModal
          workspace={currentWorkspace}
          source={source}
          defaultRule={defaultRule}
          prefill={spawnTask}
          issuePrefill={spawnIssue}
          onClose={() => {
            setWoCreateOpen(false);
            setSpawnTask(undefined);
            setSpawnIssue(undefined);
          }}
          onCreated={(wo, withPlan) => {
            setWoCreateOpen(false);
            setSpawnTask(undefined);
            setSpawnIssue(undefined);
            refreshWorkOrders();
            refreshRoadmap(); // WO-0049: the spawned WO flips its task's row (kosuyor + the chip)
            setSelectedId(wo.id); // navigate to the new work order's detail
            if (withPlan) setAutoPlanFor(wo.id); // "Oluştur ve plan iste": the architect starts on arrival
          }}
        />
      ) : null}
      {batchIssue !== undefined ? (
        // WO-0092: the ONE counted confirm — N issues → N work orders, sequential numbers, each
        // with its own `issue:` link. Nothing was written before this confirm. Fix round (m3):
        // the count names the REMAINDER — a mid-batch failure keeps the dialog open, honestly
        // re-counted, and a re-click creates only what is left.
        <Dialog
          open
          narrow
          onOpenChange={(o) => { if (!o && !batchCreating) setBatchIssue(undefined); }}
          title={UI.issueBatchConfirmTitle}
          closeAria={UI.dialogCloseAria}
          footer={
            <>
              <Button variant="ghost" size="sm" locked={batchCreating} onClick={() => setBatchIssue(undefined)}>{UI.cancel}</Button>
              <Button variant="primary" size="sm" busy={batchCreating} locked={batchCreating} onClick={() => void runBatchSpawn()}>
                {UI.issueBatchGo(batchIssue.length - batchDoneRefs.length)}
              </Button>
            </>
          }
        >
          <p className="text-[12px] text-inkdim">{UI.issueBatchConfirmBody(batchIssue.length - batchDoneRefs.length)}</p>
        </Dialog>
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
