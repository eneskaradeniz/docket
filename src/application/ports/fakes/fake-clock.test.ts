import { describe, expect, it } from 'vitest';

import { createFakeClock } from './fake-clock';

describe('createFakeClock', () => {
  it('A-3: starts at the given epoch and now() reports it', () => {
    const clock = createFakeClock(1_000);
    expect(clock.now()).toBe(1_000);
  });

  it('A-3: advance(ms) moves time forward and returns the new time', () => {
    const clock = createFakeClock(100);
    expect(clock.advance(50)).toBe(150);
    expect(clock.advance(0)).toBe(150);
    expect(clock.now()).toBe(150);
    expect(clock.advance(25)).toBe(175);
    expect(clock.now()).toBe(175);
  });

  it('A-3: defaults to epoch 0', () => {
    expect(createFakeClock().now()).toBe(0);
  });
});
