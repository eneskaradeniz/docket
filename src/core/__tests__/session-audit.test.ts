import { describe, expect, it } from 'vitest';
import { deriveSessionAudit, sessionHeadline } from '../derive';
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

// WO-0031d — unscoped sessions (free-form runs, stepIdx undefined by design — types.ts). They used to
// fold into { kind: 'step', idx: 0 } and rendered "Adım 0"; they are their own thing now: a session
// that belongs to no step ("Bağımsız"). The architect's plan session is NOT unscoped — it is the plan.
describe('deriveSessionAudit — unscoped sessions (WO-0031d)', () => {
  it('an implementer session WITHOUT a step is unscoped — never "Adım 0"', () => {
    const out = deriveSessionAudit([session({ role: 'implementer', startedAt: T(9), endedAt: T(9, 4) })]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.name).toEqual({ kind: 'unscoped' });
  });

  it('a verifier session WITHOUT a step is unscoped too', () => {
    const out = deriveSessionAudit([session({ role: 'verifier', startedAt: T(9), endedAt: T(9, 2) })]);
    expect(out.rows[0]!.name).toEqual({ kind: 'unscoped' });
  });

  it('an architect session WITHOUT a step stays the PLAN session (unscoped is not a demotion)', () => {
    const out = deriveSessionAudit([session({ role: 'architect', startedAt: T(9), endedAt: T(9, 3) })]);
    expect(out.rows[0]!.name).toEqual({ kind: 'plan' });
  });

  it('a mixed ledger keeps plan/step/review/unscoped distinct', () => {
    const out = deriveSessionAudit([
      session({ role: 'implementer', stepIdx: 1, startedAt: T(10) }),
      session({ role: 'implementer', startedAt: T(11) }),
      session({ role: 'architect', startedAt: T(9) }),
      session({ role: 'architect', stepIdx: 1, startedAt: T(12) }),
    ]);
    expect(out.rows.map((r) => r.name.kind)).toEqual(['plan', 'step', 'unscoped', 'review']);
  });
});

describe('deriveSessionAudit — sourceIdx (WO-0031e tur-3)', () => {
  // The ledger sorts a copy, so a row cannot otherwise say WHICH session it came from. sourceIdx is
  // the INPUT index — the UI maps sessions[row.sourceIdx].transcript for the row expansion.
  it('every row maps back to its input session while rows stay start-time sorted', () => {
    const sessions = [
      session({ role: 'implementer', stepIdx: 1, startedAt: T(14, 16), endedAt: T(14, 22) }),
      session({ role: 'architect', startedAt: T(14, 9), endedAt: T(14, 14) }),
      session({ role: 'verifier', stepIdx: 4, startedAt: T(15, 10), endedAt: T(15, 29) }),
    ];
    const out = deriveSessionAudit(sessions);
    expect(out.rows.map((r) => r.sourceIdx)).toEqual([1, 0, 2]);
    for (const r of out.rows) {
      expect(sessions[r.sourceIdx]!.role).toBe(r.role);
      expect(sessions[r.sourceIdx]!.startedAt).toBe(r.startedAt);
    }
  });

  it('sourceIdx is the INPUT index, not the row index — pinned on an out-of-order fixture', () => {
    const sessions = [
      session({ role: 'verifier', stepIdx: 2, startedAt: T(16) }),
      session({ role: 'architect', startedAt: T(10) }),
    ];
    const out = deriveSessionAudit(sessions);
    expect(out.rows[0]!.name.kind).toBe('plan');
    expect(out.rows[0]!.sourceIdx).toBe(1);
    expect(out.rows[1]!.name.kind).toBe('step');
    expect(out.rows[1]!.sourceIdx).toBe(0);
  });
});

describe('sessionHeadline — the özet is readable text, never markdown (WO-0044)', () => {
  // The KİM — ROL card made the özet prominent; the agents' report-style closings leaked raw
  // "##"/"**"/backticks into it (the operator's screenshot, 2026-08-25). The headline derivation
  // lives in core now — pure string work, tested here.
  it('strips the markdown agents close with: headings, bold, code spans, links keep their text', () => {
    const closing = '## Uygulayıcı Raporu — WO-0001\n**PR: https://github.com/x/base-mobile/pull/16** · dal `feat/6c-3`';
    expect(sessionHeadline(closing)).toBe(
      'Uygulayıcı Raporu — WO-0001 PR: https://github.com/x/base-mobile/pull/16 · dal feat/6c-3',
    );
  });

  it('a markdown link keeps its label, loses its url', () => {
    expect(sessionHeadline('PR [açık](https://github.com/x/pull/16) ve hazır.')).toBe('PR açık ve hazır.');
  });

  it('takes the first sentence and squeezes line breaks into spaces', () => {
    expect(sessionHeadline('Tamamlandı.\n\nİkinci cümle   burada.')).toBe('Tamamlandı.');
  });

  it('clamps at 140 chars with an ellipsis (Faz 1 trim, unchanged)', () => {
    const out = sessionHeadline(`${'a'.repeat(200)}. sonrası`);
    expect(out).toHaveLength(141);
    expect(out!.endsWith('…')).toBe(true);
  });

  it('returns undefined when nothing readable remains — no headline beats a broken one', () => {
    expect(sessionHeadline('##')).toBeUndefined();
    expect(sessionHeadline('**`**`**')).toBeUndefined();
    expect(sessionHeadline('   ')).toBeUndefined();
  });
});
