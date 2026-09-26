// ULID generation: 48-bit millisecond time + 80-bit randomness, Crockford base32, monotonic per generator.
import { randomBytes } from 'node:crypto';

import type { Clock, IdGen } from '../../application/index';
import type { Ulid } from '../../domain/index';

export type RandomBytes = (length: number) => Uint8Array;

/** Crockford base32: the digits 0-9 then the letters except I, L, O, U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10; // 10 x 5 bits carries the 48-bit time
const RANDOM_CHARS = 16; // 16 x 5 bits carry the 80-bit randomness
const RANDOM_BYTES = 10;
const TIME_MAX = 2 ** 48 - 1;

/** `random` defaults to node:crypto randomBytes. */
export function createUlidGen(clock: Clock, random: RandomBytes = defaultRandomBytes): IdGen {
  let lastTime = -1;
  let lastRandom: Uint8Array = new Uint8Array(RANDOM_BYTES);

  const next = <B extends string>(): Ulid<B> => {
    const now = clock.now();
    if (now > lastTime) {
      lastRandom = random(RANDOM_BYTES);
      lastTime = now;
    } else {
      // Same millisecond, or the clock went backwards: keep the last time and count up.
      const incremented = new Uint8Array(lastRandom);
      let carry = 1;
      for (let i = RANDOM_BYTES - 1; i >= 0 && carry === 1; i--) {
        const sum = incremented[i] + carry;
        incremented[i] = sum % 256;
        carry = sum === 256 ? 1 : 0;
      }
      if (carry === 1) throw new Error('createUlidGen: the 80-bit randomness overflowed');
      lastRandom = incremented;
    }
    return encodeUlid(lastTime, lastRandom) as Ulid<B>;
  };

  return { next };
}

/** 48-bit time + 80-bit randomness -> 26 Crockford base32 chars. */
export function encodeUlid(timeMs: number, random: Uint8Array): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > TIME_MAX) {
    throw new Error('encodeUlid: time must be an integer of milliseconds between 0 and 2^48 - 1');
  }
  if (random.length !== RANDOM_BYTES) {
    throw new Error('encodeUlid: randomness must be exactly 10 bytes');
  }

  let time = timeMs;
  const timeChars = new Array<string>(TIME_CHARS);
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    timeChars[i] = ALPHABET[time % 32];
    time = Math.floor(time / 32);
  }

  let bits = 0n;
  for (const byte of random) bits = (bits << 8n) | BigInt(byte);
  const randomChars = new Array<string>(RANDOM_CHARS);
  for (let i = RANDOM_CHARS - 1; i >= 0; i--) {
    randomChars[i] = ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }

  return timeChars.join('') + randomChars.join('');
}

const defaultRandomBytes: RandomBytes = (length: number) => randomBytes(length);
