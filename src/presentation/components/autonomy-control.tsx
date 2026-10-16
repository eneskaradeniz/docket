// components/autonomy-control.tsx — the autonomy control of the widened chain (U-334, D-10
// chain a): two offered levels — `balanced` stays hidden until the risk-rule table offers it
// (R-167's clause) — the effective level's source line (A-407), `auto` disabled with the typed
// reason text where R-169/R-156 or the ceiling would refuse, and the clear-layer affordance.
// The control speaks for the user like every screen (the api names the actor), so A-403's
// `user_only` can only ever arrive as a failure line, never as a disabled control here.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';

/** The read the control renders (A-407): the effective level with its source, the layer's own
 *  standing, and the typed refusal that would answer an `auto` pick — absent when the level is
 *  already `auto` or nothing refuses it. */
export interface AutonomyControlView {
  readonly level: 'manual' | 'balanced' | 'auto';
  readonly source: string;
  readonly layerSet: boolean;
  readonly autoRefusal?: string;
}

/** The source word of the chain (A-407): one label key per `AutonomySource | 'ceiling'`. */
export const autonomySourceKey = (source: string): LabelKey =>
  `autonomy.source.${source}` as LabelKey;

/** The typed reason's own copy: the refusal codes share the error lines of their commands. */
export const autonomyRefusalKey = (code: string): LabelKey => `error.${code}` as LabelKey;

export interface AutonomyControlProps {
  readonly locale: Locale;
  /** Null keeps the whole section quiet: an unreadable chain is its own typed read's surface,
   *  never a wrong level on a screen. */
  readonly view: AutonomyControlView | null;
  /** Marks the control for the e2e walk; the two surfaces carry their own (detail, repo). */
  readonly mark: string;
  readonly onPick: (level: 'manual' | 'auto') => void;
  readonly onClear: () => void;
}

export function AutonomyControl({ locale, view, mark, onPick, onClear }: AutonomyControlProps) {
  if (view === null) return null;
  const label = t(locale, 'autonomy.title');
  // `auto` is disabled exactly where picking it would answer the typed refusal (U-334); a level
  // that already is `auto` stays selected whatever a later cap removal would say.
  const autoBlocked = view.level !== 'auto' && view.autoRefusal !== undefined;
  return (
    <section
      role="group"
      aria-label={label}
      data-autonomy-control={mark}
      className="rounded-card border border-hairline bg-surface px-3 py-3"
    >
      <h2 className="mb-2 text-[13px] font-bold text-ink">{label}</h2>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-raised">
          <input type="radio" name={`autonomy-${mark}`} checked={view.level === 'manual'} onChange={() => onPick('manual')} />
          <span className="text-[13px] text-ink">{t(locale, 'autonomy.level.manual')}</span>
        </label>
        <label className={`flex items-center gap-2 rounded-control px-2 py-1.5 ${autoBlocked ? '' : 'hover:bg-raised'}`}>
          <input
            type="radio"
            name={`autonomy-${mark}`}
            checked={view.level === 'auto'}
            disabled={autoBlocked}
            aria-describedby={autoBlocked ? `autonomy-${mark}-refusal` : undefined}
            onChange={() => onPick('auto')}
          />
          <span className={`text-[13px] ${autoBlocked ? 'text-inkdim' : 'text-ink'}`}>{t(locale, 'autonomy.level.auto')}</span>
        </label>
      </div>
      {autoBlocked && view.autoRefusal !== undefined ? (
        <p id={`autonomy-${mark}-refusal`} data-autonomy-refusal className="m-0 mt-2 text-[12px] text-inkdim">
          {t(locale, autonomyRefusalKey(view.autoRefusal))}
        </p>
      ) : null}
      <p data-autonomy-source className="m-0 mt-2 text-[12px] text-inkdim">
        {t(locale, autonomySourceKey(view.source))}
      </p>
      {view.layerSet ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 h-8 rounded-control border border-hairline px-3 text-[12px] text-inkdim hover:bg-raised hover:text-ink"
        >
          {t(locale, 'autonomy.clear')}
        </button>
      ) : null}
    </section>
  );
}
