import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../application/ports/fakes/index';
import { isUlid } from '../../domain/index';
import type { RandomBytes } from './ulid';
import { createUlidGen, encodeUlid } from './ulid';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ZERO_BYTES = new Uint8Array(10);
const FF_BYTES = new Uint8Array(10).fill(0xff);

/** Big-endian byte list helper: bytes(0x00, 0x01, …) for readability. */
const bytes = (...values: readonly number[]): Uint8Array => new Uint8Array(values);

/** Reads the 48-bit millisecond time back out of the first 10 characters. */
const decodeTime = (id: string): number => {
  let value = 0;
  for (let i = 0; i < 10; i++) value = value * 32 + ALPHABET.indexOf(id[i]);
  return value;
};

/** Reads the 80-bit randomness back out of the last 16 characters. */
const decodeRandom = (id: string): Uint8Array => {
  let bits = 0n;
  for (let i = 10; i < 26; i++) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(id[i]));
  const out = new Uint8Array(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return out;
};

/** A RandomBytes stub that fills every byte with (2 x draw counter): a fresh draw lands on an
 * even value, while incrementing the previous draw would land on an odd one — the two are
 * distinguishable. It also counts draws. */
const countingRandom = (): { random: RandomBytes; draws: () => number } => {
  let draws = 0;
  return {
    random: (length: number) => new Uint8Array(length).fill(2 * ++draws),
    draws: () => draws,
  };
};

describe('encodeUlid', () => {
  it('I-1: encodes 48-bit time big-endian and 80-bit randomness into 26 Crockford base32 chars that pass isUlid', () => {
    const time = 1_234_567_890_123;
    const random = bytes(0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc);
    const id = encodeUlid(time, random);
    expect(id).toHaveLength(26);
    for (const char of id) expect(ALPHABET).toContain(char);
    expect(isUlid(id)).toBe(true);
    expect(decodeTime(id)).toBe(time);
    expect([...decodeRandom(id)]).toEqual([...random]);
  });

  it("I-1: encodeUlid(0, 10 zero bytes) is '0'.repeat(26)", () => {
    expect(encodeUlid(0, ZERO_BYTES)).toBe('0'.repeat(26));
  });

  it("I-1: encodeUlid(2**48 - 1, 10 x 0xFF) is '7' followed by 25 'Z'", () => {
    expect(encodeUlid(2 ** 48 - 1, FF_BYTES)).toBe('7' + 'Z'.repeat(25));
  });

  it('I-1: throws when the time is negative or at 2**48 and above', () => {
    expect(() => encodeUlid(-1, ZERO_BYTES)).toThrow();
    expect(() => encodeUlid(2 ** 48, ZERO_BYTES)).toThrow();
    expect(() => encodeUlid(2 ** 48 + 1, ZERO_BYTES)).toThrow();
  });

  it('I-1: throws when the time is not an integer', () => {
    expect(() => encodeUlid(1.5, ZERO_BYTES)).toThrow();
    expect(() => encodeUlid(Number.NaN, ZERO_BYTES)).toThrow();
    expect(() => encodeUlid(Number.POSITIVE_INFINITY, ZERO_BYTES)).toThrow();
  });

  it('I-1: throws when random does not hold exactly 10 bytes', () => {
    expect(() => encodeUlid(0, new Uint8Array(9))).toThrow();
    expect(() => encodeUlid(0, new Uint8Array(11))).toThrow();
    expect(() => encodeUlid(0, new Uint8Array(0))).toThrow();
  });
});

describe('createUlidGen', () => {
  it('I-2: draws 10 fresh bytes from random when the clock moves forward', () => {
    const clock = createFakeClock(1_000);
    const { random, draws } = countingRandom();
    const gen = createUlidGen(clock, random);
    const first = gen.next();
    expect(draws()).toBe(1);
    clock.advance(5);
    const second = gen.next();
    expect(draws()).toBe(2);
    expect(decodeTime(second)).toBe(1_005);
    // Draw 2 fills 0x04; incrementing draw 1 (0x02) would have produced 0x03 instead.
    expect(decodeRandom(second)).toEqual(new Uint8Array(10).fill(0x04));
    expect(second > first).toBe(true);
  });

  it('I-2: keeps the last time and increments the 80-bit randomness within the same millisecond', () => {
    const gen = createUlidGen(createFakeClock(0), () => ZERO_BYTES);
    const first = gen.next();
    expect(first).toBe('0'.repeat(26));
    const second = gen.next();
    expect(decodeTime(second)).toBe(0);
    expect(decodeRandom(second)).toEqual(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 1));
    expect(second > first).toBe(true);
  });

  it('I-2: keeps the last time and increments the randomness when the clock steps back', () => {
    const clock = createFakeClock(2_000);
    const { random, draws } = countingRandom();
    const gen = createUlidGen(clock, random);
    const first = gen.next();
    clock.advance(-2_000); // clock went backwards
    const second = gen.next();
    expect(draws()).toBe(1); // no fresh draw on a backwards step
    expect(decodeTime(second)).toBe(2_000); // last time is kept
    expect(second > first).toBe(true);
  });

  it('I-2: yields 10000 strictly increasing ids with a frozen clock, all passing isUlid', () => {
    const gen = createUlidGen(createFakeClock(1_700_000_000_000));
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i++) ids.push(gen.next());
    for (const id of ids) expect(isUlid(id)).toBe(true);
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
  });

  it('I-2: throws when the 80-bit randomness overflows', () => {
    const gen = createUlidGen(createFakeClock(0), () => FF_BYTES);
    expect(gen.next()).toBe('0'.repeat(10) + 'Z'.repeat(16));
    expect(() => gen.next()).toThrow();
  });

  it('I-2: carries an increment across wrapped 0xFF bytes without throwing', () => {
    const gen = createUlidGen(createFakeClock(0), () => bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff));
    gen.next();
    const second = gen.next();
    expect(decodeRandom(second)).toEqual(bytes(0, 0, 0, 0, 0, 0, 0, 0, 1, 0x00));
  });

  it('I-2: uses node:crypto randomBytes when no random is given', () => {
    const gen = createUlidGen(createFakeClock(42));
    const first = gen.next();
    const second = gen.next();
    expect(isUlid(first)).toBe(true);
    expect(isUlid(second)).toBe(true);
    expect(decodeTime(first)).toBe(42);
    expect(second > first).toBe(true);
  });
});
