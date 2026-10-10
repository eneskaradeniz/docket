// electron/dev-bridge.ts — the docket:dev IPC bridge, stage 1: a session that drives the app over
// CDP sees both sides, the UI and the API/store, and finds contradictions between them without
// guessing. Five ops, all JSON in / JSON out: `describe` (the boundary's names from the api
// layer's own registry), `events.since` (the ui push channel merged with the stored run,
// work-order and audit timelines), `store.read` (five whitelisted views) and `invariants`
// (INV-1…INV-4 over the store's own rows) — and `page_view.trace`, the isolated page view's
// requests as the main process saw them.
//
// The module imports no runtime dependency beyond node builtins: e2e/launch-cdp.mjs imports the
// data-dir safety check from here under plain node, so the launcher and the gate answer the same
// question with the same code instead of carrying a drift-prone copy. Everything from the core —
// the repositories, the domain folds, the registries — arrives by injection, the same way main.ts
// hands every other adapter around.
import { realpathSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  AgentEvent,
  EpochMs,
  FlowDef,
  RunId,
  RunOutcome,
  RunSummary,
  WorkOrderEvent,
  WorkOrderState,
} from '../src/domain/index';
import type {
  AccountRepo,
  AuditEntry,
  AuditSubject,
  BindingRepo,
  BindingScope,
  DefinitionStore,
  EventLog,
  RunRepo,
  WorkOrderRepo,
} from '../src/application/index';
import type { RegistryEntry, UiEvent } from '../src/api/index';

// --- gating (the security contract) -------------------------------------------------------------------

/** Resolves a path whose tail may not exist yet through its nearest existing ancestor. Parents
 *  are followed rather than refused (/tmp on macOS is a symlink), but where they land is what the
 *  ~/.docket comparison must compare against. */
export const realPathThroughAncestors = (p: string): string | undefined => {
  let current = p;
  const missingTail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...missingTail);
    } catch (error) {
      // realpathSync has no throwIfNoEntry option — only a missing tail walks up; other failures
      // (permissions, loops) stay errors.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) return undefined;
    missingTail.unshift(basename(current));
    current = dirname(current);
  }
};

// macOS and Windows filesystems match paths case-insensitively by default, so ~/.DOCKET names the
// same directory as ~/.docket — the comparison folds case there. Only the comparison folds; the
// path the app keeps is the requested spelling.
const FOLDS_CASE = process.platform === 'darwin' || process.platform === 'win32';

