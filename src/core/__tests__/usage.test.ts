// src/core/__tests__/usage.test.ts — the usage read model's derivation contract, test-first
// (WO-0054, ADR-0006). One test per D2 rule of the plan. Written BEFORE src/core/usage.ts.
// The window is a FIXED UTC month — core stays clock-free and the tests carry no clock seam.
import { describe, expect, it } from 'vitest';
import type { DeriveUsageInput, UsageFactRow, UsageSessionFact } from '../usage';
import { basisDiverges, deriveUsageView } from '../usage';
import type { WorkOrderId } from '../types';

// Tests may build identities (the boundary carve-out, the roadmap.test.ts precedent).
const wo = (id: string): WorkOrderId => id as WorkOrderId;

const WIN = { startIso: '2026-08-01T00:00:00.000Z', endIso: '2026-09-01T00:00:00.000Z' };

const row = (over: Partial<UsageFactRow> & { providerSessionId: string }): UsageFactRow => ({
  workOrderId: null,
  at: '2026-08-10T10:00:00.000Z',
  tokensIn: 100,
  tokensOut: 10,
  usdDelta: 0.01,
  ...over,
});

const session = (over: Partial<UsageSessionFact> & { providerSessionId: string }): UsageSessionFact => ({
  workOrderId: null,
  ...over,
});

const input = (over: Partial<DeriveUsageInput>): DeriveUsageInput => ({
  window: WIN,
  rows: [],
  sessions: [],
  orders: [],
  ...over,
});

