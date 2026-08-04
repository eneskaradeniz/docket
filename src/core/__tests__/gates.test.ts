import { describe, expect, it } from 'vitest';
import { GATES } from '../gates';

describe('GATES — ADR-0001 forward (single source for rail / evidence / primary action)', () => {
  it('maps each gated WO stage to its evidence requirement', () => {
    expect(GATES.architect_approval).toEqual(['plan_approval']);
    expect(GATES.verification).toEqual(['verification']);
    expect(GATES.closure).toEqual(['closure']);
  });

  it('leaves non-gated stages undefined (nothing to satisfy)', () => {
    expect(GATES.implementation).toBeUndefined();
    expect(GATES.written).toBeUndefined();
    expect(GATES.plan_ready).toBeUndefined();
    expect(GATES.architect_audit).toBeUndefined();
  });
});