const contains = (parent: string, child: string): boolean => {
  const rel = relative(
    FOLDS_CASE ? parent.toLowerCase() : parent,
    FOLDS_CASE ? child.toLowerCase() : child,
  );
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** The one data-dir rule the CDP launcher and this gate share: a candidate is acceptable only
 *  when neither its plain spelling nor its resolved form sits inside the operator's real data
 *  directory (or equals it). Both directions are checked because a non-symlink path can still sit
 *  inside ~/.docket through a symlinked parent. */
export const dataDirOutsideDocketHome = (dataDir: string, docketHome: string): boolean => {
  const plain = resolve(dataDir);
  const real = realPathThroughAncestors(plain);
  const home = resolve(docketHome);
  const realHome = realPathThroughAncestors(home);
  const candidates = real === undefined ? [plain] : [plain, real];
  const anchors = realHome === undefined ? [home] : [home, realHome];
  return !candidates.some((candidate) => anchors.some((anchor) => contains(anchor, candidate)));
};

export interface DevBridgeGate {
  /** `DOCKET_DEV_BRIDGE`, verbatim. */
  readonly flag: string | undefined;
  /** `app.isPackaged` — a packaged build never carries the bridge. */
  readonly isPackaged: boolean;
  /** `DOCKET_DATA_DIR`, verbatim; unset means the app runs on its real storage. */
  readonly dataDir: string | undefined;
  /** The operator's real data directory (`~/.docket`). */
  readonly docketHome: string;
}

/** The bridge exists only when every gate condition holds; each one failing alone must leave no
 *  `docket:dev` handler registered at all. */
export const devBridgeEnabled = (gate: DevBridgeGate): boolean =>
  gate.flag === '1' &&
  !gate.isPackaged &&
  gate.dataDir !== undefined &&
  gate.dataDir !== '' &&
  dataDirOutsideDocketHome(gate.dataDir, gate.docketHome);

// --- the reply envelope -------------------------------------------------------------------------------

/** Every reply's byte ceiling; a reply that would exceed it is cut and flagged. */
export const DEV_BRIDGE_MAX_BYTES = 512 * 1024;

export interface DevBridgeReply {
  readonly truncated: boolean;
  /** The op result as one JSON document. When `truncated` is true this is only a byte prefix of
   *  the document — the caller asked for more than the bridge ships and must narrow the ask (a
   *  continuation token, a page limit), not parse the cut. */
  readonly payload: string;
}

export const devReply = (result: unknown): DevBridgeReply => {
  const payload = JSON.stringify(result);
  if (Buffer.byteLength(payload, 'utf8') <= DEV_BRIDGE_MAX_BYTES) return { truncated: false, payload };
  const cut = Buffer.from(payload, 'utf8').subarray(0, DEV_BRIDGE_MAX_BYTES).toString('utf8');
  return { truncated: true, payload: cut };
};

// --- the ops and the ports ----------------------------------------------------------------------------

export const DEV_OPS = ['describe', 'events.since', 'store.read', 'invariants', 'page_view.trace'] as const;

/** The merged log and the ui ring share this bound: the recent past a session replays, not an
 *  unbounded archive. */
export const DEV_RING_LIMIT = 2000;

/** The events page ceiling — the issue's own `limit ≤ 500`. */
export const EVENTS_PAGE_LIMIT = 500;

/** One audit subject's catch-up read per call; a subject with more new entries than this delivers
 *  its newest slice and the marker moves — a debug bridge replays the recent past, not history. */
const AUDIT_SUBJECT_LIMIT = 500;

/** Summaries are headlines, never payloads: 200 characters, and stream content (text deltas, raw
 *  lines) never appears in them at all. */
export const SUMMARY_MAX = 200;

export const agentEventSummary = (event: AgentEvent): string => {
  switch (event.type) {
    case 'session_started':
      return 'session started';
    case 'text':
      return `text +${event.delta.length} chars`;
    case 'thinking':
      return `thinking +${event.delta.length} chars`;
    case 'tool_call':
      return `tool ${event.name}${event.target === undefined ? '' : ` ${event.target}`}`;
    case 'tool_result':
      return `tool result ${event.ok ? 'ok' : 'failed'} (${event.id})`;
    case 'permission_ask':
      return `permission ask ${event.tool}`;
    case 'permission_answered':
      return `permission_answered ${event.id} ${event.decision}`;
    case 'usage':
      return `usage in ${event.inputTokens} out ${event.outputTokens}`;
    case 'quota_signal':
      return `quota ${event.meter.unit}${event.meter.used === undefined ? '' : ` used ${event.meter.used}`}`;
    case 'limit_hit':
      return `limit hit${event.hit.poolId === undefined ? '' : ` ${event.hit.poolId}`}`;
    case 'error':
      return `error ${event.class}: ${event.message}`;
    case 'finished':
      return `finished ${event.reason}`;
    case 'raw':
      return `raw +${event.line.length} chars`;
  }
};

export const workOrderEventSummary = (event: WorkOrderEvent): string => {
  switch (event.type) {
    case 'created':
      return 'created';
    case 'run_started':
      return `run started ${event.runId} (${event.stage} #${event.attempt})`;
    case 'run_finished':
      return `run finished ${event.outcome} (${event.runId})`;
    case 'gate_evaluated':
      return `gate ${event.gate} ${event.verdict}`;
    case 'blocked':
      return `blocked: ${event.reason}`;
    case 'unblocked':
      return 'unblocked';
    case 'deployment_attempted':
      return `deploy ${event.environment} ${event.result}`;
    case 'closed':
      return 'closed';
  }
};

const auditSubjectText = (subject: AuditSubject): string =>
  subject.kind === 'binding' ? `binding:${subject.role}` : `${subject.kind}:${subject.id}`;

export const auditEntrySummary = (entry: AuditEntry): string =>
  `${entry.action} ${auditSubjectText(entry.subject)}`;

// --- the invariants (pure) ----------------------------------------------------------------------------

export interface InvRunRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly stage: string;
  readonly role: string;
  readonly outcome: RunOutcome | null;
  readonly startedAt: EpochMs;
  readonly endedAt: EpochMs | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The ask ids the store's own fold still sees open in this run's stream. */
  readonly openAskIds: readonly string[];
}

