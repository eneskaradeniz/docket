// src/core/roadmap.ts — the roadmap layer's derivation (WO-0048, ADR-0016), the budget.ts shape:
// small pure functions plus one composed View. The store adapter feeds it document text + workspace
// facts + work-order facts; the CLI and (WO-0049) the UI consume the view.
//
// STATUS IS NEVER STORED — the layer's one law. A task's status derives from its linked work orders,
// a faz's from its tasks and blockers, the head's counts from the orders. The task→WO link arrives
// as `taskRef` on each order fact (the store parses it out of order.md front-matter at view time);
// there is no DB column and this module never asks for one.
import { parseRoadmapMd, roadmapDiagnostics, type FazSpec, type RoadmapDiagnostic } from './roadmap-md';

export type TaskStatus = 'planli' | 'kosuyor' | 'tamam';
export type FazStatus = 'planli' | 'kosuyor' | 'bekliyor' | 'tamam';
export type SpawnAbsentReason = 'kosuyor' | 'bloke' | 'repo_yok';

/** Task status: no WO → planli; any open → kosuyor; all closed (≥1) → tamam. */
export function taskStatusOf(linked: { closed: boolean }[]): TaskStatus {
  if (linked.length === 0) return 'planli';
  if (linked.some((o) => !o.closed)) return 'kosuyor';
  return 'tamam';
}

/**
 * Faz status, precedence pinned: any task kosuyor → kosuyor (a faz that IS running must not read as
 * blocked); else any blocker not tamam → bekliyor; else tasks>0 and all tamam → tamam (the vacuous
 * truth refused — a zero-task faz is planned, not done); else planli.
 */
export function fazStatusOf(input: { tasks: TaskStatus[]; blockers: FazStatus[] }): FazStatus {
  if (input.tasks.includes('kosuyor')) return 'kosuyor';
  if (input.blockers.some((b) => b !== 'tamam')) return 'bekliyor';
  if (input.tasks.length > 0 && input.tasks.every((t) => t === 'tamam')) return 'tamam';
  return 'planli';
}

/**
 * The spawn action (`İş emri aç`, ADR-0001 — absent with a structural reason, never disabled):
 * available on a planli task with a resolved repo in an unblocked faz. A KOSUYOR faz does not
 * block its planli tasks (mockup frame-01). A tamam task carries no reason — the "N WO kapandı"
 * evidence line is its tail; only the three actionable codes exist.
 */
export function spawnActionOf(input: { task: TaskStatus; faz: FazStatus; repo: string | undefined; knownRepos: string[] }):
  { available: true } | { available: false; reason?: SpawnAbsentReason } {
  if (input.task === 'tamam') return { available: false };
  if (input.task === 'kosuyor') return { available: false, reason: 'kosuyor' };
  if (input.faz === 'bekliyor') return { available: false, reason: 'bloke' };
  if (input.repo === undefined || !input.knownRepos.includes(input.repo)) return { available: false, reason: 'repo_yok' };
  return { available: true };
}

/** One work order's roadmap-relevant facts, joined by the store at view time (closed ⇔ closure sha). */
export interface RoadmapOrderFact {
  id: string;
  closed: boolean;
  costUsd: number; // Σ session cost observed for this WO (NULL sessions contribute 0)
  costUnknown?: boolean; // true when any session row carries NULL cost — the honest undercount flag
  taskRef?: string; // order.md front-matter `task:` — absent = unlinked (görevsiz iş emri)
}

export interface DeriveRoadmapInput {
  roadmapMd: string;
  workspaceSlug: string;
  knownRepos: string[];
  orders: RoadmapOrderFact[];
}

export interface TaskView {
  id: string;
  title: string;
  repo?: string;
  note?: string;
  status: TaskStatus;
  closedWoCount: number;
  closedCostUsd: number;
  openWoIds: string[];
  spawn: { available: true } | { available: false; reason?: SpawnAbsentReason };
}

export interface FazView {
  id: string;
  title: string;
  aim?: string;
  notes?: string;
  blockedBy: string[];
  status: FazStatus;
  closedWoCount: number;
  closedCostUsd: number;
  openWoCount: number;
  tasks: TaskView[];
}

export interface RoadmapHead {
  title: string;
  doneFazCount: number;
  totalFazCount: number;
  openWoCount: number;
  totalCostUsd: number; // ALL observed spend (closed + open) — the mockup's $14,02
  costUnknown: boolean;
}

