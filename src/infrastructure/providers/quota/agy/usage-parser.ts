// Parser for the agy `/usage` print-mode payload. Contract: docs/v2/quota.md →
// "Observed: Antigravity /usage"; rule P-19 in docs/v2/providers.md → "Quota probes".
// Pure on purpose: the probe hands it both streams and the observation time; everything here is
// derivation from the payload text. Mapping: group → pool (label = name, model matchers only
// from the description's model list, verbatim), bucket → meter (unit 'fraction', remaining,
// resetsAt, resetPrecision 'exact', source 'polled').
import type { EpochMs, PoolKind } from '../../../../domain/index';
import type { MeterReading } from '../../../../application/index';

/** Description prefix that carries a pool's model list; matchers exist only when it is present. */
const MODEL_LIST_PREFIX = 'Models within this group:';

/** agy groups are subscription usage allowances — a shared quota to spend, not a balance or cap. */
const POOL_KIND: PoolKind = 'allowance';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Extracts every balanced top-level JSON object embedded in the text. The payload may arrive
 * surrounded by progress noise, so whole-text JSON.parse is not enough: the scan tracks string
 * state and brace depth, and skips anything that does not parse.
 */
const scanJsonObjects = (text: string): readonly unknown[] => {
  const objects: unknown[] = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('{', index);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break; // unbalanced: no complete object remains
    const candidate = text.slice(start, end + 1);
    try {
      objects.push(JSON.parse(candidate) as unknown);
    } catch {
      // Not JSON after all — keep scanning past it.
    }
    index = end + 1;
  }
  return objects;
};

/** The groups array of the first usage command result in the text, or undefined. */
const findUsageGroups = (text: string): readonly unknown[] | undefined => {
  for (const object of scanJsonObjects(text)) {
    if (!isRecord(object)) continue;
    const command = object['command'];
    if (!isRecord(command) || command['name'] !== 'usage') continue;
    // The tab-separated `response` rendering of the same data is ignored on purpose.
    const data = command['data'];
    if (!isRecord(data)) continue;
    const groups = data['groups'];
    if (Array.isArray(groups)) return groups;
  }
  return undefined;
};

/**
 * Model matchers exist only as the verbatim items of the description's model list — never from
 * the group name or a bucket id. Without a usable list the pool applies to everything: an
 * unattributed pool that blocks too much is the safer failure than one that never blocks.
 */
const appliesToOf = (description: unknown): readonly { readonly exact: string }[] | 'all' => {
  if (typeof description !== 'string') return 'all';
  const marker = description.indexOf(MODEL_LIST_PREFIX);
  if (marker < 0) return 'all';
  const items = description
    .slice(marker + MODEL_LIST_PREFIX.length)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length === 0 ? 'all' : items.map((item) => ({ exact: item }));
};

const toMeter = (bucket: Record<string, unknown>, observedAt: EpochMs): MeterReading['meter'] | undefined => {
  const label = bucket['name'];
  if (typeof label !== 'string' || label === '') return undefined;
  const remaining = bucket['remaining_fraction'];
  if (typeof remaining !== 'number') return undefined;
  const resetTime = bucket['reset_time'];
  const resetsAt = typeof resetTime === 'string' ? Date.parse(resetTime) : Number.NaN;
  return {
    label,
    // Rolling windows anchored at first use with an exact reset timestamp; nothing downstream
    // branches on this yet, so it stays plain data describing the observed window family.
    cadence: 'rolling_from_first_use',
    unit: 'fraction',
    remaining,
    ...(Number.isNaN(resetsAt) ? {} : { resetsAt }),
    resetPrecision: 'exact',
    observedAt,
    source: 'polled',
    // durationMs stays unset: `window` ('weekly', '5h') is a label, not a duration the CLI
    // asserts. It may only ever be set from a duration field the payload itself states.
  };
};

/**
 * Parses the usage payload from both output streams — the observed probe run printed it on
 * stderr. Returns null when neither stream carries a usable payload (the caller reports a failed
 * probe; an empty groups list carries nothing to persist and counts as unusable).
 */
export function parseAgyUsage(stdout: string, stderr: string, observedAt: EpochMs): readonly MeterReading[] | null {
  const groups = findUsageGroups(stdout) ?? findUsageGroups(stderr);
  if (groups === undefined) return null;

  const readings: MeterReading[] = [];
  for (const group of groups) {
    if (!isRecord(group)) continue;
    const label = group['name'];
    const buckets = group['buckets'];
    if (typeof label !== 'string' || label === '' || !Array.isArray(buckets)) continue;
    const pool = { label, kind: POOL_KIND, appliesTo: appliesToOf(group['description']) };
    for (const bucket of buckets) {
      if (!isRecord(bucket)) continue;
      const meter = toMeter(bucket, observedAt);
      if (meter !== undefined) readings.push({ pool, meter });
    }
  }
  return readings.length === 0 ? null : readings;
}
