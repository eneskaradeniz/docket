import type { WorkOrderDetailView } from '../../../core/types';
import { ABSENT_REASON_LABELS, ACTION_LABELS, CARD_ACTION_AREA, UI } from '../../data/labels';

// The prominent "what's needed" banner at the top of the detail (WO-0013). Read-only — the actual
// controls (allow/deny, approve, …) live in SessionPane, wired to the runner; this just surfaces the
// one thing that matters. No buttons ⇒ no `disabled` control (ADR-0001). (Buttons wiring = a TD.)
export function ActionCard({ detail }: { detail: WorkOrderDetailView }) {
  const stopped = detail.sessions.find((s) => s.status === 'stopped_asking');
  const running = detail.sessions.some((s) => s.status === 'running');
  const primary = detail.primaryAction;

  let area: string;
  let prompt: string;
  if (stopped) {
    area = CARD_ACTION_AREA.permission;
    prompt = UI.permissionRequested;
  } else if (running) {
    // A live session means there is nothing for the operator to click — the old "Oturumu sürdür" here
    // was a no-op while a drive was already in flight (WO-0027 / Bulgu 6). Absent, with the honest state.
    area = UI.actionRunning;
    prompt = primary.kind === 'absent' ? ABSENT_REASON_LABELS[primary.reason] : ACTION_LABELS[primary.intent];
  } else if (primary.kind === 'available') {
    const i = primary.intent;
    area = i === 'approve_plan' ? CARD_ACTION_AREA.plan : i === 'close' ? CARD_ACTION_AREA.closure : CARD_ACTION_AREA.link;
    prompt = ACTION_LABELS[i];
  } else {
    area = UI.actionNeeded;
    prompt = ABSENT_REASON_LABELS[primary.reason];
  }

  return (
    <div className="flex items-stretch rounded-sm border border-rule bg-surface">
      <div className={`bar bar-brass${running ? '' : ' pulse'}`} />
      <div className="perf" />
      <div className="px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{area}</p>
        <p className="mt-1 text-[14px] text-ink">{prompt}</p>
      </div>
    </div>
  );
}
