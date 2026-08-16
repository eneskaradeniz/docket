// StepCard (WO-0031c / v4) — the plan's card language: number + role chip (Mimar amber / Uyg mavi /
// Doğ yeşil — the same family as the lamp grammar) + aim + scope + a status line. The machine format
// (JSON, the ```steps fence) never reaches the screen (v3 rule); the cards ARE the plan. A state flip
// flashes the card (`.flash` / `.flash-err`) — wired when c2's live per-step statuses land; pre-approval
// cards render the dashed "hazır" next-up shape.
import type { SessionRole, StepSpec } from '../../../core/types';
import { ROLE_LABELS, UI } from '../../data/labels';
import { cn } from '../../kit';

const ROLE_CHIP: Record<SessionRole, string> = {
  architect: 'border-signal/50 text-signal',
  implementer: 'border-info/50 text-info',
  verifier: 'border-proceed/50 text-proceed',
};

export function RoleChip({ role, className }: { role: SessionRole; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider',
        ROLE_CHIP[role],
        className,
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

export function StepCard({
  step,
  statusLine,
  next,
  className,
}: {
  step: Pick<StepSpec, 'idx' | 'role' | 'aim' | 'scope'>;
  /** The card's status line — already display text (labels), e.g. "hazır" or "tamam · ⏱ 00:06 · $0,96". */
  statusLine?: string;
  /** The dashed next-up shape (a step about to run / proposed). */
  next?: boolean;
  className?: string;
}) {
  const scopeText = step.scope.kind === 'all' ? UI.stepScopeAll : step.scope.ref;
  return (
    <div
      className={cn(
        'stepcard rounded-md border bg-surface p-3',
        next ? 'border-dashed border-info/40' : 'border-hairline',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-inkdim">{step.idx}</span>
        <RoleChip role={step.role} />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-inkdim">{scopeText}</span>
      </div>
      <p className="mt-1.5 text-[12.5px] font-semibold leading-snug text-ink">{step.aim}</p>
      {statusLine ? <p className="mt-1.5 font-mono text-[11px] text-inkdim">{statusLine}</p> : null}
    </div>
  );
}
