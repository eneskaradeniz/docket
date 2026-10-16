// components/autonomy-ceiling-control.tsx — the ceiling control of the widened chain (U-336, D-10
// chain c): a maxLevel select ("Üst sınır") and the warning line ("{n} iş emri sınırın üzerinde")
// when the ceiling lands below existing layers. Like the level control, it offers manual and auto
// only — `balanced` stays hidden until the risk-rule table offers it; a stored `balanced` ceiling
// is only reflected, never offered. The warning is a standing, not a problem: plain ink, no
// `error.*` copy, so the layout walk never reads it as one.
import type { AutonomyLevel } from '../../domain/index';
import { t, type Locale } from '../labels/t';

export interface AutonomyCeilingControlProps {
  readonly locale: Locale;
  /** Marks the control for e2e and distinct instances ('repo' or 'global'). */
  readonly mark: string;
  readonly ceiling: AutonomyLevel | null;
  readonly warningCount: number | null;
  readonly onSelect: (maxLevel: AutonomyLevel | null) => void;
  readonly title?: string;
}

export function AutonomyCeilingControl({
  locale,
  mark,
  ceiling,
  warningCount,
  onSelect,
  title,
}: AutonomyCeilingControlProps) {
  const label = title ?? t(locale, 'autonomy.ceiling');

  return (
    <section
      role="group"
      aria-label={label}
      data-autonomy-ceiling-control={mark}
      className="rounded-card border border-hairline bg-surface px-3 py-3"
    >
      <h2 className="mb-2 text-[13px] font-bold text-ink">{label}</h2>
      <select
        data-autonomy-ceiling-select={mark}
        aria-label={label}
        value={ceiling ?? ''}
        onChange={(event) => {
          const val = event.target.value;
          onSelect(val === '' ? null : (val as AutonomyLevel));
        }}
        className="h-8 rounded-control border border-hairline bg-surface px-2 text-[13px] text-ink"
      >
        <option value="">{t(locale, 'autonomy.ceiling.none')}</option>
        <option value="manual">{t(locale, 'autonomy.level.manual')}</option>
        <option value="auto">{t(locale, 'autonomy.level.auto')}</option>
        {ceiling === 'balanced' ? <option value="balanced">{t(locale, 'autonomy.level.balanced')}</option> : null}
      </select>
      {warningCount !== null && warningCount > 0 ? (
        <p data-autonomy-ceiling-warning={mark} className="m-0 mt-2 text-[12px] text-inkdim">
          {t(locale, 'autonomy.ceilingWarning').replace('{n}', String(warningCount))}
        </p>
      ) : null}
    </section>
  );
}