describe('deriveUsageView — the D2 rules, one test each', () => {
  it('D1/D2.10: empty input → the empty face, no buckets, no draft, zero counters', () => {
    const v = deriveUsageView(input({}));
    expect(v.empty).toBe(true);
    expect(v.totals).toEqual({ usd: 0, tokensIn: 0, tokensOut: 0 });
    expect(v.byRole).toEqual([]);
    expect(v.byModel).toEqual([]);
    expect(v.hasModelSplit).toBe(false);
    expect(v.cache).toEqual({ freshIn: 0, cacheRead: 0, cacheCreation: 0, hasCacheFigures: false });
    expect(v.workOrders).toEqual([]);
    expect('draft' in v).toBe(false);
    expect(v.sessions).toEqual([]);
    expect(v.unledgeredCount).toBe(0);
    expect(v.roleUnknownCount).toBe(0);
    expect(v.hasUnknown).toBe(false);
  });

  // WO-0061: the known-spend basis — an in-window session with NO cost (the interrupted leg:
  // abort precedes the result) makes the ledger total a lower bound, and the head must know it.
  it('hasUnknown: an in-window NULL-cost session flips it; paid and out-of-window sessions do not', () => {
    expect(deriveUsageView(input({})).hasUnknown).toBe(false);
    expect(
      deriveUsageView(input({ sessions: [session({ providerSessionId: 's-paid', costUsd: 0.05, startedAt: '2026-08-10T10:00:00.000Z' })] }))
        .hasUnknown,
    ).toBe(false);
    expect(
      deriveUsageView(input({ sessions: [session({ providerSessionId: 's-out', startedAt: '2026-07-10T10:00:00.000Z' })] })).hasUnknown,
    ).toBe(false);
    expect(
      deriveUsageView(input({ sessions: [session({ providerSessionId: 's-null', startedAt: '2026-08-10T10:00:00.000Z' })] })).hasUnknown,
    ).toBe(true);
  });

  it('D2.9: money is cent-exact round2 — 3.10+4.20+1.00+2.60+1.50 === 12.40, never 12.399999…', () => {
    const v = deriveUsageView(
      input({
        rows: [3.1, 4.2, 1.0, 2.6, 1.5].map((usdDelta, i) => row({ providerSessionId: `s${i}`, usdDelta })),
      }),
    );
    expect(v.totals.usd).toBe(12.4);
  });

  it('D2.1: the window excludes out-of-month rows AND keeps an in-month row of a last-month-started session', () => {
    const v = deriveUsageView(
      input({
        rows: [
          row({ providerSessionId: 'old', at: '2026-07-15T10:00:00.000Z', usdDelta: 0.5, tokensIn: 1000, tokensOut: 100 }),
          row({ providerSessionId: 'old', at: '2026-08-05T10:00:00.000Z', usdDelta: 0.25, tokensIn: 500, tokensOut: 50 }),
        ],
        sessions: [
          session({ providerSessionId: 'old', role: 'implementer', costUsd: 0.75, startedAt: '2026-07-14T09:00:00.000Z' }),
        ],
      }),
    );
    expect(v.totals).toEqual({ usd: 0.25, tokensIn: 500, tokensOut: 50 });
    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0]!.usd).toBe(0.25);
    expect(v.byRole).toHaveLength(1);
    expect(v.byRole[0]!.role).toBe('implementer');
    // the July-started session is NOT unledgered — it has an in-month row
    expect(v.unledgeredCount).toBe(0);
  });

  it('F4 composition: rows: [] + one costed in-month session → empty AND unledgeredCount 1', () => {
    const v = deriveUsageView(
      input({
        sessions: [
          session({ providerSessionId: 'vintage', role: 'architect', costUsd: 2.08, startedAt: '2026-08-02T08:00:00.000Z' }),
        ],
      }),
    );
    expect(v.empty).toBe(true);
    expect(v.unledgeredCount).toBe(1);
  });

  it('F1: basisDiverges — both directions on the 0.005 cent-half tolerance', () => {
    expect(basisDiverges(17.65, 17.65)).toBe(false); // agreeing bases
    expect(basisDiverges(17.65, 17.651)).toBe(false); // a rounding dust mote, not a divergence
    expect(basisDiverges(17.65, 16.4)).toBe(true); // the two bases genuinely moved apart
    expect(basisDiverges(5, 5.004)).toBe(false);
    expect(basisDiverges(5, 5.006)).toBe(true);
  });

  it('F2: modelSplitDiverges — the precondition CONSTRUCTED, both directions', () => {
    // a multi-model row whose LINES do not sum to its usd_delta (the provider reports the split
    // and the row total on separate channels): the split exists AND diverges
    const divergent = deriveUsageView(
      input({
        rows: [
          row({
            providerSessionId: 'm',
            usdDelta: 1.0,
            modelUsage: [
              { model: 'glm-5.3', tokensIn: 600, tokensOut: 60, usd: 0.3 },
              { model: 'glm-5.3-flash', tokensIn: 400, tokensOut: 40, usd: 0.2 },
            ],
          }),
        ],
      }),
    );
    expect(divergent.hasModelSplit).toBe(true);
    expect(divergent.modelSplitDiverges).toBe(true); // lines Σ 0.5 vs the row total 1.0

    const agreeing = deriveUsageView(
      input({
        rows: [
          row({
            providerSessionId: 'm',
            usdDelta: 0.5,
            modelUsage: [
              { model: 'glm-5.3', tokensIn: 600, tokensOut: 60, usd: 0.3 },
              { model: 'glm-5.3-flash', tokensIn: 400, tokensOut: 40, usd: 0.2 },
            ],
          }),
        ],
      }),
    );
    expect(agreeing.modelSplitDiverges).toBe(false);

    // the guard half: an all-shortcut month never diverges, whatever the totals
    const shortcut = deriveUsageView(
      input({ rows: [row({ providerSessionId: 's', usdDelta: 0.4, model: 'glm-5.3' })] }),
    );
    expect(shortcut.hasModelSplit).toBe(false);
    expect(shortcut.modelSplitDiverges).toBe(false);
  });

  it('F2 (review round): rounding dust cannot fire the split note — the comparison is RAW', () => {
    // three buckets each rounding UP half a cent: the ROUNDED Σ drifts 0.012 from the rounded
    // total (an exported view-reading predicate compared rounded sums and false-fired); the raw
    // Σ equals the raw total exactly — dust is not the provider's two-channel story
    const dusty = deriveUsageView(
      input({
        rows: [
          row({
            providerSessionId: 'd',
            usdDelta: 0.018,
            modelUsage: [
              { model: 'a', tokensIn: 100, tokensOut: 10, usd: 0.006 },
              { model: 'b', tokensIn: 100, tokensOut: 10, usd: 0.006 },
              { model: 'c', tokensIn: 100, tokensOut: 10, usd: 0.006 },
            ],
          }),
        ],
      }),
    );
    expect(dusty.hasModelSplit).toBe(true);
    expect(dusty.modelSplitDiverges).toBe(false); // raw Σ 0.018 === raw total 0.018
    // the same shape GENUINELY apart (the row total moved, the lines did not) still fires
    const apart = deriveUsageView(
      input({
        rows: [
          row({
            providerSessionId: 'd',
            usdDelta: 0.118,
            modelUsage: [
              { model: 'a', tokensIn: 100, tokensOut: 10, usd: 0.006 },
              { model: 'b', tokensIn: 100, tokensOut: 10, usd: 0.006 },
              { model: 'c', tokensIn: 100, tokensOut: 10, usd: 0.006 },
            ],
          }),
        ],
      }),
    );
    expect(apart.modelSplitDiverges).toBe(true); // raw Σ 0.018 vs raw total 0.118
  });

  it('D2.4: byRole — usd desc, pct of the totals, zero-row roles ABSENT', () => {
    const v = deriveUsageView(
      input({
        rows: [
          row({ providerSessionId: 'i1', usdDelta: 13.17, tokensIn: 253000, tokensOut: 61000 }),
          row({ providerSessionId: 'i2', usdDelta: 0.5 }),
          row({ providerSessionId: 'a1', usdDelta: 3.37, tokensIn: 141000, tokensOut: 39000 }),
        ],
        sessions: [
          session({ providerSessionId: 'i1', role: 'implementer' }),
          session({ providerSessionId: 'i2', role: 'implementer' }),
          session({ providerSessionId: 'a1', role: 'architect' }),
          session({ providerSessionId: 'norows', role: 'verifier' }), // zero rows → NO bucket, no session row
        ],
      }),
    );
    expect(v.byRole).toEqual([
      { role: 'implementer', usd: 13.67, tokensIn: 253100, tokensOut: 61010, sessionCount: 2, pct: 80 },
      { role: 'architect', usd: 3.37, tokensIn: 141000, tokensOut: 39000, sessionCount: 1, pct: 20 },
    ]);
    // a session fact with no windowed rows paints no bucket AND no session row (D2.7)
    expect(v.byRole.some((b) => b.role === 'verifier')).toBe(false);
    expect(v.sessions.some((s) => s.providerSessionId === 'norows')).toBe(false);
  });

  it('D2.2: byModel — the row-partition: lines win, the model shortcut, the 0-model unknown bucket, no double-landing', () => {
    const v = deriveUsageView(
      input({
        rows: [
          // multi-model: ONLY the lines' figures land in byModel (the row's scalars never do)
          row({
            providerSessionId: 'm',
            usdDelta: 1.0,
            tokensIn: 1000,
            tokensOut: 100,
            modelUsage: [
              { model: 'glm-5.3', tokensIn: 600, tokensOut: 60, usd: 0.3 },
              { model: 'glm-5.3-flash', tokensIn: 400, tokensOut: 40, usd: 0.2 },
            ],
          }),
          // single-model shortcut: the row's own scalars land under its model
          row({ providerSessionId: 's', usdDelta: 0.4, tokensIn: 300, tokensOut: 30, model: 'glm-5.3' }),
          // 0-model: the row's scalars land in the unknown bucket (rendered last)
          row({ providerSessionId: 'u', usdDelta: 0.6, tokensIn: 200, tokensOut: 20 }),
        ],
      }),
    );
    expect(v.hasModelSplit).toBe(true);
    expect(v.byModel).toEqual([
      { model: 'glm-5.3', usd: 0.7, tokensIn: 900, tokensOut: 90 }, // 0.3 (line) + 0.4 (row)
      { model: 'glm-5.3-flash', usd: 0.2, tokensIn: 400, tokensOut: 40 },
      { model: undefined, usd: 0.6, tokensIn: 200, tokensOut: 20 }, // the unknown bucket, LAST
    ]);
    // totals come from the ROW scalars — the multi-model row's full delta lands ONCE, in totals
    expect(v.totals.usd).toBe(2.0);
    // Σ byModel (1.7) ≠ totals (2.0) → the split diverges (the note's live state)
    expect(v.modelSplitDiverges).toBe(true);
  });

  it('D2.6: cache — sums over the reporting rows, freshIn over all rows, hasCacheFigures both directions', () => {
    const withCache = deriveUsageView(
      input({
        rows: [
          row({ providerSessionId: 'a', usdDelta: 0.1, tokensIn: 500, cacheRead: 1_400_000, cacheCreation: 310_000 }),
          row({ providerSessionId: 'b', usdDelta: 0.1, tokensIn: 300 }), // no cache figures → freshIn only
        ],
      }),
    );
    expect(withCache.cache).toEqual({ freshIn: 800, cacheRead: 1_400_000, cacheCreation: 310_000, hasCacheFigures: true });

    const without = deriveUsageView(
      input({ rows: [row({ providerSessionId: 'a', usdDelta: 0.1, tokensIn: 500 })] }),
    );
    expect(without.cache).toEqual({ freshIn: 500, cacheRead: 0, cacheCreation: 0, hasCacheFigures: false });
  });

  it('D2.5: workOrders — usd desc, zero-spend absent, the title from the order fact', () => {
    const v = deriveUsageView(
      input({
        rows: [
          row({ providerSessionId: 'a', workOrderId: wo('w2'), usdDelta: 4.12 }),
          row({ providerSessionId: 'b', workOrderId: wo('w2'), usdDelta: 0.01 }),
          row({ providerSessionId: 'c', workOrderId: wo('w1'), usdDelta: 6.84 }),
          row({ providerSessionId: 'z', workOrderId: wo('w3'), usdDelta: 0 }), // zero-spend → ABSENT
        ],
        sessions: [
          session({ providerSessionId: 'a', workOrderId: wo('w2'), role: 'implementer' }),
          session({ providerSessionId: 'b', workOrderId: wo('w2'), role: 'architect' }),
          session({ providerSessionId: 'c', workOrderId: wo('w1'), role: 'implementer' }),
          session({ providerSessionId: 'z', workOrderId: wo('w3'), role: 'verifier' }),
        ],
        orders: [
          { id: wo('w1'), title: 'Kullanım enstrümantasyonu' },
          { id: wo('w2'), title: 'Limit ekranı' },
          { id: wo('w3'), title: 'Boş iş' },
        ],
      }),
    );
    expect(v.workOrders).toEqual([
      { id: wo('w1'), title: 'Kullanım enstrümantasyonu', usd: 6.84, sessionCount: 1 },
      { id: wo('w2'), title: 'Limit ekranı', usd: 4.13, sessionCount: 2 },
    ]);
  });

  it('D2.5/Ruling 3: the ✦ draft bucket + the double-appearance — byRole still carries the draft role', () => {
    const v = deriveUsageView(
      input({
        rows: [row({ providerSessionId: 'd1', usdDelta: 1.41, tokensIn: 201_000, tokensOut: 9_000 })],
        sessions: [session({ providerSessionId: 'd1', role: 'architect' })],
      }),
    );
    expect(v.draft).toEqual({ usd: 1.41, tokensIn: 201_000, tokensOut: 9_000, sessionCount: 1 });
    // the SAME rows paint the architect bucket — two views of one row set, no combined figure
    expect(v.byRole).toEqual([
      { role: 'architect', usd: 1.41, tokensIn: 201_000, tokensOut: 9_000, sessionCount: 1, pct: 100 },
    ]);
    expect(v.workOrders).toEqual([]);
  });

  it('D2.7: sessions — lastAt desc, turnCount = the row count, ctxPct present only with a checkpoint', () => {
    const v = deriveUsageView(
      input({
        rows: [
          row({ providerSessionId: 's1', usdDelta: 0.2, tokensIn: 100, tokensOut: 10, at: '2026-08-03T04:00:00.000Z' }),
          row({ providerSessionId: 's1', usdDelta: 0.3, tokensIn: 200, tokensOut: 20, at: '2026-08-04T04:02:00.000Z' }),
          row({ providerSessionId: 's2', usdDelta: 0.1, tokensIn: 50, tokensOut: 5, at: '2026-08-05T12:01:00.000Z' }),
        ],
        sessions: [
          session({ providerSessionId: 's1', role: 'architect', ctx: { usedTokens: 124_000, maxTokens: 200_000 } }),
          session({ providerSessionId: 's2', role: 'implementer' }), // no checkpoint → absent
        ],
      }),
    );
    expect(v.sessions.map((s) => s.providerSessionId)).toEqual(['s2', 's1']); // lastAt desc
    const s2 = v.sessions[0]!;
    expect(s2.turnCount).toBe(1);
    expect('ctxPct' in s2).toBe(false);
    expect('ctx' in s2).toBe(false);
    const s1 = v.sessions[1]!;
    expect(s1.turnCount).toBe(2); // the OBSERVED-RESULT COUNT — num_turns is not even in the fact
    expect(s1.usd).toBe(0.5);
    expect(s1.lastAt).toBe('2026-08-04T04:02:00.000Z');
    expect(s1.ctxPct).toBe(62); // round(124000/200000·100)
    expect(s1.ctx).toEqual({ usedTokens: 124_000, maxTokens: 200_000 });
  });

  it('D2.8: unledgeredCount — each of the three conditions negated in its own direction', () => {
    const costed = (over: Partial<UsageSessionFact>): UsageSessionFact => ({
      providerSessionId: 'v',
      workOrderId: null,
      role: 'architect',
      costUsd: 2.08,
      startedAt: '2026-08-02T08:00:00.000Z',
      ...over,
    });
    expect(deriveUsageView(input({ sessions: [costed({})] })).unledgeredCount).toBe(1);
    // negation 1: the session STARTED out of window
    expect(
      deriveUsageView(input({ sessions: [costed({ startedAt: '2026-07-02T08:00:00.000Z' })] })).unledgeredCount,
    ).toBe(0);
    // negation 2: the cost was never observed (the honest no-claim interrupt)
    expect(deriveUsageView(input({ sessions: [costed({ costUsd: undefined })] })).unledgeredCount).toBe(0);
    // negation 3: the session HAS windowed rows
    expect(
      deriveUsageView(
        input({ rows: [row({ providerSessionId: 'v', usdDelta: 0.01 })], sessions: [costed({})] }),
      ).unledgeredCount,
    ).toBe(0);
  });

  it('D2.3: the role-orphan row — totals yes, byRole no, roleUnknownCount > 0', () => {
    const v = deriveUsageView(
      input({
        rows: [
          row({ providerSessionId: 'orphan', workOrderId: wo('w1'), usdDelta: 0.7, tokensIn: 700, tokensOut: 70, model: 'glm-5.3' }),
          row({ providerSessionId: 'known', workOrderId: wo('w1'), usdDelta: 0.3 }),
        ],
        sessions: [session({ providerSessionId: 'known', workOrderId: wo('w1'), role: 'implementer' })],
        orders: [{ id: wo('w1'), title: 'T' }],
      }),
    );
    expect(v.totals.usd).toBe(1.0); // both rows count
    expect(v.byRole.map((b) => b.role)).toEqual(['implementer']);
    expect(v.roleUnknownCount).toBe(1);
    // the orphan's money still lands in byModel through the row scalars — never silently dropped
    expect(v.byModel.find((b) => b.model === 'glm-5.3')!.usd).toBe(0.7);
  });

  it('D2.3: a session fact whose own role is absent — the row paints no bucket, still role-unknown', () => {
    const v = deriveUsageView(
      input({
        rows: [row({ providerSessionId: 'nul', usdDelta: 0.2 })],
        sessions: [session({ providerSessionId: 'nul' })], // the row's own role column is NULL (legacy vintage)
      }),
    );
    expect(v.byRole).toEqual([]);
    expect(v.roleUnknownCount).toBe(1);
    expect(v.draft).toEqual({ usd: 0.2, tokensIn: 100, tokensOut: 10, sessionCount: 1 });
  });

  it('D2.3/D2.5: the order-orphan (session gone too) — the same counter, workOrders empty', () => {
    const v = deriveUsageView(
      input({
        rows: [row({ providerSessionId: 'dead', workOrderId: wo('w9'), usdDelta: 0.9 })],
        // the deleted owner took the session row AND the work_order row with it (the cascade)
        sessions: [],
        orders: [],
      }),
    );
    expect(v.totals.usd).toBe(0.9);
    expect(v.workOrders).toEqual([]);
    expect(v.roleUnknownCount).toBe(1);
    expect(v.byModel).toEqual([{ model: undefined, usd: 0.9, tokensIn: 100, tokensOut: 10 }]);
  });
});
