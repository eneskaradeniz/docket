// flow/derive.ts — exact contract from docs/v2/domain.md section 5.
// A work order's state is a single left fold over its events; nothing else is stored.
import type { FlowDef, GateDef, StageDef } from '../definitions';
import type { GateVerdict } from '../gates';
import type { GateSlug, StageSlug } from '../shared';
import type { WorkOrderEvent } from './events';

export type WorkOrderStatus =
  | 'ready' // the current stage has a role and no run yet for this attempt
  | 'running' // a run started and has not finished
  | 'gating' // run succeeded; some non-human gates not yet evaluated/passed (pending)
  | 'awaiting_human' // only human/page gates are pending, or the stage has no role
  | 'limit_waiting' // last run ended with outcome 'limit'
  | 'blocked' // explicit block, or attempts exhausted, or unknown verdict
  | 'done'; // passed the last stage's gates, or closed

export interface WorkOrderState {
  readonly status: WorkOrderStatus;
  readonly stage: StageSlug | null; // null only when done
  readonly attempt: number; // 1-based attempt of the current stage
  readonly pendingGates: readonly GateSlug[];
  readonly blockedReason?: string;
}

export function deriveWorkOrderState(flow: FlowDef, events: readonly WorkOrderEvent[]): WorkOrderState {
  return toState(flow, events.reduce((acc, event) => step(flow, acc, event), initial(flow)));
}

const RUN_FAILED_REASON = 'run failed';

/** Only a person answers these two kinds; every other gate is machine-evaluated. */
const isHumanGate = (gate: GateDef): boolean => gate.kind === 'human' || gate.kind === 'page_approval';

/**
 * The fold's accumulator. `entries` counts how many times each stage has been entered
 * (R-21a); `preBlock` snapshots the accumulator when the work order became blocked, so
 * `unblocked` can restore the exact pre-block state (R-23).
 */
interface Acc {
  readonly status: WorkOrderStatus;
  readonly stageIndex: number;
  readonly attempt: number;
  readonly pendingGates: readonly GateSlug[];
  readonly blockedReason: string | undefined;
  readonly entries: Readonly<Record<string, number>>;
  readonly done: boolean;
  readonly preBlock: Acc | null;
}

const gateIds = (stage: StageDef): readonly GateSlug[] => stage.exit.map((gate) => gate.id);

/** Status while the stage's gates are undecided: `gating` until the last non-human gate is
 *  decided, `awaiting_human` once only human gates remain (or the stage has no role at all). */
const statusForPending = (stage: StageDef, pending: readonly GateSlug[]): WorkOrderStatus => {
  const nonHumanPending = stage.exit.some((gate) => !isHumanGate(gate) && pending.includes(gate.id));
  return nonHumanPending ? 'gating' : 'awaiting_human';
};

const doneAcc = (stageIndex: number, attempt: number, entries: Readonly<Record<string, number>>): Acc => ({
  status: 'done',
  stageIndex,
  attempt,
  pendingGates: [],
  blockedReason: undefined,
  entries,
  done: true,
  preBlock: null,
});

/**
 * Becoming the current stage: counts the entry (R-21a) and settles at `ready` when it has a
 * role, `awaiting_human` when it does not. A stage with no role and no gates cannot hold the
 * flow — it advances on entry (R-19), which can cascade through several such stages.
 */
const enterStage = (flow: FlowDef, index: number, entries: Readonly<Record<string, number>>): Acc => {
  const stage = flow.stages[index];
  if (stage === undefined) {
    // Walked off the end of the flow; the attempt of the stage that carried us here carries on.
    const lastIndex = index - 1;
    const last = flow.stages[lastIndex];
    return doneAcc(lastIndex, last === undefined ? 1 : (entries[last.id] ?? 1), entries);
  }
  const count = (entries[stage.id] ?? 0) + 1;
  const nextEntries: Readonly<Record<string, number>> = { ...entries, [stage.id]: count };
  if (stage.role === null && stage.exit.length === 0) return enterStage(flow, index + 1, nextEntries);
  return {
    status: stage.role === null ? 'awaiting_human' : 'ready',
    stageIndex: index,
    attempt: count,
    pendingGates: gateIds(stage),
    blockedReason: undefined,
    entries: nextEntries,
    done: false,
    preBlock: null,
  };
};

/** The fold starts at the entry state R-17 describes, so `created` itself changes nothing. */
const initial = (flow: FlowDef): Acc => enterStage(flow, 0, {});

