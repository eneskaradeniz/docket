// RoleChip — the plan's card language (Mimar amber / Uyg mavi / Doğ yeşil — the lamp grammar's
// family). Shared by the approval cards and the Belgeler step summary (WO-0031d tur-2: extracted
// from the old plan cards when the docs view adopted the card language too).
// WO-0039: the chip TEACHES — its tooltip composes the role's duty line (no new words: ROLE_LABELS +
// ROLE_DUTY_LABELS), so "what does this role do" is answered at the reading moment, everywhere the
// chip appears (plan rows, reports, session cards).
import type { SessionRole } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';
import { Tooltip } from '../../kit';

const ROLE_CHIP: Record<SessionRole, string> = {
  architect: 'border-signal/50 text-signal',
  implementer: 'border-info/50 text-info',
  verifier: 'border-proceed/50 text-proceed',
};

export function RoleChip({ role, className }: { role: SessionRole; className?: string }) {
  const { ROLE_LABELS, UI } = useLabels();
  return (
    <Tooltip label={UI.roleDutyTip(role)}>
      <span
        className={cn(
          'rounded-full border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider',
          ROLE_CHIP[role],
          className,
        )}
      >
        {ROLE_LABELS[role]}
      </span>
    </Tooltip>
  );
}
