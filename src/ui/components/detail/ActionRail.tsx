// ActionRail (WO-0031c / v4) — the console's bottom action bar: lamp + one message line + the actions
// the operator owns, right-aligned. The v4 rules live here: the rail is QUIET (transparent, no border
// chrome weight) when it only speaks, ABSENT entirely when there is nothing to say and nothing to do
// (a closed work order has no rail — "eylem yok" durumu söylenmez, yaşanır), and Durdur lives ONLY
// here — the one working interrupt (the Faz B panes' dead onClick={stop} is gone).
import type { ReactNode } from 'react';
import { Button } from '../../kit';
import { cn } from '../../kit';
import type { LampTone } from '../session/pane-chrome';
import { lampClass } from '../session/pane-chrome';

export interface RailAction {
  id: string;
  label: string;
  variant: 'primary' | 'secondary' | 'ghost' | 'signal' | 'danger';
  busy?: boolean;
  locked?: boolean;
  onActivate: () => void;
}

export function ActionRail({
  tone,
  message,
  messageNode,
  actions,
}: {
  tone: LampTone;
  message?: string;
  /** Rich message (bold segments); overrides `message` when given. */
  messageNode?: ReactNode;
  actions?: RailAction[];
}) {
  const hasActions = actions !== undefined && actions.length > 0;
  const speaks = message !== undefined || messageNode !== undefined;
  if (!speaks && !hasActions) return null; // nothing asked of you → no rail
  return (
    <footer
      data-rail=""
      className={cn(
        'mt-3 flex shrink-0 items-center gap-3 rounded-md px-3 py-2',
        hasActions ? 'border border-hairline bg-surface/85' : 'border border-dashed border-hairline/60 bg-transparent',
      )}
    >
      <div className={cn('lamp self-center h-4', lampClass(tone))} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[12px] text-inkdim">
        {messageNode ?? (message !== undefined ? <p>{message}</p> : null)}
      </div>
      {hasActions ? (
        <div className="flex shrink-0 items-center gap-2">
          {actions.map((a) => (
            <Button
              key={a.id}
              variant={a.variant}
              size="sm"
              busy={a.busy}
              locked={a.locked}
              onClick={a.onActivate}
              className={a.variant === 'primary' ? 'min-w-[92px]' : undefined}
            >
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
    </footer>
  );
}
