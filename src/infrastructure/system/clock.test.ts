import { describe, expect, it } from 'vitest';
import { createSystemClock } from './clock';

describe('createSystemClock', () => {
  it('now() reports the wall clock in UTC milliseconds (between the surrounding Date.now readings)', () => {
    const before = Date.now();
    const now = createSystemClock().now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('now() returns integers and never moves backwards between calls', () => {
    const clock = createSystemClock();
    const first = clock.now();
    const second = clock.now();
    expect(Number.isInteger(first)).toBe(true);
    expect(Number.isInteger(second)).toBe(true);
    expect(second).toBeGreaterThanOrEqual(first);
  });
});
