// components/detail-strip.tsx — the stage strip (U-224, the operator's Alternative 1): an
// ordered list of stage segments only — done behind the work order, the current one marked with
// its dot and, while decisions wait, the single “· N kapı bekliyor” counter part on its label;
// gate names never ride the strip, they belong to the decision cards. Every segment also says
// its state in words for assistive tech (A6): the dot and the colour are redundant cues, never
// the only cue. The pending-gate marking the issue's U-19 sentence names lives in this counter
// and in the zone's dashed rows — there is no dashed gate segment (the architect's #972 call).
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { StripSegment } from '../stores/work-order-detail';

const BAR_STANDING_CLASS: Readonly<Record<StripSegment['standing'], string>> = {
  done: 'bg-proceed',
  current: 'bg-signal',
  future: 'bg-hairline',
};

const barClass = (segment: StripSegment): string => {
  if (segment.standing === 'current' && segment.failed) return 'bg-error';
  if (segment.standing === 'current' && segment.running) {
    return 'bg-[linear-gradient(90deg,var(--color-proceed)_0_50%,var(--color-hairline)_50%_100%)]';
  }
  return BAR_STANDING_CLASS[segment.standing];
};

const dotClass = (segment: StripSegment): string => {
  if (segment.failed) return 'bg-error';
  if (segment.running) return 'bg-proceed motion-safe:animate-pulse';
  return 'bg-signal';
};

/** The state word a segment carries for assistive tech (A6) — its standing, said. */
const stateWordKey = (segment: StripSegment): LabelKey => {
  if (segment.standing === 'done') return 'detail.strip.state.done';
  if (segment.standing === 'future') return 'detail.strip.state.pending';
  return segment.failed ? 'detail.strip.state.failed' : segment.running ? 'detail.strip.state.running' : 'detail.strip.state.pending';
};

export interface DetailStripProps {
  readonly segments: readonly StripSegment[];
  readonly locale: Locale;
}

export function DetailStrip({ segments, locale }: DetailStripProps) {
  return (
    <nav aria-label={t(locale, 'detail.strip.label')}>
      <ol data-detail-strip className="m-0 flex min-w-0 list-none gap-2 overflow-x-auto p-0">
        {segments.map((segment) => (
          <li
            key={segment.name}
            aria-current={segment.standing === 'current' ? 'step' : undefined}
            className={`flex min-w-0 flex-col gap-2 ${segment.standing === 'current' ? 'flex-[1.6_1_0%]' : 'flex-1 basis-0'}`}
          >
            {/* The bar: 6 px, the control corner token — the same height and radius whatever the standing. */}
            <span aria-hidden="true" className={`h-1.5 rounded-control ${barClass(segment)}`} />
            <span
              className={`flex min-w-0 items-center gap-2 text-[0.8125rem] ${
                segment.standing === 'current' ? 'font-semibold text-ink' : segment.standing === 'done' ? 'font-medium text-ink' : 'font-medium text-inkdim'
              }`}
            >
              {segment.standing === 'done' ? (
                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-proceed">
                  <path d="M2.5 6.5l2.3 2.3L9.5 3.8" />
                </svg>
              ) : null}
              {segment.standing === 'current' ? (
                <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${dotClass(segment)}`} />
              ) : null}
              <span className="truncate" title={segment.name}>{segment.name}</span>
              {segment.gatesWaiting >= 1 ? (
                <span className="flex-none whitespace-nowrap text-[0.78125rem] font-normal text-signal-soft">
                  {t(locale, 'detail.strip.gatesWaiting').replace('{n}', String(segment.gatesWaiting))}
                </span>
              ) : null}
              <span className="sr-only">{t(locale, stateWordKey(segment))}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