export interface InvOrderRow {
  readonly id: string;
  readonly title: string;
  /** The status the app itself derives and shows; null when the flow no longer loads. */
  readonly status: string | null;
}

export interface InvariantResult {
  readonly id: 'INV-1' | 'INV-2' | 'INV-3' | 'INV-4';
  readonly ok: boolean;
  readonly detail: string;
}

/** INV-1: a run that ended `succeeded` has non-zero summed tokens — the store's outcome and the
 *  stream's usage must agree that work happened. A run with no recorded outcome proves nothing. */
export const inv1SucceededRunsCarryTokens = (runs: readonly InvRunRow[]): InvariantResult => {
  const empty = runs.filter((row) => row.outcome === 'succeeded' && row.inputTokens + row.outputTokens === 0);
  const checked = runs.filter((row) => row.outcome === 'succeeded').length;
  if (empty.length > 0) {
    return { id: 'INV-1', ok: false, detail: `succeeded run(s) with zero summed tokens: ${empty.slice(0, 3).map((row) => row.id).join(', ')}` };
  }
  return { id: 'INV-1', ok: true, detail: `${checked} succeeded run(s) carry tokens` };
};

/** INV-2: if accounts exist, at least one binding exists — an account nobody can route to is a
 *  store the UI would never be able to use. */
export const inv2AccountsHaveABinding = (
  accounts: readonly { readonly id: string }[],
  bindings: readonly unknown[],
): InvariantResult => {
  if (accounts.length === 0) return { id: 'INV-2', ok: true, detail: 'no accounts' };
  if (bindings.length === 0) {
    return { id: 'INV-2', ok: false, detail: `${accounts.length} account(s), no binding at all` };
  }
  return { id: 'INV-2', ok: true, detail: `${accounts.length} account(s), ${bindings.length} binding(s)` };
};

/** INV-3: every run that ended has no open ask — the stream must not park on a human who will
 *  never come; an active run waiting on a person is the board's normal state, not a violation. */
export const inv3EndedRunsHoldNoOpenAsk = (runs: readonly InvRunRow[]): InvariantResult => {
  const dangling = runs.filter((row) => row.endedAt !== null && row.openAskIds.length > 0);
  if (dangling.length > 0) {
    return {
      id: 'INV-3',
      ok: false,
      detail: `ended run(s) with an open ask: ${dangling.slice(0, 3).map((row) => `${row.id} (${row.openAskIds.join(',')})`).join('; ')}`,
    };
  }
  const ended = runs.filter((row) => row.endedAt !== null).length;
  return { id: 'INV-3', ok: true, detail: `${ended} ended run(s), none holds an open ask` };
};

/** INV-4: a work order shown running has an active run — the event log's picture and the run
 *  table's picture must agree while the operator watches a live stage. */
export const inv4RunningOrdersHaveAnActiveRun = (
  orders: readonly InvOrderRow[],
  runs: readonly InvRunRow[],
): InvariantResult => {
  const running = orders.filter((order) => order.status === 'running');
  const ghost = running.filter((order) => !runs.some((row) => row.workOrderId === order.id && row.endedAt === null));
  if (ghost.length > 0) {
    return { id: 'INV-4', ok: false, detail: `shown running without an active run: ${ghost.slice(0, 3).map((order) => order.id).join(', ')}` };
  }
  if (running.length === 0) return { id: 'INV-4', ok: true, detail: 'no work order shown running' };
  return { id: 'INV-4', ok: true, detail: `${running.length} shown running, each with an active run` };
};

// --- the bridge ---------------------------------------------------------------------------------------