export type RoadmapView =
  | { kind: 'absent' } // no roadmap.md — the invitation surface (WO-0049)
  | { kind: 'invalid'; reasons: RoadmapDiagnostic[] } // parse failure OR any error diagnostic — never half-trusted
  | { kind: 'ready'; head: RoadmapHead; fazlar: FazView[]; siradaki: { fazId: string; taskId: string } | undefined; warnings: RoadmapDiagnostic[] };

/**
 * Compose the view. `''` → absent. A parse error OR any error diagnostic → invalid with the named
 * reasons (a duplicate-id or foreign-workspace roadmap must not render). Otherwise ready: orders
 * group onto tasks by `taskRef` (a ref naming no task is INVISIBLE in fazlar — the orphan ruling —
 * but still counts in the head), faz statuses resolve through memoized recursion (a back-edge reads
 * as not-tamam, so a cycle yields bekliyor without looping), and `siradaki` is the FIRST spawnable
 * task in array order ("ilk yapılabilir görev" — pure derivation, written nowhere).
 */
export function deriveRoadmapView(input: DeriveRoadmapInput): RoadmapView {
  if (input.roadmapMd === '') return { kind: 'absent' };
  const parsed = parseRoadmapMd(input.roadmapMd);
  const diagnostics = roadmapDiagnostics(input.roadmapMd, { workspaceSlug: input.workspaceSlug, knownRepos: input.knownRepos });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) return { kind: 'invalid', reasons: errors };

  const byTask = new Map<string, RoadmapOrderFact[]>();
  for (const o of input.orders) {
    if (o.taskRef === undefined) continue;
    const list = byTask.get(o.taskRef);
    if (list) list.push(o);
    else byTask.set(o.taskRef, [o]);
  }

  const memo = new Map<string, FazStatus>();
  const resolving = new Set<string>();
  const fazStatusById = (id: string, fazlar: FazSpec[]): FazStatus => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    // A back-edge (cycle) or unknown ref reads as not-tamam — the blocker holds, no recursion.
    if (resolving.has(id)) return 'bekliyor';
    const faz = fazlar.find((f) => f.id === id);
    if (!faz) return 'planli';
    resolving.add(id);
    const blockers = faz.blockedBy.map((b) => fazStatusById(b, fazlar));
    resolving.delete(id);
    const status = fazStatusOf({ tasks: faz.tasks.map((t) => taskStatusOf(byTask.get(t.id) ?? [])), blockers });
    memo.set(id, status);
    return status;
  };

  let siradaki: { fazId: string; taskId: string } | undefined;
  const fazlar: FazView[] = parsed.fazlar.map((f) => {
    const status = fazStatusById(f.id, parsed.fazlar);
    const tasks: TaskView[] = f.tasks.map((t) => {
      const linked = byTask.get(t.id) ?? [];
      const closed = linked.filter((o) => o.closed);
      const spawn = spawnActionOf({ task: taskStatusOf(linked), faz: status, repo: t.repo, knownRepos: input.knownRepos });
      if (siradaki === undefined && spawn.available) siradaki = { fazId: f.id, taskId: t.id };
      return {
        id: t.id,
        title: t.title,
        ...(t.repo !== undefined ? { repo: t.repo } : {}),
        ...(t.note !== undefined ? { note: t.note } : {}),
        status: taskStatusOf(linked),
        closedWoCount: closed.length,
        closedCostUsd: round2(closed.reduce((s, o) => s + o.costUsd, 0)),
        openWoIds: linked.filter((o) => !o.closed).map((o) => o.id),
        spawn,
      };
    });
    return {
      id: f.id,
      title: f.title,
      ...(f.aim !== undefined ? { aim: f.aim } : {}),
      ...(f.notes !== undefined ? { notes: f.notes } : {}),
      blockedBy: f.blockedBy,
      status,
      closedWoCount: tasks.reduce((s, t) => s + t.closedWoCount, 0),
      closedCostUsd: round2(tasks.reduce((s, t) => s + t.closedCostUsd, 0)),
      openWoCount: tasks.reduce((s, t) => s + t.openWoIds.length, 0),
      tasks,
    };
  });

  return {
    kind: 'ready',
    head: {
      title: parsed.title,
      doneFazCount: fazlar.filter((f) => f.status === 'tamam').length,
      totalFazCount: fazlar.length,
      openWoCount: input.orders.filter((o) => !o.closed).length,
      totalCostUsd: round2(input.orders.reduce((s, o) => s + o.costUsd, 0)),
      costUnknown: input.orders.some((o) => o.costUnknown === true),
    },
    fazlar,
    siradaki,
    warnings: diagnostics.filter((d) => d.severity === 'warning'),
  };
}

// Cent-round the money sums so 3.10+4.20+1.00+2.60+1.50 === 12.40 in the view too, not 12.399999….
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
