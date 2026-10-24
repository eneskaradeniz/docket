// components/autonomy-control.tsx — the autonomy control of the widened chain (U-334, D-10
// chain a): two offered levels — `balanced` stays hidden until the risk-rule table offers it
// (R-167's clause) — the effective level's source line (A-407), `auto` disabled with the typed
// reason text where R-169/R-156 or the ceiling would refuse, the locked-cap reason's door to
// the repo's budget field (U-370), and the clear-layer affordance.
// The control speaks for the user like every screen (the api names the actor), so A-403's
// `user_only` can only ever arrive as a failure line, never as a disabled control here.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { InlineLink, Prose } from './inline-link';

/** The read the control renders (A-407): the effective level with its source, the layer's own
 *  standing, and the typed refusal that would answer an `auto` pick — absent when the level is
 *  already `auto` or nothing refuses it. */
export interface AutonomyControlView {
  readonly level: 'manual' | 'balanced' | 'auto';
  readonly source: string;
  readonly layerSet: boolean;
  readonly autoUnavailable?: string;
}

/** The source word of the chain (A-407): one label key per `AutonomySource | 'ceiling'`. */
export const autonomySourceKey = (source: string): LabelKey =>
  `autonomy.source.${source}` as LabelKey;

/** The disabled-reason line's own copy (outside `error.*` so L-13's problem-text walk does not
 *  read the explanation of why `auto` is disabled as a problem text). */
export const autonomyRefusalKey = (code: string): LabelKey =>
  `autonomy.autoDisabledReason.${code}` as LabelKey;

/** Why the effective level is manual, in the user's words: the refusal that keeps `auto` out of
 *  reach when there is one, else the untouched built-in default. A chosen manual or any other
 *  level needs no explanation — the source line already says where it came from. */
export const autonomyWhyKey = (view: AutonomyControlView): LabelKey | null => {
  if (view.level !== 'manual') return null;
  switch (view.autoUnavailable) {
    case 'auto_requires_spend_cap':
    case 'auto_requires_max_attempts':
    case 'above_ceiling':
      return `autonomy.why.${view.autoUnavailable}` as LabelKey;
    default:
      return view.autoUnavailable === undefined && view.source === 'builtin' ? 'autonomy.why.default' : null;
  }
};

/** Radios drawn by hand: the platform's disabled radio is a grey disc in the dark theme, which
 *  reads as selected. Selected = signal ring with a solid dot; disabled = dashed hollow ring,
 *  never a fill — the two never share a look in either theme. */
const RADIO_CLASS =
  "grid h-4 w-4 flex-none appearance-none place-content-center rounded-full border-2 border-bord bg-transparent before:h-2 before:w-2 before:scale-0 before:rounded-full before:bg-signal before:content-[''] checked:border-signal checked:before:scale-100 disabled:border-dashed disabled:border-hairline disabled:opacity-60 disabled:checked:before:scale-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export interface AutonomyControlProps {
  readonly locale: Locale;
  /** Null keeps the whole section quiet: an unreadable chain is its own typed read's surface,
   *  never a wrong level on a screen. */
  readonly view: AutonomyControlView | null;
  /** Marks the control for the e2e walk; the two surfaces carry their own (detail, repo). */
  readonly mark: string;
  readonly onPick: (level: 'manual' | 'auto') => void;
  readonly onClear: () => void;
  /** The locked spend-cap reason's door (U-370): opens Ayarlar → Depo ayarları at the cap field.
   *  Surfaces already inside the settings panel pass nothing — the door would lead where the
   *  operator already stands. */
  readonly onOpenRepoSettings?: () => void;
}

export function AutonomyControl({ locale, view, mark, onPick, onClear, onOpenRepoSettings }: AutonomyControlProps) {
  if (view === null) return null;
  const label = t(locale, 'autonomy.title');
  // `auto` is disabled exactly where picking it would answer the typed refusal (U-334); a level
  // that already is `auto` stays selected whatever a later cap removal would say.
  const whyKey = autonomyWhyKey(view);
  const autoBlocked = view.level !== 'auto' && view.autoUnavailable !== undefined;
  // The cap reason is the only one with a known place to go (U-370): the repo's budget field.
  // The retry-bound reason names its own fix in words — no route opens a stage definition — and
  // the ceiling is a policy, not a missing field, so neither draws a door. The subscription
  // line rides the reason itself, not the door: it explains the cap wherever the reason shows.
  const capWhy = whyKey === 'autonomy.why.auto_requires_spend_cap';
  // One reason line: the why line already names the refusal, so the refusal line shows only
  // where no why line does, and the radio's description follows whichever one is on screen.
  const refusalShown = autoBlocked && whyKey === null;
  const describedBy = whyKey !== null ? `autonomy-${mark}-why` : `autonomy-${mark}-refusal`;
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
          <input type="radio" className={RADIO_CLASS} name={`autonomy-${mark}`} checked={view.level === 'manual'} onChange={() => onPick('manual')} />
          <span className="text-[13px] text-ink">{t(locale, 'autonomy.level.manual')}</span>
        </label>
        <label className={`flex items-center gap-2 rounded-control px-2 py-1.5 ${autoBlocked ? '' : 'hover:bg-raised'}`}>
          <input
            type="radio"
            className={RADIO_CLASS}
            name={`autonomy-${mark}`}
            checked={view.level === 'auto'}
            disabled={autoBlocked}
            aria-describedby={autoBlocked ? describedBy : undefined}
            onChange={() => onPick('auto')}
          />
          <span className={`text-[13px] ${autoBlocked ? 'text-inkdim' : 'text-ink'}`}>{t(locale, 'autonomy.level.auto')}</span>
        </label>
      </div>
      {refusalShown && view.autoUnavailable !== undefined ? (
        <p id={`autonomy-${mark}-refusal`} data-autonomy-refusal className="m-0 mt-2 text-[12px] text-inkdim">
          {t(locale, autonomyRefusalKey(view.autoUnavailable))}
        </p>
      ) : null}
      {whyKey !== null ? (
        <p id={`autonomy-${mark}-why`} data-autonomy-why className="m-0 mt-2 text-[12px] text-inkdim">
          {t(locale, whyKey)}
        </p>
      ) : null}
      {/* The door sits under the why line as the house's tertiary tier — an InlineLink in its own
          running text (U-216…U-222), never a raw text button. It opens an in-app panel, so the
          anchor carries no href; the link component's own key model activates it. */}
      {capWhy && onOpenRepoSettings !== undefined ? (
        <Prose className="m-0 mt-1 text-[12px]" marker={['data-autonomy-open-repo-settings', '']}>
          <InlineLink onClick={onOpenRepoSettings}>{t(locale, 'autonomy.openRepoSettings')}</InlineLink>
        </Prose>
      ) : null}
      {capWhy ? (
        <p data-autonomy-cap-note className="m-0 mt-1 text-[12px] text-inkdim">
          {t(locale, 'autonomy.spendCapSubscriptionNote')}
        </p>
      ) : null}
      <p data-autonomy-auto-help className="m-0 mt-2 text-[12px] text-inkdim">
        {t(locale, 'autonomy.autoHelp')}
      </p>
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
