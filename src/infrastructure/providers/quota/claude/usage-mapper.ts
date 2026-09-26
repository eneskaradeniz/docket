// Mapper for the SDK's get_usage payload onto meter readings. Contract: docs/v2/quota.md →
// provider notes (Claude Code row: account pool with 5h + 7d, plus per-model-family 7d) and the
// scale pitfall; rule P-21 in docs/v2/providers.md → "Quota probes". Pure on purpose: the probe
// hands it the payload and the observation time; everything here is derivation.
import type { EpochMs, ModelMatcher, PoolKind } from '../../../../domain/index';
import type { MeterReading } from '../../../../application/index';

/** Claude plan windows are subscription usage allowances — a shared quota to spend. */
const POOL_KIND: PoolKind = 'allowance';

// The pitfall: polled get_usage utilization is 0–100 while the pushed rate_limit_event reports
// 0–1. Both mappings must land on the same meter scale, so the percent is divided by 100 exactly
// once per fraction — never derived from 1 − used.
const PERCENT_SCALE = 100;

// No subscription type in the payload (API-key and other non-plan sessions): the account pool
// still needs a stable label for the poll to reconcile into.
const ACCOUNT_FALLBACK_LABEL = 'account';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The windows of the account pool, in payload key order. */
const ACCOUNT_WINDOWS: readonly string[] = ['five_hour', 'seven_day'];

/** The per-model-family weekly windows and the model family each one scopes its pool to. */
const FAMILY_WINDOWS: readonly { readonly key: string; readonly matcher: ModelMatcher }[] = [
  { key: 'seven_day_opus', matcher: { prefix: 'claude-opus' } },
  { key: 'seven_day_sonnet', matcher: { prefix: 'claude-sonnet' } },
];

/** One rate_limits window entry, or undefined when it is absent, null, or carries nothing the
 * meter can state — a utilization that is not a number together with an unparseable reset. */
const windowOf = (
  value: unknown,
): { readonly utilization?: number; readonly resetsAt?: EpochMs } | undefined => {
  if (!isRecord(value)) return undefined;
  const rawUtilization = value['utilization'];
  const utilization =
    typeof rawUtilization === 'number' && Number.isFinite(rawUtilization) ? rawUtilization : undefined;
  const parsedReset = typeof value['resets_at'] === 'string' ? Date.parse(value['resets_at']) : Number.NaN;
  const resetsAt = Number.isNaN(parsedReset) ? undefined : parsedReset;
  if (utilization === undefined && resetsAt === undefined) return undefined;
  return { utilization, resetsAt };
};

const meterOf = (
  label: string,
  window: { readonly utilization?: number; readonly resetsAt?: EpochMs },
  observedAt: EpochMs,
): MeterReading['meter'] => ({
  label,
  // The pushed rate_limit_event mapping files these same windows under 'fixed'; the polled view
  // must not rename the cadence of the same window.
  cadence: 'fixed',
  unit: 'fraction',
  ...(window.utilization === undefined
    ? {}
    : {
        used: window.utilization / PERCENT_SCALE,
        limit: 1,
        remaining: (PERCENT_SCALE - window.utilization) / PERCENT_SCALE,
      }),
  ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
  resetPrecision: window.resetsAt === undefined ? 'unknown' : 'exact',
  observedAt,
  source: 'polled',
  // durationMs stays unset: the payload names the windows but never states a duration, and a
  // duration may only ever come from a value the provider itself states.
});

/**
 * Parses the get_usage payload into readings. Returns null when the payload carries no usable
 * window at all — plan limits that do not apply (rate_limits null), an unreadable payload, or
 * only empty windows — so the caller reports a failed probe instead of persisting nothing.
 */
export function mapClaudeGetUsage(payload: unknown, observedAt: EpochMs): readonly MeterReading[] | null {
  if (!isRecord(payload)) return null;
  const rateLimits = payload['rate_limits'];
  if (!isRecord(rateLimits)) return null;
  const subscription = payload['subscription_type'];
  const accountPool = {
    label: typeof subscription === 'string' && subscription !== '' ? subscription : ACCOUNT_FALLBACK_LABEL,
    kind: POOL_KIND,
    appliesTo: 'all' as const,
  };

  const readings: MeterReading[] = [];
  for (const key of ACCOUNT_WINDOWS) {
    const window = windowOf(rateLimits[key]);
    if (window === undefined) continue;
    readings.push({ pool: accountPool, meter: meterOf(key, window, observedAt) });
  }
  for (const family of FAMILY_WINDOWS) {
    const window = windowOf(rateLimits[family.key]);
    if (window === undefined) continue;
    readings.push({
      pool: { label: family.key, kind: POOL_KIND, appliesTo: [family.matcher] },
      meter: meterOf('seven_day', window, observedAt),
    });
  }
  return readings.length === 0 ? null : readings;
}
