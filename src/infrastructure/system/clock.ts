// Wall-clock adapter: the domain and application never read time directly, only through Clock.
import type { Clock } from '../../application/index';

export function createSystemClock(): Clock {
  return { now: (): number => Date.now() };
}
