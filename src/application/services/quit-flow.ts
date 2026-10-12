// services/quit-flow.ts — the quit flow's view of the work in flight and the cancel-all sweep.
// The dialog decision reads `activeWork` (runs from the run repository, chat turns from the chat
// runner); the shutdown's last step is `cancelActiveRuns`, which closes whatever the graceful stop
// could not end itself — the same writes the run executor's own end path makes, so a swept run
// reads as `cancelled` (a continuing outcome) and the work order stays resumable.
import type { Actor, ConversationId, RunId, RunOutcome, WorkOrderId } from '../../domain/index';

import type { AppDeps, AuditAction, AuditEntry, AuditSubject } from '../ports';
import type { ChatRunner } from './chat-runner';
import type { BoardHooks } from './permission-board';
import type { WorkOrdersChangedNotify } from './run-executor';

/** One active run with the title the quit dialog lists. */
export interface ActiveRunEntry {
  readonly runId: RunId;
  readonly workOrderId: WorkOrderId;
  readonly title: string;
}

/** One active chat turn with the conversation's title. */
export interface ActiveChatEntry {
  readonly conversationId: ConversationId;
  readonly title: string;
}

export interface ActiveWork {
  readonly runs: readonly ActiveRunEntry[];
  readonly chats: readonly ActiveChatEntry[];
}

/** Work the operator can see running: at least one run or chat turn. Background probes alone
 *  never make a quit ask. */
export const hasUserVisibleWork = (work: ActiveWork): boolean =>
  work.runs.length > 0 || work.chats.length > 0;

type ActiveWorkDeps = Pick<AppDeps, 'runs' | 'workOrders' | 'conversations'>;

/** Everything a quit has to ask about: every run record still open, and every conversation with a
 *  turn in flight. Titles come from the records themselves (a missing record falls back to the
 *  id — the work still happened). */
export async function activeWork(
  deps: ActiveWorkDeps,
  chat: Pick<ChatRunner, 'active'>,
): Promise<ActiveWork> {
  const runs: ActiveRunEntry[] = [];
  for (const run of await deps.runs.listActive()) {
    const order = await deps.workOrders.get(run.workOrderId);
    runs.push({ runId: run.id, workOrderId: run.workOrderId, title: order?.title ?? run.id });
  }
  const chats: ActiveChatEntry[] = [];
  for (const conversation of await deps.conversations.list({})) {
    if (chat.active(conversation.id) === undefined) continue;
    chats.push({ conversationId: conversation.id, title: conversation.title });
  }
  return { runs, chats };
}

// The sweep is machine-written, like every other run end the executor writes.
const QUIT_ACTOR: Actor = { kind: 'system', component: 'quit-flow' };

type CancelRunsDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'runs' | 'workOrders' | 'runTokens'>;

/** Closes every still-active run as `cancelled`: the record's `endedAt`/`outcome`, the work
 *  order's `run_finished` event, the run token revoked, the board entry dropped — the same writes
 *  the executor's end path makes, so the work order shows a resumable state after a quit. */
export async function cancelActiveRuns(
  deps: CancelRunsDeps,
  board?: BoardHooks,
  workOrdersChanged?: WorkOrdersChangedNotify,
): Promise<readonly RunId[]> {
  const cancelled: RunId[] = [];
  for (const run of await deps.runs.listActive()) {
    const endedAt = deps.clock.now();
    await deps.runs.update(run.id, { endedAt, outcome: 'cancelled' satisfies RunOutcome });
    await deps.workOrders.appendEvent(run.workOrderId, {
      type: 'run_finished',
      at: endedAt,
      runId: run.id,
      outcome: 'cancelled',
    });
    deps.runTokens.revoke(run.id);
    board?.unregister(run.id);
    const entry: AuditEntry = {
      id: deps.ids.next<'audit'>(),
      at: endedAt,
      actor: QUIT_ACTOR,
      action: 'run.finished' satisfies AuditAction,
      subject: { kind: 'run', id: run.id } satisfies AuditSubject,
      detail: { outcome: 'cancelled', reason: 'app_quit' },
    };
    await deps.log.append(entry);
    cancelled.push(run.id);
  }
  // After the last append: a store re-querying at delivery time already sees every closure.
  if (cancelled.length > 0) workOrdersChanged?.();
  return cancelled;
}