export interface DevBridgePorts {
  readonly workOrders: Pick<WorkOrderRepo, 'list' | 'number' | 'events'>;
  readonly runs: Pick<RunRepo, 'listForWorkOrder' | 'events'>;
  readonly accounts: Pick<AccountRepo, 'list'>;
  readonly bindings: Pick<BindingRepo, 'listAll'>;
  readonly log: Pick<EventLog, 'list'>;
  readonly definitions: Pick<DefinitionStore, 'load'>;
  readonly now: () => EpochMs;
  /** The domain's own stream fold (main.ts injects `foldRun`): token sums and the ask ids the
   *  store still believes open. */
  readonly fold: (events: readonly AgentEvent[]) => RunSummary;
  /** The domain's own state fold (main.ts injects `deriveWorkOrderState`): the status the app
   *  shows, derived the way the app derives it. */
  readonly deriveStatus: (flow: FlowDef, events: readonly WorkOrderEvent[]) => WorkOrderState;
  readonly commandRegistry: Readonly<Record<string, RegistryEntry>>;
  readonly queryRegistry: Readonly<Record<string, RegistryEntry>>;
  /** What the isolated page view did, for `page_view.trace`: its current page and URL, how many
   *  windows exist, and the bounded trace of answered and cancelled page requests. A JSON-safe
   *  value; absent when the page view is not wired. */
  readonly pageView?: () => unknown;
}

export interface DevBridge {
  /** One op call; never throws — an unexpected failure is a reply with `ok: false`. */
  call(op: unknown, args?: unknown): Promise<DevBridgeReply>;
  /** The fan-out hook: the same UiEvent the window receives lands in the ring here. */
  pushUiEvent(event: UiEvent, at: EpochMs): void;
}

type DevEventSource = 'docket-event' | 'run' | 'work-order' | 'audit';

export interface DevEventRow {
  readonly n: number;
  readonly at: EpochMs;
  readonly source: DevEventSource;
  readonly type: string;
  readonly runId?: string;
  readonly workOrderId?: string;
  readonly summary: string;
};

/** Time first, then the source order the ops table lists — a deterministic total order with the
 *  per-source tiebreak (ring seq, run index, work-order index, audit id). */
const SOURCE_RANK: Readonly<Record<DevEventSource, number>> = {
  'docket-event': 0,
  run: 1,
  'work-order': 2,
  audit: 3,
};

interface Candidate {
  readonly at: EpochMs;
  readonly source: DevEventSource;
  readonly tie: string;
  readonly row: Omit<DevEventRow, 'n'>;
}

const byTimeline = (a: Candidate, b: Candidate): number =>
  a.at - b.at || SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0);

const STORE_NAMES = ['accounts', 'bindings', 'work_orders', 'runs', 'open_asks'] as const;
type StoreName = (typeof STORE_NAMES)[number];

const isStoreName = (value: unknown): value is StoreName =>
  typeof value === 'string' && (STORE_NAMES as readonly string[]).includes(value);

