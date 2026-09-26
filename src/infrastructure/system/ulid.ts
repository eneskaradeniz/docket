// ULID generation: 48-bit millisecond time + 80-bit randomness, Crockford base32, monotonic per generator.
import type { Clock, IdGen } from '../../application/index';

export type RandomBytes = (length: number) => Uint8Array;

/** `random` defaults to node:crypto randomBytes. */
export function createUlidGen(clock: Clock, random?: RandomBytes): IdGen {
  void [clock, random];
  throw new Error('not implemented');
}

/** 48-bit time + 80-bit randomness -> 26 Crockford base32 chars. */
export function encodeUlid(timeMs: number, random: Uint8Array): string {
  void [timeMs, random];
  throw new Error('not implemented');
}
