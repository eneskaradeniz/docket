import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE, type EpochMs } from './time';

describe('MINUTE', () => {
  it('is 60_000 milliseconds', () => {
    expect(MINUTE).toBe(60_000);
  });
});

describe('HOUR', () => {
  it('is 3_600_000 milliseconds', () => {
    expect(HOUR).toBe(3_600_000);
  });

  it('is 60 minutes', () => {
    expect(HOUR).toBe(60 * MINUTE);
  });
});

describe('EpochMs', () => {
  it('carries a plain UTC millisecond timestamp as a number', () => {
    const at: EpochMs = 1_789_000_000_000;
    expect(typeof at).toBe('number');
  });
});