export const createDevBridge = (ports: DevBridgePorts): DevBridge => {
  // The ui ring: every UiEvent the fan-out sends the window, seq-stamped here, newest last.
  const ring: { readonly seq: number; readonly at: EpochMs; readonly event: UiEvent }[] = [];
  let ringSeq = 0;

  // The merged log and its per-source markers — what has already been assigned an n. Store
  // sources are append-only, so a count per stream and the newest id per audit subject are
  // complete markers; the ring is marked by its own seq.
  const merged: DevEventRow[] = [];
  let nextN = 1;
  let ringMarker = 0;
  const runMarker = new Map<string, number>();
  const orderMarker = new Map<string, number>();
  const auditMarker = new Map<string, string>();

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  /** `events.since` arguments: the continuation token defaults to the beginning, the limit to the
   *  ceiling; both must be whole numbers, and anything else is a bad request, never a guess.
   *  (The issue's own word for the token is a banned vendor substring under the shell's boundary
   *  check, so the wire field is `after` — the deviation is flagged for the architect in the PR.) */
  const eventsArgs = (
    args: unknown,
  ): { readonly ok: true; readonly after: number; readonly limit: number } | { readonly ok: false } => {
    if (args !== undefined && !isRecord(args)) return { ok: false };
    const after = args === undefined ? undefined : (args as Record<string, unknown>).after;
    const limit = args === undefined ? undefined : (args as Record<string, unknown>).limit;
    if (after !== undefined && (typeof after !== 'number' || !Number.isInteger(after) || after < 0)) {
      return { ok: false };
    }
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
      return { ok: false };
    }
    return {
      ok: true,
      after: after ?? 0,
      limit: Math.min(limit ?? EVENTS_PAGE_LIMIT, EVENTS_PAGE_LIMIT),
    };
  };

  /** Merges everything the sources gained since the last call, in timeline order, into the log. */
  const mergeNew = async (): Promise<void> => {
    const candidates: Candidate[] = [];

    for (const entry of ring) {
      if (entry.seq <= ringMarker) continue;
      candidates.push({
        at: entry.at,
        source: 'docket-event',
        tie: `ring:${entry.seq}`,
        row: {
          at: entry.at,
          source: 'docket-event',
          type: entry.event.type,
          runId: entry.event.type === 'run.updated' ? entry.event.runId : undefined,
          summary: entry.event.type,
        },
      });
    }
    if (ring.length > 0) ringMarker = ring[ring.length - 1].seq;

    const orders = await ports.workOrders.list({});
    const runsByOrder: (readonly { readonly id: RunId }[])[] = [];

    for (const order of orders) {
      const events = await ports.workOrders.events(order.id);
      const from = orderMarker.get(order.id) ?? 0;
      for (let index = from; index < events.length; index += 1) {
        const event = events[index];
        if (event === undefined) continue;
        candidates.push({
          at: event.at,
          source: 'work-order',
          tie: `${order.id}:${index}`,
          row: {
            at: event.at,
            source: 'work-order',
            type: event.type,
            runId: event.type === 'run_started' || event.type === 'run_finished' ? event.runId : undefined,
            workOrderId: order.id,
            summary: workOrderEventSummary(event),
          },
        });
      }
      orderMarker.set(order.id, events.length);

      const orderRuns = await ports.runs.listForWorkOrder(order.id);
      runsByOrder.push(orderRuns.map((record) => ({ id: record.id })));
      for (const record of orderRuns) {
        const events = await ports.runs.events(record.id);
        const from = runMarker.get(record.id) ?? 0;
        for (let index = from; index < events.length; index += 1) {
          const event = events[index];
          if (event === undefined) continue;
          candidates.push({
            at: event.at,
            source: 'run',
            tie: `${record.id}:${index}`,
            row: {
              at: event.at,
              source: 'run',
              type: event.type,
              runId: record.id,
              workOrderId: order.id,
              summary: agentEventSummary(event),
            },
          });
        }
        runMarker.set(record.id, events.length);
      }
    }

    // The audit port lists per subject, newest first; every subject this store knows is walked —
    // work orders, runs, accounts, bindings, projects and repos — so the timeline carries the
    // audit's own words for what changed.
    const accounts = await ports.accounts.list();
    const bindings = await ports.bindings.listAll();
    const subjects: AuditSubject[] = [
      ...orders.map((order): AuditSubject => ({ kind: 'work_order', id: order.id })),
      ...runsByOrder.flat().map((record): AuditSubject => ({ kind: 'run', id: record.id })),
      ...accounts.map((record): AuditSubject => ({ kind: 'account', id: record.id })),
      ...bindings.map((entry): AuditSubject => ({ kind: 'binding', role: entry.binding.role })),
      ...orders.map((order): AuditSubject => ({ kind: 'project', id: order.project })),
      ...orders.map((order): AuditSubject => ({ kind: 'repo', id: order.repo })),
    ];
    const seen = new Set<string>();
    for (const subject of subjects) {
      const key = auditSubjectText(subject);
      if (seen.has(key)) continue;
      seen.add(key);
      const entries = await ports.log.list(subject, AUDIT_SUBJECT_LIMIT);
      if (entries.length === 0) continue;
      const known = auditMarker.get(key);
      const fresh: AuditEntry[] = [];
      for (const entry of entries) {
        if (known !== undefined && entry.id === known) break;
        fresh.push(entry);
      }
      auditMarker.set(key, entries[0]?.id ?? known ?? '');
      for (const entry of fresh) {
        candidates.push({
          at: entry.at,
          source: 'audit',
          tie: `audit:${entry.id}`,
          row: {
            at: entry.at,
            source: 'audit',
            type: entry.action,
            runId: entry.subject.kind === 'run' ? entry.subject.id : undefined,
            workOrderId: entry.subject.kind === 'work_order' ? entry.subject.id : undefined,
            summary: auditEntrySummary(entry),
          },
        });
      }
    }

    candidates.sort(byTimeline);
    for (const candidate of candidates) {
      merged.push({ n: nextN, ...candidate.row, summary: candidate.row.summary.slice(0, SUMMARY_MAX) });
      nextN += 1;
    }
    while (merged.length > DEV_RING_LIMIT) merged.shift();
  };

  /** The store's own rows: what the views and the invariants read. One snapshot per call — the
   *  bridge answers from the store as it is, never from a cache a run could have moved. */
  const readSnapshot = async (): Promise<{
    readonly accounts: readonly { readonly id: string; readonly label: string; readonly routeKind: string | null; readonly endpoint: string | null; readonly state: string }[];
    readonly bindings: readonly { readonly scope: BindingScope; readonly role: string; readonly accounts: readonly { readonly accountId: string; readonly model: string | null }[] }[];
    readonly orders: readonly (InvOrderRow & { readonly number: number | null; readonly project: string; readonly repo: string; readonly flow: string })[];
    readonly runs: readonly InvRunRow[];
    readonly openAsks: readonly { readonly runId: string; readonly workOrderId: string; readonly askId: string; readonly tool: string; readonly at: EpochMs }[];
  }> => {
    const accounts = (await ports.accounts.list()).map((record) => ({
      id: record.id,
      label: record.label,
      routeKind: record.routeKind ?? null,
      endpoint: record.endpoint ?? null,
      // The account's stored standing is its auth mode; the secret reference never leaves the vault.
      state: record.authMode,
    }));
    const bindings = (await ports.bindings.listAll()).map(({ scope, binding }) => ({
      scope,
      role: binding.role,
      accounts: binding.accounts.map((entry) => ({ accountId: entry.accountId, model: entry.model ?? null })),
    }));

    const flowsByRepo = new Map<string, readonly FlowDef[]>();
    const flowsFor = async (repo: string): Promise<readonly FlowDef[]> => {
      const cached = flowsByRepo.get(repo);
      if (cached !== undefined) return cached;
      const loaded = await ports.definitions.load(repo as Parameters<DevBridgePorts['definitions']['load']>[0]);
      const flows = loaded.ok ? loaded.value.flows : [];
      flowsByRepo.set(repo, flows);
      return flows;
    };

    const orders: {
      id: string;
      title: string;
      status: string | null;
      number: number | null;
      project: string;
      repo: string;
      flow: string;
    }[] = [];
    const runs: InvRunRow[] = [];
    const openAsks: { runId: string; workOrderId: string; askId: string; tool: string; at: EpochMs }[] = [];

    for (const order of await ports.workOrders.list({})) {
      const events = await ports.workOrders.events(order.id);
      const flows = await flowsFor(order.repo);
      const flow = flows.find((candidate) => candidate.id === order.flow);
      // A flow that no longer loads has no derivable status — the row says so rather than
      // guessing; INV-4 simply cannot speak about such an order.
      orders.push({
        id: order.id,
        title: order.title,
        status: flow === undefined ? null : ports.deriveStatus(flow, events).status,
        number: (await ports.workOrders.number(order.id)) ?? null,
        project: order.project,
        repo: order.repo,
        flow: order.flow,
      });

      for (const record of await ports.runs.listForWorkOrder(order.id)) {
        const events = await ports.runs.events(record.id);
        const folded = ports.fold(events);
        runs.push({
          id: record.id,
          workOrderId: record.workOrderId,
          stage: record.stage,
          role: record.role,
          outcome: record.outcome ?? null,
          startedAt: record.startedAt,
          endedAt: record.endedAt ?? null,
          inputTokens: folded.inputTokens,
          outputTokens: folded.outputTokens,
          openAskIds: folded.openPermissionAsks,
        });
        // open_asks is what the store believes pending: only a run that has not ended can still
        // be parked on a human. The ask's own event carries the tool and the arrival time.
        if (record.endedAt !== undefined) continue;
        for (const askId of folded.openPermissionAsks) {
          const ask = events.find(
            (event): event is Extract<AgentEvent, { readonly type: 'permission_ask' }> =>
              event.type === 'permission_ask' && event.id === askId,
          );
          openAsks.push({
            runId: record.id,
            workOrderId: record.workOrderId,
            askId,
            tool: ask?.tool ?? '',
            at: ask?.at ?? record.startedAt,
          });
        }
      }
    }

    return { accounts, bindings, orders, runs, openAsks };
  };

  const storeView = async (
    name: StoreName,
  ): Promise<
    | { readonly ok: true; readonly name: StoreName; readonly rows: readonly unknown[] }
    | { readonly ok: false; readonly code: 'unknown_store' | 'bad_request' }
  > => {
    const snapshot = await readSnapshot();
    switch (name) {
      case 'accounts':
        return { ok: true, name, rows: snapshot.accounts };
      case 'bindings':
        return { ok: true, name, rows: snapshot.bindings };
      case 'work_orders':
        return { ok: true, name, rows: snapshot.orders };
      case 'runs':
        // The invariant's openAskIds is internal bookkeeping; the view ships the issue's row.
        return {
          ok: true,
          name,
          rows: snapshot.runs.map((row) => ({
            id: row.id,
            workOrderId: row.workOrderId,
            stage: row.stage,
            role: row.role,
            outcome: row.outcome,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
          })),
        };
      case 'open_asks':
        return { ok: true, name, rows: snapshot.openAsks };
    }
  };

  const call = async (opValue: unknown, argsValue: unknown): Promise<DevBridgeReply> => {
    try {
      const op = DEV_OPS.find((candidate) => candidate === opValue);
      if (op === undefined) {
        return devReply({ ok: false, code: 'unknown_op' });
      }
      switch (op) {
        case 'describe': {
          const commands = Object.entries(ports.commandRegistry)
            .map(([name, entry]) => ({ name, input: entry.input }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          const queries = Object.entries(ports.queryRegistry)
            .map(([name, entry]) => ({ name, input: entry.input }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          return devReply({ ok: true, commands, queries, ops: DEV_OPS });
        }
        case 'events.since': {
          const parsed = eventsArgs(argsValue);
          if (!parsed.ok) return devReply({ ok: false, code: 'bad_request' });
          await mergeNew();
          const page = merged.filter((row) => row.n > parsed.after).slice(0, parsed.limit);
          const after = page.length > 0 ? page[page.length - 1].n : parsed.after;
          return devReply({ ok: true, after, events: page });
        }
        case 'store.read': {
          if (argsValue === undefined || !isRecord(argsValue) || typeof argsValue.name !== 'string') {
            return devReply({ ok: false, code: 'bad_request' });
          }
          if (!isStoreName(argsValue.name)) return devReply({ ok: false, code: 'unknown_store' });
          return devReply(await storeView(argsValue.name));
        }
        case 'page_view.trace': {
          if (ports.pageView === undefined) return devReply({ ok: false, code: 'unavailable' });
          const reading = ports.pageView();
          return devReply({ ok: true, ...(isRecord(reading) ? reading : {}) });
        }
        case 'invariants': {
          const snapshot = await readSnapshot();
          return devReply({
            ok: true,
            results: [
              inv1SucceededRunsCarryTokens(snapshot.runs),
              inv2AccountsHaveABinding(snapshot.accounts, snapshot.bindings),
              inv3EndedRunsHoldNoOpenAsk(snapshot.runs),
              inv4RunningOrdersHaveAnActiveRun(snapshot.orders, snapshot.runs),
            ],
          });
        }
      }
    } catch (error) {
      // The bridge never throws across IPC; an unexpected failure is data the session can read.
      return devReply({ ok: false, code: 'op_failed', message: String(error).slice(0, SUMMARY_MAX) });
    }
  };

  return {
    call: (op, args) => call(op, args),
    pushUiEvent: (event, at) => {
      ringSeq += 1;
      ring.push({ seq: ringSeq, at, event });
      if (ring.length > DEV_RING_LIMIT) ring.shift();
    },
  };
};
