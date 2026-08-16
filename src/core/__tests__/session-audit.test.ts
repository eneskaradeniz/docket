import { describe, expect, it } from 'vitest';
import { deriveSessionAudit } from '../derive';
import type { SessionRef } from '../types';

// WO-0031c — the session ledger (Denetim): one row per session in the SAME language the cards speak
// (Plan / Adım N / İnceleme N), plus an honest total. Names are STRUCTURED (labels render them);
// ordering is by start time; a session without timestamps contributes 0 duration, never NaN.
const T = (h: number, m = 0): string => `2026-08-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

const session = (over: Partial<SessionRef>): SessionRef =>
  ({ transcript: [], status: 'idle', ...over }) as SessionRef;

describe('deriveSessionAudit (WO-0031c)', () => {
  it('empty sessions → no rows, zero total', () => {
    const out = deriveSessionAudit([]);
    expect(out.rows).toEqual([]);
    expect(out.total).toEqual({ durationMs: 0, costUsd: 0 });
  });

  it('an architect session without a step is the PLAN session', () => {
    const out = deriveSessionAudit([session({ role: 'architect', startedAt: T(14, 9), endedAt: T(14, 14), cost: { tokensIn: 1, tokensOut: 1, usd: 1.84 } })]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.name).toEqual({ kind: 'plan' });
    expect(out.rows[0]!.durationMs).toBe(5 * 60 * 1000);
    expect(out.rows[0]!.costUsd).toBe(1.84);
  });

  it('an architect session WITH a step is that step\'s REVIEW; implementer/verifier are the step run', () => {
    const out = deriveSessionAudit([
      session({ role: 'implementer', stepIdx: 2, startedAt: T(14, 22), endedAt: T(14, 40), cost: { tokensIn: 1, tokensOut: 1, usd: 2.4 } }),
      session({ role: 'architect', stepIdx: 2, startedAt: T(14, 41), endedAt: T(14, 43), cost: { tokensIn: 1, tokensOut: 1, usd: 0.41 } }),
    ]);
    expect(out.rows.map((r) => r.name)).toEqual([{ kind: 'step', idx: 2 }, { kind: 'review', idx: 2 }]);
  });

  it('a step row carries the step aim when the specs are given (the ledger speaks the plan\'s language)', () => {
    const out = deriveSessionAudit(
      [session({ role: 'implementer', stepIdx: 1, startedAt: T(10), endedAt: T(10, 6) })],
      [{ idx: 1, aim: 'yerleşim kararı' }],
    );
    expect(out.rows[0]!.name).toEqual({ kind: 'step', idx: 1, aim: 'yerleşim kararı' });
  });

  it('rows sort by start time; the total sums durations + costs and spans min..max', () => {
    const out = deriveSessionAudit([
      session({ role: 'implementer', stepIdx: 1, startedAt: T(14, 16), endedAt: T(14, 22), cost: { tokensIn: 0, tokensOut: 0, usd: 0.96 } }),
      session({ role: 'architect', startedAt: T(14, 9), endedAt: T(14, 14), cost: { tokensIn: 0, tokensOut: 0, usd: 1.84 } }),
      session({ role: 'verifier', stepIdx: 4, startedAt: T(15, 10), endedAt: T(15, 29), cost: { tokensIn: 0, tokensOut: 0, usd: 2.03 } }),
    ]);
    expect(out.rows.map((r) => r.name.kind)).toEqual(['plan', 'step', 'step']);
    expect(out.total.durationMs).toBe((5 + 6 + 19) * 60 * 1000);
    expect(out.total.costUsd).toBeCloseTo(4.83);
    expect(out.total.startAt).toBe(T(14, 9));
    expect(out.total.endAt).toBe(T(15, 29));
  });

  it('a live session (no endedAt) contributes zero duration but its cost still counts', () => {
    const out = deriveSessionAudit([session({ role: 'implementer', stepIdx: 1, startedAt: T(10), cost: { tokensIn: 0, tokensOut: 0, usd: 0.5 } })]);
    expect(out.rows[0]!.durationMs).toBe(0);
    expect(out.total.costUsd).toBe(0.5);
  });

  it('sessions without a cost render an undefined costUsd (labels show "—", not a fake $0,00)', () => {
    const out = deriveSessionAudit([session({ role: 'architect', startedAt: T(10), endedAt: T(10, 5) })]);
    expect(out.rows[0]!.costUsd).toBeUndefined();
    expect(out.total.costUsd).toBe(0);
  });
});
