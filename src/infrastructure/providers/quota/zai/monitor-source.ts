// z.ai monitor quota source — one account's quota on a compatible endpoint, read from the
// provider's monitor API. Contract: docs/v2/provider-capabilities.md §8 (P-34) and the z.ai row
// of docs/v2/quota.md. The endpoint is observed behaviour of the operator's own tooling, not a
// published contract; it can change. The token reaches only the Authorization header — never a
// reading, a note or an error. Fetch and the clock are injected; a successful read is cached for
// one window, and a failed refresh hands back the last good readings marked stale (staleAfterMs 0)
// instead of throwing, so a monitor hiccup reads as quota unknown and never blocks a run.
import type { EpochMs, Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import type { MeterReading, QuotaProbeError } from '../../../../application/index';

const MONITOR_PATH = '/api/monitor/usage/quota/limit';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_MS = 60_000;
const MS_PER_HOUR = 3_600_000;

/** The narrow fetch surface the source needs; the real global fetch satisfies it directly. */
export type MonitorFetch = typeof globalThis.fetch;
export type MonitorSecrets = { get(ref: string): Promise<string | undefined> };
/** Diagnostic sink for ignored limits; a count only, never the token. Default: silent. */
export type MonitorNote = (message: string) => void;

export interface ZaiMonitorSourceDeps {
  readonly fetch: MonitorFetch;
  /** Observation time stamped onto every reading and judged for cache freshness; injected. */
  readonly now: () => EpochMs;
  /** The account's endpoint URL; the monitor URL is built from its origin. */
  readonly endpoint: string;
  /** Key into the secrets port; the token behind it is never stored or logged. */
  readonly secretRef: string;
  readonly secrets: MonitorSecrets;
  readonly note?: MonitorNote;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
}

export interface ZaiMonitorSource {
  read(): Promise<Result<readonly MeterReading[], QuotaProbeError>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

interface ParsedMonitor {
  readonly readings: readonly MeterReading[];
  readonly ignored: number;
}

/**
 * Maps `data.limits[]` to readings: TOKENS_LIMIT with unit 3 and number 5 is the five-hour token
 * window, TIME_LIMIT with unit 5 the monthly tool window; both carry a used percentage and an
 * exact reset. Every other row — unknown type, foreign unit or number, missing numbers — is
 * ignored and counted for the diagnostic note.
 */
const parseMonitor = (payload: unknown, observedAt: EpochMs): ParsedMonitor | null => {
  if (!isRecord(payload)) return null;
  const data = payload['data'];
  if (!isRecord(data)) return null;
  const limits = data['limits'];
  if (!Array.isArray(limits)) return null;

  const readings: MeterReading[] = [];
  let ignored = 0;
  for (const entry of limits) {
    if (!isRecord(entry)) {
      ignored += 1;
      continue;
    }
    const percentage = entry['percentage'];
    const nextResetTime = entry['nextResetTime'];
    if (typeof percentage !== 'number' || typeof nextResetTime !== 'number') {
      ignored += 1;
      continue;
    }
    const isFiveHour = entry['type'] === 'TOKENS_LIMIT' && entry['unit'] === 3 && entry['number'] === 5;
    const isMonthly = entry['type'] === 'TIME_LIMIT' && entry['unit'] === 5;
    if (!isFiveHour && !isMonthly) {
      ignored += 1;
      continue;
    }
    const number = entry['number'];
    readings.push({
      pool: { label: 'GLM Coding', kind: 'allowance', appliesTo: [{ prefix: 'glm-' }] },
      meter: {
        label: isFiveHour ? '5-hour token window' : 'monthly tool window',
        cadence: isFiveHour ? 'rolling_from_first_use' : 'calendar',
        // The five-hour window's length is the endpoint's own number (5) in hours (unit 3); the
        // monthly window states no length, so it gets none.
        ...(isFiveHour && typeof number === 'number' ? { durationMs: number * MS_PER_HOUR } : {}),
        unit: 'percent',
        remaining: 100 - percentage,
        resetsAt: nextResetTime,
        resetPrecision: 'exact',
        observedAt,
        source: 'polled',
      },
    });
  }
  return { readings, ignored };
};

export function createZaiMonitorSource(deps: ZaiMonitorSourceDeps): ZaiMonitorSource {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheMs = deps.cacheMs ?? DEFAULT_CACHE_MS;
  const note: MonitorNote = deps.note ?? (() => {});
  let cached: { readonly at: EpochMs; readonly readings: readonly MeterReading[] } | undefined;

  // The mark the failure path puts on the last good readings: stale the moment they are returned,
  // so headroom reads quota unknown instead of trusting numbers the refresh could not confirm.
  const staleMarked = (readings: readonly MeterReading[]): readonly MeterReading[] =>
    readings.map((reading) => ({ ...reading, meter: { ...reading.meter, staleAfterMs: 0 } }));

  return {
    read: async (): Promise<Result<readonly MeterReading[], QuotaProbeError>> => {
      const now = deps.now();
      if (cached !== undefined && now - cached.at < cacheMs) return ok(cached.readings);

      const fail = (code: QuotaProbeError): Result<readonly MeterReading[], QuotaProbeError> =>
        cached === undefined ? err(code) : ok(staleMarked(cached.readings));

      // The endpoint host comes from the account's own endpoint; a broken URL is a failed probe,
      // not a crash into the caller.
      let url: string;
      try {
        url = new URL(MONITOR_PATH, new URL(deps.endpoint).origin).toString();
      } catch {
        return fail('probe_failed');
      }

      const token = await deps.secrets.get(deps.secretRef);
      if (token === undefined) return fail('not_logged_in');

      let response: Response;
      try {
        // The raw token rides Authorization with no scheme prefix (observed behaviour), and a
        // redirect is refused: following one could hand the header to a different origin.
        response = await deps.fetch(url, {
          method: 'GET',
          headers: { Authorization: token },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return fail('probe_failed');
      }
      if (!response.ok) {
        return fail(response.status === 401 || response.status === 403 ? 'not_logged_in' : 'probe_failed');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return fail('probe_failed');
      }
      const parsed = parseMonitor(payload, now);
      // A body without a single usable window is a failed probe: persisting nothing would silently
      // clear the account's meters.
      if (parsed === null || parsed.readings.length === 0) return fail('probe_failed');
      if (parsed.ignored > 0) note(`ignored ${parsed.ignored} unrecognized quota limit(s) from the monitor response`);
      cached = { at: now, readings: parsed.readings };
      return ok(parsed.readings);
    },
  };
}
