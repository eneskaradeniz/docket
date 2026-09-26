// In-memory IdGen — deterministic, strictly increasing ULIDs from a seed.
import { isUlid, type Ulid } from '../../../domain/index';

import type { IdGen } from '../id-gen';

// Crockford base32: the alphabet the domain's ULID pattern accepts (no I, L, O, U).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LENGTH = 26;
// 26 chars × 5 bits; the low 64 bits hold the counter, the high bits carry the seed.
const COUNTER_BITS = 64n;

/** FNV-1a over the seed's UTF-16 units — deterministic without a hash package. */
const seedHash = (seed: string): bigint => {
  let hash = 0xcbf29ce4n;
  for (let i = 0; i < seed.length; i++) {
    hash ^= BigInt(seed.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffn;
  }
  return hash;
};

const decodeBase32 = (ulid: string): bigint => {
  let value = 0n;
  for (const char of ulid) value = (value << 5n) | BigInt(CROCKFORD.indexOf(char));
  return value;
};

const encodeBase32 = (value: bigint): string => {
  let chars = '';
  let rest = value;
  for (let i = 0; i < ULID_LENGTH; i++) {
    chars = CROCKFORD[Number(rest & 31n)] + chars;
    rest >>= 5n;
  }
  if (rest !== 0n) throw new Error('fake id generator: seeded at the top of the ULID space');
  return chars;
};

export type FakeIdGen = IdGen;

/**
 * `seed` decides the sequence: a valid ULID is handed out unchanged as the first id (the sequence
 * continues upward from it); any other string is hashed into the id's high bits. The same seed
 * always yields the same sequence, and consecutive ids always compare greater as strings.
 */
export const createFakeIdGen = (seed: string = 'docket-fake'): FakeIdGen => {
  let nextValue = isUlid(seed) ? decodeBase32(seed) : seedHash(seed) << COUNTER_BITS;
  return {
    next: <B extends string>(): Ulid<B> => {
      const current = nextValue;
      nextValue = current + 1n;
      return encodeBase32(current) as Ulid<B>;
    },
  };
};