/** Move past the current stage: the next stage at attempt 1, or `done` after the last one. */
const advance = (flow: FlowDef, acc: Acc): Acc => {
  const nextIndex = acc.stageIndex + 1;
  if (nextIndex >= flow.stages.length) {
    return { ...acc, status: 'done', pendingGates: [], blockedReason: undefined, done: true, preBlock: null };
  }
  return enterStage(flow, nextIndex, acc.entries);
};

const block = (acc: Acc, reason: string): Acc => ({
  ...acc,
  status: 'blocked',
  blockedReason: reason,
  // A block already in keeping keeps its original snapshot: "the state before the block" is
  // the state before the blocked period began, not before its latest confirmation.
  preBlock: acc.status === 'blocked' ? acc.preBlock : acc,
});

/** R-21: a failure either jumps to `onFail.goto` (while the goto stage has entries left) or blocks. */
const applyFail = (flow: FlowDef, acc: Acc, reason: string): Acc => {
  const onFail = flow.stages[acc.stageIndex].onFail;
  if (onFail === undefined) return block(acc, reason);
  const next = (acc.entries[onFail.goto] ?? 0) + 1;
  const targetIndex = flow.stages.findIndex((candidate) => candidate.id === onFail.goto);
  if (next > onFail.maxAttempts || targetIndex < 0) return block(acc, reason);
  return enterStage(flow, targetIndex, acc.entries);
};

/** R-19: a successful run turns the stage's gates pending; nothing to evaluate means advance. */
const applySuccess = (flow: FlowDef, acc: Acc): Acc => {
  const stage = flow.stages[acc.stageIndex];
  if (stage.exit.length === 0) return advance(flow, acc);
  const pending = gateIds(stage);
  return { ...acc, status: statusForPending(stage, pending), pendingGates: pending };
};

/** R-18: a cancelled run leaves the attempt as if no run had started for it yet. */
const applyCancelled = (flow: FlowDef, acc: Acc): Acc => {
  const stage = flow.stages[acc.stageIndex];
  return { ...acc, status: stage.role === null ? 'awaiting_human' : 'ready', pendingGates: gateIds(stage) };
};

const applyVerdict = (flow: FlowDef, acc: Acc, gate: GateSlug, verdict: GateVerdict): Acc => {
  const stage = flow.stages[acc.stageIndex];
  if (verdict.status === 'passed') {
    const pending = acc.pendingGates.filter((candidate) => candidate !== gate);
    if (pending.length === 0) return advance(flow, { ...acc, pendingGates: pending }); // R-20: all passed
    return { ...acc, pendingGates: pending, status: statusForPending(stage, pending) };
  }
  if (verdict.status === 'pending') return { ...acc, status: statusForPending(stage, acc.pendingGates) };
  if (verdict.status === 'unknown') return block(acc, verdict.reason); // R-22: never advances
  return applyFail(flow, acc, `gate "${gate}" failed: ${verdict.reason}`); // R-21
};

const step = (flow: FlowDef, acc: Acc, event: WorkOrderEvent): Acc => {
  if (acc.done) return acc; // R-23: events after done are ignored
  // A block holds the work order until it is lifted or the work order is closed; whatever
  // arrives meanwhile belongs to the blocked period and must not survive unblocking.
  if (acc.status === 'blocked' && event.type !== 'unblocked' && event.type !== 'closed') return acc;
  const stage = flow.stages[acc.stageIndex];
  switch (event.type) {
    case 'created':
      return acc; // the entry state is the fold's start, so creation itself is a no-op
    case 'run_started':
      return event.stage === stage.id ? { ...acc, status: 'running' } : acc;
    case 'run_finished':
      if (event.outcome === 'succeeded') return applySuccess(flow, acc);
      if (event.outcome === 'failed') return applyFail(flow, acc, RUN_FAILED_REASON);
      if (event.outcome === 'limit') return { ...acc, status: 'limit_waiting' };
      return applyCancelled(flow, acc);
    case 'gate_evaluated': {
      if (event.stage !== stage.id) return acc;
      if (acc.status !== 'gating' && acc.status !== 'awaiting_human') return acc;
      if (!acc.pendingGates.includes(event.gate)) return acc;
      return applyVerdict(flow, acc, event.gate, event.verdict);
    }
    case 'blocked':
      return block(acc, event.reason);
    case 'unblocked':
      return acc.preBlock ?? acc;
    case 'closed':
      return doneAcc(acc.stageIndex, acc.attempt, acc.entries);
  }
};

const toState = (flow: FlowDef, acc: Acc): WorkOrderState => {
  const stage: StageSlug | null = acc.done ? null : flow.stages[acc.stageIndex].id;
  const base = { status: acc.status, stage, attempt: acc.attempt, pendingGates: acc.pendingGates };
  return acc.blockedReason === undefined ? base : { ...base, blockedReason: acc.blockedReason };
};
