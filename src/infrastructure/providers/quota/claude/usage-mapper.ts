// Mapper for the SDK's get_usage payload onto meter readings. Contract: docs/v2/quota.md →
// provider notes (Claude Code row: account pool with 5h + 7d, per-model-family 7d, the
// model-scoped buckets and the extra-usage credits) and the scale pitfall; rule P-21 in
// docs/v2/providers.md → "Quota probes"; P-39 in docs/v2/provider-capabilities.md §13 (dynamic
// meters — a bucket the table does not know is informational, never blocking). Pure on
// purpose: the probe hands it the payload and the observation time; everything here is
// derivation. Diagnostic notes name field names and counts, never values.
import type { EpochMs, ModelMatcher, PoolKind } from '../../../../domain/index';
import type { MeterReading } from '../../../../application/index';

import { matchersForBucket } from './bucket-table';

/** Claude plan windows are subscription usage allowances — a shared quota to spend. */
const POOL_KIND: PoolKind = 'allowance';

/** Usage credits are a prepaid balance the extra-usage models draw down. */
const CREDITS_POOL_KIND: PoolKind = 'balance';

// The pitfall: polled get_usage utilization is 0–100 while the pushed rate_limit_event reports
// 0–1. Both mappings must land on the same meter scale, so the percent is divided by 100 exactly
// once per fraction — never derived from 1 − used.
const PERCENT_SCALE = 100;

// No subscription type in the payload (API-key and other non-plan sessions): the account pool
// still needs a stable label for the poll to reconcile into.
const ACCOUNT_FALLBACK_LABEL = 'account';

/** The windows of the account pool, in payload key order. */
const ACCOUNT_WINDOWS: readonly string[] = ['five_hour', 'seven_day'];

/** The per-model-family weekly windows and the model family each one scopes its pool to. */
const FAMILY_WINDOWS: readonly { readonly key: string; readonly matcher: ModelMatcher }[] = [
  { key: 'seven_day_opus', matcher: { prefix: 'claude-opus' } },
  { key: 'seven_day_sonnet', matcher: { prefix: 'claude-sonnet' } },
];

/** The SDK documents every model_scoped entry as a per-model weekly window, so its meter takes
 * the label the weekly family windows already use. */
const MODEL_SCOPED_WINDOW_LABEL = 'seven_day';

/** The extra-usage section's own field names: monthly_limit names the window, extra_usage the
 * section — both stable pool/meter labels for the poll to reconcile into. */
const EXTRA_USAGE_LABELS = { pool: 'extra_usage', meter: 'monthly' } as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

/** Every model_scoped entry that can be labelled becomes its own pool: the display name
 * verbatim as the label, applicability from the bucket table. An entry without a display name
 * or without any stateable window is ignored and counted for the note — its bucket cannot be
 * named, so no pool can be shown for it. */
const modelScopedReadings = (
  value: unknown,
  observedAt: EpochMs,
  notes: string[],
): readonly MeterReading[] => {
  if (!Array.isArray(value)) return [];
  const readings: MeterReading[] = [];
  let ignored = 0;
  for (const entry of value) {
    const displayName = isRecord(entry) ? entry['display_name'] : undefined;
    const window = windowOf(entry);
    if (typeof displayName !== 'string' || displayName === '' || window === undefined) {
      ignored += 1;
      continue;
    }
    readings.push({
      pool: { label: displayName, kind: POOL_KIND, appliesTo: matchersForBucket(displayName) },
      meter: meterOf(MODEL_SCOPED_WINDOW_LABEL, window, observedAt),
    });
  }
  if (ignored > 0) notes.push(`ignored ${ignored} unreadable model_scoped entries`);
  return readings;
};

/** The extra-usage credits section: enabled becomes a balance pool in the provider's own credit
 * unit; disabled creates no pool and says so in a note (an organisation-level disable reads the
 * same as the user's own choice — the note states the fact, never the reason, which the payload
 * does not carry). */
const extraUsageReading = (
  value: unknown,
  observedAt: EpochMs,
  notes: string[],
): readonly MeterReading[] => {
  if (!isRecord(value)) return [];
  if (value['is_enabled'] !== true) {
    notes.push(`${EXTRA_USAGE_LABELS.pool} disabled: no credits pool`);
    return [];
  }
  const creditOf = (raw: unknown): number | undefined =>
    typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  const limit = creditOf(value['monthly_limit']);
  const used = creditOf(value['used_credits']);
  return [
    {
      pool: {
        label: EXTRA_USAGE_LABELS.pool,
        kind: CREDITS_POOL_KIND,
        // Which models draw from the credits is plan-dependent and not in the payload, so the
        // pool is informational: 'unknown' keeps it out of headroom (P-39); spend consent and
        // caps are the billing rules' business, not the quota meter's.
        appliesTo: 'unknown',
      },
      meter: {
        label: EXTRA_USAGE_LABELS.meter,
        cadence: 'calendar',
        unit: 'credits',
        ...(used === undefined ? {} : { used }),
        ...(limit === undefined ? {} : { limit }),
        ...(used !== undefined && limit !== undefined ? { remaining: limit - used } : {}),
        resetPrecision: 'unknown',
        observedAt,
        source: 'polled',
        // durationMs and resetsAt stay unset: the section states a monthly limit but never a
        // reset time, and neither may be derived from the window's name.
      },
    },
  ];
};

/** What the mapper hands the probe: readings plus diagnostic notes, or the field names that
 * stayed unreadable — the names only, never the values behind them. */
export type ClaudeUsageMapping =
  | { readonly ok: true; readonly readings: readonly MeterReading[]; readonly notes: readonly string[] }
  | { readonly ok: false; readonly unrecognized: readonly string[] };

/**
 * Parses the get_usage payload into readings. Fails (ok: false) when the payload carries no
 * usable window at all — plan limits that do not apply (rate_limits null), an unreadable
 * payload, or only empty windows — so the caller reports a failed probe instead of persisting
 * nothing; `unrecognized` names the fields the payload carried where reading failed.
 */
export function mapClaudeGetUsage(payload: unknown, observedAt: EpochMs): ClaudeUsageMapping {
  if (!isRecord(payload)) return { ok: false, unrecognized: [] };
  const rateLimits = payload['rate_limits'];
  // rate_limits null is the SDK's own "plan limits do not apply" answer: recognized, so the
  // failure names no fields. Anything else that is not a record is an unrecognized shape.
  if (rateLimits === null) return { ok: false, unrecognized: [] };
  if (!isRecord(rateLimits)) return { ok: false, unrecognized: Object.keys(payload) };
  const subscription = payload['subscription_type'];
  const accountPool = {
    label: typeof subscription === 'string' && subscription !== '' ? subscription : ACCOUNT_FALLBACK_LABEL,
    kind: POOL_KIND,
    appliesTo: 'all' as const,
  };

  const notes: string[] = [];
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
  readings.push(...modelScopedReadings(rateLimits['model_scoped'], observedAt, notes));
  readings.push(...extraUsageReading(rateLimits['extra_usage'], observedAt, notes));
  if (readings.length === 0) return { ok: false, unrecognized: Object.keys(rateLimits) };
  return { ok: true, readings, notes };
}
