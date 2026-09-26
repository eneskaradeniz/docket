import { describe, expect, it } from 'vitest';

import { isUlid, parseUlid } from '../../../domain/index';

import { createFakeIdGen } from './fake-id-gen';

const SEED_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('createFakeIdGen', () => {
  it('A-3: yields valid ULIDs (26 chars, Crockford base32, uppercase)', () => {
    const ids = createFakeIdGen();
    for (let i = 0; i < 20; i++) {
      const id = ids.next<'run'>();
      expect(isUlid(id)).toBe(true);
      expect(parseUlid(id).ok).toBe(true);
    }
  });

  it('A-3: yields strictly increasing ULIDs', () => {
    const ids = createFakeIdGen();
    let previous = ids.next();
    for (let i = 0; i < 50; i++) {
      const current = ids.next();
      expect(current > previous).toBe(true);
      previous = current;
    }
  });

  it('A-3: is deterministic from a seed', () => {
    const a = createFakeIdGen('seed-a');
    const b = createFakeIdGen('seed-a');
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
  });

  it('A-3: different seeds produce different first ids', () => {
    expect(createFakeIdGen('seed-a').next()).not.toBe(createFakeIdGen('seed-b').next());
  });

  it('A-3: a ULID seed is the first id handed out and the sequence continues upward from it', () => {
    const ids = createFakeIdGen(SEED_ULID);
    expect(ids.next()).toBe(SEED_ULID);
    const second = ids.next();
    expect(second > SEED_ULID).toBe(true);
    expect(isUlid(second)).toBe(true);
  });

  it('A-3: hands out every requested brand from the same increasing sequence', () => {
    const ids = createFakeIdGen('brands');
    const first: string = ids.next<'work-order'>();
    const second: string = ids.next<'run'>();
    const third: string = ids.next<'account'>();
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
  });
});
