import { describe, expect, it } from 'vitest';
import type { RunOutcome } from './run';

describe('RunOutcome', () => {
  it('contains exactly the four outcomes: succeeded, failed, limit, cancelled', () => {
    const outcomes: readonly RunOutcome[] = ['succeeded', 'failed', 'limit', 'cancelled'];
    expect([...outcomes].sort()).toEqual(['cancelled', 'failed', 'limit', 'succeeded']);
  });
});
