import type { WorkOrderDetailView } from '../../../core/types';
import { useLabels } from '../../data/locale';

// The prominent "what's needed" banner at the top of the detail (WO-0013). Read-only — the actual
// controls (allow/deny, approve, …) live in SessionPane, wired to the runner; this just surfaces the
// one thing that matters. No buttons ⇒ no `disabled` control (ADR-0001). (Buttons wiring = a TD.)
export function ActionCard({ detail }: { detail: WorkOrderDetailView }) {
  const { ABSENT_REASON_LABELS, ACTION_LABELS, CARD_ACTION_AREA, UI } = useLabels();
  const stopped = detail.sessions.find((s) => s.status === 'stopped_asking');
  const running = detail.sessions.some((s) => s.status === 'running');
  const primary = detail.primaryAction;

  let area: string;
  let prompt: string;
  if (stopped) {
    area = CARD_ACTION_AREA.permission;
    prompt = UI.permissionRequested;
  } else if (running) {
    // WO-0044 (operator, 2026-08-25): a live session means there is nothing for the operator to
    // click — the card is ABSENT (the old "Çalışıyor / Oturumu sürdür" read-only pairing was the
    // label of a button that died in WO-0027/Bulgu 6, reading as a standing offer while running;
    // the band's lamp + the driven row's instrument already carry the state).
    return null;
  } else if (primary.kind === 'available' && primary.intent === 'resume') {
    // WO-0044: Sürdür lives ONLY in DriveControls ('▶ Sürdür', ⏎'s target) — never here as a
    // read-only echo. The word leaves the detail screen entirely.
    return null;
  } else if (primary.kind === 'available') {
    const i = primary.intent;
    area = i === 'approve_plan' ? CARD_ACTION_AREA.plan : i === 'close' ? CARD_ACTION_AREA.closure : CARD_ACTION_AREA.link;
    prompt = ACTION_LABELS[i];
  } else {
    area = UI.actionNeeded;
    prompt = ABSENT_REASON_LABELS[primary.reason];
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 flex-1 px-3.5 py-2.5">
        <p className="readout text-inkdim">{area}</p>
        <p className="mt-0.5 truncate text-[13.5px] font-medium text-ink">{prompt}</p>
      </div>
    </div>
  );
}
