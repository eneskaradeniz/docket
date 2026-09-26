import { describe, expect, it } from 'vitest';
import { isSlug, isUlid, parseSlug, parseUlid, type RoleSlug, type WorkOrderId } from './ids';

const VALID_SLUGS: readonly string[] = [
  'a',
  'z',
  '0',
  '9',
  'abc',
  'a-b',
  'code-review',
  '0abc',
  'a1-b2',
  'a' + 'b'.repeat(62), // exactly 63 chars
  'a' + '-x'.repeat(31), // exactly 63 chars, hyphens inside
];

const INVALID_SLUGS: readonly { readonly input: string; readonly reason: string }[] = [
  { input: '', reason: 'empty string' },
  { input: '-', reason: 'lone hyphen is a leading hyphen' },
  { input: '-abc', reason: 'leading hyphen' },
  { input: '-' + 'a'.repeat(62), reason: 'leading hyphen at the 63-char boundary' },
  { input: 'A', reason: 'uppercase letter' },
  { input: 'aBC', reason: 'mixed-case letters' },
  { input: 'A1', reason: 'uppercase letter before a digit' },
  { input: 'a_b', reason: 'underscore' },
  { input: 'a b', reason: 'space' },
  { input: 'a.b', reason: 'dot' },
  { input: 'a/b', reason: 'slash' },
  { input: 'a:b', reason: 'colon' },
  { input: 'ça', reason: 'non-ascii letter' },
  { input: 'a\tb', reason: 'tab' },
  { input: 'a\nb', reason: 'newline' },
  { input: 'b'.repeat(64), reason: '64 chars, one past the length boundary' },
];

const VALID_ULIDS: readonly string[] = [
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  '7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
  '0123456789ABCDEFGHJKMNPTVW',
];

const INVALID_ULIDS: readonly { readonly input: string; readonly reason: string }[] = [
  { input: '', reason: 'empty string' },
  { input: '01ARZ3NDEKTSV4RRFFQ69G5FA', reason: '25 chars, one below the length boundary' },
  { input: '01ARZ3NDEKTSV4RRFFQ69G5FAVA', reason: '27 chars, one above the length boundary' },
  { input: '0IARZ3NDEKTSV4RRFFQ69G5FAV', reason: 'forbidden letter I' },
  { input: '0LARZ3NDEKTSV4RRFFQ69G5FAV', reason: 'forbidden letter L' },
  { input: '0OARZ3NDEKTSV4RRFFQ69G5FAV', reason: 'forbidden letter O' },
  { input: '0UARZ3NDEKTSV4RRFFQ69G5FAV', reason: 'forbidden letter U' },
  { input: '01arz3ndektsv4rrffq69g5fav', reason: 'all lowercase' },
  { input: '01ARZ3NDEKTSV4RRFFQ69G5FAv', reason: 'one lowercase char' },
  { input: '01ARZ3NDEKTSV4RRFFQ69G5FA-', reason: 'hyphen' },
  { input: '01ARZ3NDEKTSV4RRFFQ69G5FA ', reason: 'space' },
  { input: '01ARZ3NDEKTSV4RRFFQ69G5FA_', reason: 'underscore' },
];

describe('parseSlug', () => {
  it('R-1: accepts ^[a-z0-9][a-z0-9-]{0,62}$ only — lowercase alnum start, hyphens inside', () => {
    for (const input of VALID_SLUGS) {
      const result = parseSlug(input);
      if (!result.ok) {
        throw new Error(`expected ok for ${JSON.stringify(input)}, got ${JSON.stringify(result.error)}`);
      }
      expect(result.value).toBe(input);
    }
  });

  it('R-1: rejects every forbidden character class with code invalid_slug', () => {
    for (const { input, reason } of INVALID_SLUGS) {
      const result = parseSlug(input);
      if (result.ok) throw new Error(`expected err for ${reason} (${JSON.stringify(input)})`);
      expect(result.error.code).toBe('invalid_slug');
    }
  });

  it('R-1: accepts exactly 63 chars and rejects 64 — max length boundary', () => {
    expect(parseSlug('b'.repeat(63)).ok).toBe(true);
    expect(parseSlug('b'.repeat(64)).ok).toBe(false);
  });

  it('echoes the rejected input in the error', () => {
    const result = parseSlug('-abc');
    if (result.ok) throw new Error('fixture must be invalid');
    expect(result.error).toEqual({ code: 'invalid_slug', input: '-abc' });
  });

  it('brands the parsed value as the requested slug type', () => {
    const result = parseSlug<'role'>('code-review');
    if (!result.ok) throw new Error('fixture must be valid');
    const branded: RoleSlug = result.value;
    expect(branded).toBe('code-review');
  });
});

describe('parseUlid', () => {
  it('R-2: accepts exactly 26 chars of Crockford base32, uppercase', () => {
    for (const input of VALID_ULIDS) {
      const result = parseUlid(input);
      if (!result.ok) {
        throw new Error(`expected ok for ${JSON.stringify(input)}, got ${JSON.stringify(result.error)}`);
      }
      expect(result.value).toBe(input);
    }
  });

  it('R-2: rejects I, L, O, U with code invalid_ulid', () => {
    for (const forbidden of ['I', 'L', 'O', 'U']) {
      const input = '01ARZ3NDEKTSV4RRFFQ69G5FAV'.replace('1', forbidden);
      const result = parseUlid(input);
      if (result.ok) throw new Error(`expected err for forbidden letter ${forbidden}`);
      expect(result.error.code).toBe('invalid_ulid');
    }
  });

  it('R-2: rejects lowercase input', () => {
    for (const { input, reason } of INVALID_ULIDS) {
      if (!reason.includes('lowercase')) continue;
      const result = parseUlid(input);
      if (result.ok) throw new Error(`expected err for ${reason} (${JSON.stringify(input)})`);
      expect(result.error.code).toBe('invalid_ulid');
    }
  });

  it('R-2: rejects wrong lengths and every other forbidden character class', () => {
    for (const { input, reason } of INVALID_ULIDS) {
      if (reason.includes('lowercase') || reason.startsWith('forbidden letter')) continue;
      const result = parseUlid(input);
      if (result.ok) throw new Error(`expected err for ${reason} (${JSON.stringify(input)})`);
      expect(result.error.code).toBe('invalid_ulid');
    }
  });

  it('echoes the rejected input in the error', () => {
    const result = parseUlid('short');
    if (result.ok) throw new Error('fixture must be invalid');
    expect(result.error).toEqual({ code: 'invalid_ulid', input: 'short' });
  });

  it('brands the parsed value as the requested ulid type', () => {
    const result = parseUlid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    if (!result.ok) throw new Error('fixture must be valid');
    const branded: WorkOrderId = result.value;
    expect(branded).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });
});

describe('isSlug', () => {
  it('agrees with parseSlug on every valid and invalid input', () => {
    const inputs = [...VALID_SLUGS, ...INVALID_SLUGS.map((f) => f.input)];
    for (const input of inputs) {
      expect(isSlug(input)).toBe(parseSlug(input).ok);
    }
  });
});

describe('isUlid', () => {
  it('agrees with parseUlid on every valid and invalid input', () => {
    const inputs = [...VALID_ULIDS, ...INVALID_ULIDS.map((f) => f.input)];
    for (const input of inputs) {
      expect(isUlid(input)).toBe(parseUlid(input).ok);
    }
  });
});
