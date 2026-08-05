import type { StageRailStep } from '../../../core/types';
import { needsText, STAGE_LABELS } from '../../data/labels';

const STATUS_DOT: Record<StageRailStep['status'], string> = {
  done: 'bg-sage',
  current: 'bg-brass',
  locked: 'bg-clay',
  upcoming: 'bg-rule',
};

export function StageRail({ steps }: { steps: StageRailStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-sm border border-rule bg-surface p-3">
      {steps.map((s, i) => (
        <li key={s.stage} className="flex items-center gap-2">
          {i > 0 ? <span className="h-px w-4 bg-rule" aria-hidden="true" /> : null}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s.status]}`} aria-hidden="true" />
              <span className={`text-xs ${s.status === 'current' ? 'font-semibold text-ink' : 'text-inkdim'}`}>
                {STAGE_LABELS[s.stage]}
              </span>
            </div>
            {s.status === 'locked' && s.needs && s.needs.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {s.needs.map((n) => (
                  <span key={n} className="err text-[11px]">
                    {needsText(n)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
