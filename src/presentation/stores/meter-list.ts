// stores/meter-list.ts — what a MeterList shows (U-44) as pure data: one row per meter with the
// provider's own window name, a scope tag when the account has a model-scoped pool, the bar's
// reading (remaining from the left, amber under 40 %, the U-31 reserve zone), the unit fraction
// ("120 / 300") for counted units, and the single note that names a model-scoped pool's model.
// The same rows serve the wizard's Bütçe step (a candidate's preview), Settings and the account
// editor's Kullanım tab.
import type { SettingsMeterView, SettingsPoolView } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { meterBar } from './account-editor';
import { hasModelScopedPool, isModelScoped } from './pool-scope';
import { remainingText } from './reset-line';

/** Remaining below this share paints the bar amber. */
export const LOW_REMAINING = 0.4;

export type MeterScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'model'; readonly model: string };

export type MeterName = { readonly key: LabelKey } | { readonly text: string };

export interface MeterRow {
  readonly id: string;
  readonly name: MeterName;
  readonly scope: MeterScope | null;
  /** Remaining, 0..1; null when the meter cannot say. */
  readonly remaining: number | null;
  readonly low: boolean;
  readonly zone: number | null;
  readonly reached: boolean;
  /** "used / limit" for a counted unit; null for shares and money. */
  readonly fraction: string | null;
  readonly resetsAt: number | null;
}

export interface MeterListView {
  readonly rows: readonly MeterRow[];
  /** The model the one note names, or null when the account has no model-scoped pool. */
  readonly modelNote: string | null;
}

/** The provider's window codes this build names in words; any other label is shown verbatim. */
const WINDOW_NAME: Readonly<Record<string, LabelKey>> = {
  five_hour: 'meterList.window.five_hour',
  seven_day: 'meterList.window.seven_day',
  monthly: 'meterList.window.monthly',
};

const SHARE_UNITS: ReadonlySet<string> = new Set(['percent', 'fraction', 'usd']);

const countText = (meter: SettingsMeterView): string | null => {
  if (SHARE_UNITS.has(meter.unit) || meter.limit === null || meter.limit <= 0) return null;
  const used = meter.used ?? (meter.remaining === null ? null : meter.limit - meter.remaining);
  return used === null ? null : `${Math.round(used)} / ${Math.round(meter.limit)}`;
};

/** The meter's name: its provider label (a known window code in words), else its pool's label. */
export const meterName = (meter: SettingsMeterView, pool: SettingsPoolView | undefined): MeterName => {
  const raw = meter.label ?? pool?.label ?? meter.poolId;
  const key = WINDOW_NAME[raw];
  return key === undefined ? { text: raw } : { key };
};

/** One account's (or candidate's) meters as list rows, in the order the api reported them. */
export const meterListView = (pools: readonly SettingsPoolView[], meters: readonly SettingsMeterView[]): MeterListView => {
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const scoped = pools.filter(isModelScoped);
  const rows = meters.map((meter): MeterRow => {
    const pool = poolById.get(meter.poolId);
    const bar = meterBar(meter);
    const scope: MeterScope | null =
      pool === undefined || scoped.length === 0
        ? null
        : isModelScoped(pool)
          ? { kind: 'model', model: pool.label }
          : pool.appliesTo === 'all'
            ? { kind: 'all' }
            : null;
    return {
      id: meter.id,
      name: meterName(meter, pool),
      scope,
      remaining: bar.fill,
      low: bar.fill !== null && bar.fill < LOW_REMAINING,
      zone: bar.zone,
      reached: bar.reached,
      fraction: countText(meter),
      resetsAt: meter.resetsAt,
    };
  });
  return { rows, modelNote: scoped[0]?.label ?? null };
};

export { hasModelScopedPool };

export type MeterListEmpty = 'meterList.noMeter' | 'meterList.needsLogin' | 'meterList.afterAdd';

/** The one line shown in place of rows: while a candidate's quota loads or fails it says limits are
 *  read once the account is added; a provider that needs a login says so; else it reports no usage. */
export const meterListEmpty = (standing: { readonly loading: boolean; readonly failed: boolean; readonly needsLogin: boolean }): MeterListEmpty => {
  if (standing.needsLogin) return 'meterList.needsLogin';
  if (standing.loading || standing.failed) return 'meterList.afterAdd';
  return 'meterList.noMeter';
};

/** "<span> sonra sıfırlanır" for a window resetting at `resetsAt`, read at `now`; null without a reset. */
export const meterResetText = (locale: Locale, resetsAt: number | null, now: number): string | null =>
  resetsAt === null ? null : t(locale, 'meterList.resetsIn').replace('{t}', remainingText(locale, resetsAt - now));
