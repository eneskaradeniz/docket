// storage/bundle/canonical-json.ts — RFC 8785 JSON Canonicalization Scheme (JCS) serializer (I-98).
import { createHash } from 'node:crypto';

/**
 * Serializes a JavaScript value into canonical JSON per RFC 8785:
 * - UTF-8 output (standard ECMAScript string representing UTF-8 text)
 * - Object members sorted lexicographically by key in UTF-16 code-unit order
 * - No insignificant whitespace
 * - Numbers serialized according to ECMAScript Number.prototype.toString (-0 serialized as 0)
 * - Strings serialized with minimal JSON escaping
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`RFC 8785 requires finite numbers; got ${value}`);
    }
    return Object.is(value, -0) || value === 0 ? '0' : JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? 'null'
        : canonicalize(item),
    );
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter(
      (k) =>
        record[k] !== undefined &&
        typeof record[k] !== 'function' &&
        typeof record[k] !== 'symbol',
    );
    keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`RFC 8785 unsupported type: ${typeof value}`);
}

/**
 * Computes the SHA-256 checksum over the canonical JSON of everything in the bundle except `checksum`.
 */
export function computeBundleChecksum(bundle: Record<string, unknown>): string {
  const withoutChecksum: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(bundle)) {
    if (key !== 'checksum') {
      withoutChecksum[key] = val;
    }
  }
  const canonical = canonicalize(withoutChecksum);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
