import type { StageRailStep } from '../../../core/types';
import { needsText, STAGE_LABELS } from '../../data/labels';
import { Badge } from '../primitives/Badge';

const STATUS_DOT: Record<StageRailStep['status'], string> = {
  done: 'bg-emerald-500',
  current: 'bg-sky-500',
  locked: 'bg-rose-400',
  upcoming: 'bg-slate-300',
};

export function StageRail({ steps }: { steps: StageRailStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      {steps.map((s, i) => (
        <li key={s.stage} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-4 bg-slate-200" aria-hidden />}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s.status]}`} aria-hidden />
              <span
                className={`text-xs ${
                  s.status === 'current' ? 'font-semibold text-slate-900' : 'text-slate-500'
                }`}
              >
                {STAGE_LABELS[s.stage]}
              </span>
            </div>
            {s.status === 'locked' && s.needs && s.needs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {s.needs.map((n) => (
                  <Badge key={n} tone="bad">
                    {needsText(n)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
