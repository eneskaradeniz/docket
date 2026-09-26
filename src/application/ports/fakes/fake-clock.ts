// In-memory Clock — deterministic time for tests.
import type { EpochMs } from '../../../domain/index';

import type { Clock } from '../clock';

export interface FakeClock extends Clock {
  /** Moves the clock forward by `ms` (negative values are allowed) and returns the new time. */
  advance(ms: number): EpochMs;
}

export const createFakeClock = (start: EpochMs = 0): FakeClock => {
  let current = start;
  return {
    now: (): EpochMs => current,
    advance: (ms: number): EpochMs => {
      current = current + ms;
      return current;
    },
  };
};
