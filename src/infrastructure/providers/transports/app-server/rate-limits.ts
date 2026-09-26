// Mapping of the app-server account rate-limit payloads onto quota_signal meter readings.
// Contract: docs/v2/providers.md → "Codex app-server transport" (P-14) and the Codex row of
// docs/v2/quota.md: primary ≈5h / secondary ≈weekly, windows read from the server's own
// windowDurationMins, exact reset times.
import type { AgentEvent, EpochMs } from '../../../../domain/index';

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

/** How the reading reached Docket: Docket asked (`polled`, account/rateLimits/read) or the
 * provider pushed it during the run (`pushed`, account/rateLimits/updated). */
export type RateLimitSource = 'polled' | 'pushed';

type QuotaSignalEvent = Extract<AgentEvent, { readonly type: 'quota_signal' }>;

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const numberField = (holder: unknown, key: string): number | undefined => {
  if (!isRecord(holder)) return undefined;
  const value = holder[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const stringField = (holder: unknown, key: string): string | undefined => {
  if (!isRecord(holder)) return undefined;
  const value = holder[key];
  return typeof value === 'string' ? value : undefined;
};

/** One window → one meter reading. Every value comes from the server: the duration only from
 * windowDurationMins, the reset only from resetsAt (Unix seconds); nothing is derived from the
 * window's position or name, and absent values stay absent. */
function windowMeter(
  label: string,
  window: Readonly<Record<string, unknown>>,
  at: EpochMs,
  source: RateLimitSource,
): QuotaSignalEvent {
  const usedPercent = numberField(window, 'usedPercent');
  const windowDurationMins = numberField(window, 'windowDurationMins');
  const resetsAt = numberField(window, 'resetsAt');
  return {
    type: 'quota_signal',
    at,
    meter: {
      label,
      cadence: 'rolling_from_first_use', // the protocol documents these as rolling windows
      ...(windowDurationMins === undefined ? {} : { durationMs: windowDurationMins * MS_PER_MINUTE }),
      // The same 0–1 utilization scale every transport's meter readings share; both fractions
      // derive from the server's percent in one division each, never from 1 − used.
      unit: 'fraction',
      ...(usedPercent === undefined ? {} : { used: usedPercent / 100 }),
      ...(usedPercent === undefined ? {} : { limit: 1 }),
      ...(usedPercent === undefined ? {} : { remaining: (100 - usedPercent) / 100 }),
      ...(resetsAt === undefined ? {} : { resetsAt: resetsAt * MS_PER_SECOND }),
      resetPrecision: resetsAt === undefined ? 'unknown' : 'exact',
      observedAt: at,
      source,
    },
  };
}

/** A rate-limit snapshot (the rateLimits value of an account/rateLimits/read result or an
 * account/rateLimits/updated payload) → one quota_signal per mapped window. A snapshot without
 * usable windows yields no events, and an unreadable payload is never fatal — it just reads as
 * nothing. */
export function rateLimitEvents(
  snapshot: unknown,
  at: EpochMs,
  source: RateLimitSource,
): readonly AgentEvent[] {
  if (!isRecord(snapshot)) return [];
  const poolLabel = stringField(snapshot, 'limitName') ?? stringField(snapshot, 'limitId');
  const events: AgentEvent[] = [];
  for (const label of ['primary', 'secondary'] as const) {
    const window = snapshot[label];
    if (!isRecord(window)) continue;
    const event = windowMeter(label, window, at, source);
    events.push(
      poolLabel === undefined
        ? event
        : { ...event, meter: { ...event.meter, poolLabel } },
    );
  }
  return events;
}
