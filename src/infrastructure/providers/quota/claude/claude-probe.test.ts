// Claude Code quota probe tests — rule P-21 (docs/v2/providers.md → "Quota probes"). The
// get_usage source is injected; its fixtures mirror the SDK's get_usage response shape as
// documented in docs/v2/quota.md (provider notes table and the scale pitfall). The pushed
// rate_limit_event counterpart comes from the sdk transport's own mapping, so the scale test
// pins both sources to one meter scale.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import type { EpochMs } from '../../../../domain/index';
import { mapSdkMessage } from '../../transports/sdk/map-message';
import { createClaudeUsageProbe, type GetUsage } from './claude-probe';

const NOW = 1_790_000_000_000 satisfies EpochMs;

// The subscription part of the SDK's get_usage response; session fields carry nothing the
// probe maps and stay out of the fixture.
const makePayload = (rateLimits: unknown, overrides: { readonly subscriptionType?: string | null } = {}) => ({
  session: { total_cost_usd: 0 },
  subscription_type: overrides.subscriptionType === undefined ? 'max' : overrides.subscriptionType,
  rate_limits_available: rateLimits !== null,
  rate_limits: rateLimits,
});

const FULL_RATE_LIMITS = {
  five_hour: { utilization: 65, resets_at: '2026-09-29T15:24:06Z' },
  seven_day: { utilization: 12.5, resets_at: '2026-10-03T00:00:00Z' },
  seven_day_opus: { utilization: 40, resets_at: '2026-10-03T00:00:00Z' },
  seven_day_sonnet: { utilization: 8, resets_at: '2026-10-03T00:00:00Z' },
};

// SYNTHETIC payload (not a recording): the model-scoped and extra-usage sections as the SDK's
// own get_usage type documents them — one bucket the data table knows ('Fable'), one it does
// not ('Orca'), and an enabled credits section. Real recordings join this file only after a
// live probe captures them.
const SYNTHETIC_RATE_LIMITS = {
  five_hour: { utilization: 30, resets_at: '2026-10-02T12:00:00Z' },
  model_scoped: [
    { display_name: 'Fable', utilization: 12, resets_at: '2026-10-05T00:00:00Z' },
    { display_name: 'Orca', utilization: 40, resets_at: null },
  ],
  extra_usage: { is_enabled: true, monthly_limit: 5, used_credits: 1, utilization: 20 },
};

interface UsageScript {
  readonly payload?: unknown; // the resolved get_usage value
  readonly rejects?: boolean; // getUsage throws instead
}

const makeProbe = (scripts: readonly UsageScript[]): {
  readonly probe: ReturnType<typeof createClaudeUsageProbe>;
  readonly calls: readonly (string | null)[];
  readonly notes: string[];
} => {
  const calls: (string | null)[] = [];
  const notes: string[] = [];
  const queue = [...scripts];
  const getUsage: GetUsage = async (binPath) => {
    calls.push(binPath);
    const script = queue.shift();
    if (script === undefined) throw new Error('no scripted usage left');
    if (script.rejects === true) throw new Error('the usage call failed');
    return script.payload;
  };
  return { probe: createClaudeUsageProbe({ getUsage, now: () => NOW, note: (m) => notes.push(m) }), calls, notes };
};

const pollOk = async (
  probe: ReturnType<typeof createClaudeUsageProbe>,
  binPath: string | null = '/fake/claude-bin',
) => {
  const result = await probe.poll('claude-code', binPath, { accountId: null, identityDir: null });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
};

describe('createClaudeUsageProbe', () => {
  it('P-21: get_usage utilization is 0–100 and normalises to the same meter scale a pushed rate_limit_event uses', async () => {
    const { probe } = makeProbe([{ payload: makePayload(FULL_RATE_LIMITS) }]);

    const readings = await pollOk(probe);

    // five_hour and seven_day are the account pool's windows; the pool label is the
    // subscription type, verbatim.
    const fiveHour = readings.find((reading) => reading.meter.label === 'five_hour');
    expect(fiveHour?.pool).toEqual({ label: 'max', kind: 'allowance', appliesTo: 'all' });
    expect(fiveHour?.meter).toMatchObject({ unit: 'fraction', used: 0.65, limit: 1, remaining: 0.35 });
    const sevenDay = readings.find((reading) => reading.meter.label === 'seven_day');
    expect(sevenDay?.meter).toMatchObject({ used: 0.125, limit: 1, remaining: 0.875 });

    // The pushed rate_limit_event reports the same window at utilization 0.65 (0–1); its meter
    // must land on exactly the scale the polled 65% landed on.
    const pushed = mapSdkMessage(
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.65 },
        uuid: '00000000-0000-4000-8000-000000000000',
        session_id: 'sess_1',
      } as SDKMessage,
      NOW,
      { costKind: 'equivalent' },
    );
    const pushedMeter = pushed.find((event) => event.type === 'quota_signal');
    if (pushedMeter?.type !== 'quota_signal') throw new Error('unreachable');
    expect(pushedMeter.meter.used).toBe(fiveHour?.meter.used);
  });

  it('P-21: resets are exact — the ISO resets_at of this poll becomes resetsAt in milliseconds', async () => {
    const { probe } = makeProbe([{ payload: makePayload(FULL_RATE_LIMITS) }]);

    const readings = await pollOk(probe);

    const fiveHour = readings.find((reading) => reading.meter.label === 'five_hour');
    expect(fiveHour?.meter.resetsAt).toBe(Date.parse('2026-09-29T15:24:06Z'));
    expect(fiveHour?.meter.resetPrecision).toBe('exact');

    // A window without a usable reset keeps its exact reading but states no reset.
    const partialProbe = makeProbe([{ payload: makePayload({ five_hour: { utilization: 65 } }) }]).probe;
    const partial = await pollOk(partialProbe);
    const partialFiveHour = partial.find((reading) => reading.meter.label === 'five_hour');
    expect('resetsAt' in (partialFiveHour?.meter ?? {})).toBe(false);
    expect(partialFiveHour?.meter.resetPrecision).toBe('unknown');
  });

  it('P-21: a stored resetsAt is never trusted — each poll reports only its own payload, even when resets move earlier', async () => {
    const { probe } = makeProbe([
      { payload: makePayload({ five_hour: { utilization: 65, resets_at: '2026-09-29T15:24:06Z' } }) },
      { payload: makePayload({ five_hour: { utilization: 20, resets_at: '2026-09-27T10:00:00Z' } }) },
    ]);

    const first = await pollOk(probe);
    const second = await pollOk(probe);

    const firstReset = first.find((reading) => reading.meter.label === 'five_hour')?.meter.resetsAt;
    const secondReset = second.find((reading) => reading.meter.label === 'five_hour')?.meter.resetsAt;
    expect(firstReset).toBe(Date.parse('2026-09-29T15:24:06Z'));
    // The reset moved earlier; the second poll must carry the new value, never the stored one.
    expect(secondReset).toBe(Date.parse('2026-09-27T10:00:00Z'));
    expect(secondReset === firstReset).toBe(false);
  });

  it('P-21: per-model-family seven-day windows land in their own pools scoped to the model family', async () => {
    const { probe } = makeProbe([{ payload: makePayload(FULL_RATE_LIMITS) }]);

    const readings = await pollOk(probe);

    const opus = readings.find((reading) => reading.pool.label === 'seven_day_opus');
    expect(opus?.pool).toEqual({ label: 'seven_day_opus', kind: 'allowance', appliesTo: [{ prefix: 'claude-opus' }] });
    expect(opus?.meter).toMatchObject({ label: 'seven_day', unit: 'fraction', used: 0.4, resetPrecision: 'exact' });
    const sonnet = readings.find((reading) => reading.pool.label === 'seven_day_sonnet');
    expect(sonnet?.pool).toEqual({ label: 'seven_day_sonnet', kind: 'allowance', appliesTo: [{ prefix: 'claude-sonnet' }] });
  });

  it('P-21: a payload with no subscription type pools the account windows under the fallback label', async () => {
    const { probe } = makeProbe([
      { payload: makePayload({ five_hour: { utilization: 10, resets_at: '2026-09-29T15:24:06Z' } }, { subscriptionType: null }) },
    ]);

    const readings = await pollOk(probe);

    expect(readings).toHaveLength(1);
    expect(readings[0]?.pool.label).toBe('account');
  });

  it('P-21: plan limits that do not apply (rate_limits null) report a failed probe, not invented meters', async () => {
    const { probe } = makeProbe([{ payload: makePayload(null) }]);

    const result = await probe.poll('claude-code', '/fake/claude-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-21: a payload with nothing usable reports probe_failed', async () => {
    const { probe } = makeProbe([
      { payload: makePayload({ five_hour: null, seven_day: { utilization: null, resets_at: null } }) },
      { payload: 'not an object' },
    ]);

    expect(await probe.poll('claude-code', null, { accountId: null, identityDir: null })).toEqual({ ok: false, error: 'probe_failed' });
    expect(await probe.poll('claude-code', null, { accountId: null, identityDir: null })).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-21: a failing usage call reports probe_failed', async () => {
    const { probe } = makeProbe([{ rejects: true }]);

    const result = await probe.poll('claude-code', '/fake/claude-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-21: a foreign provider id is refused without calling the usage source', async () => {
    const { probe, calls } = makeProbe([{ payload: makePayload(FULL_RATE_LIMITS) }]);

    const result = await probe.poll('codex', '/fake/claude-bin', { accountId: null, identityDir: null });

    expect(result).toEqual({ ok: false, error: 'unknown_provider' });
    expect(calls).toEqual([]);
  });

  it('P-39: a known model-scoped row becomes a pool scoped by the bucket table; an unknown one is informational', async () => {
    const { probe } = makeProbe([{ payload: makePayload(SYNTHETIC_RATE_LIMITS) }]);

    const readings = await pollOk(probe);

    // The display name is the pool label verbatim; the data table (not code) says which models
    // draw from it. The SDK documents model_scoped entries as per-model weekly windows, so the
    // meter label follows the existing weekly family windows.
    const fable = readings.find((reading) => reading.pool.label === 'Fable');
    expect(fable?.pool).toEqual({ label: 'Fable', kind: 'allowance', appliesTo: [{ prefix: 'claude-fable' }] });
    expect(fable?.meter).toMatchObject({
      label: 'seven_day',
      unit: 'fraction',
      used: 0.12,
      limit: 1,
      remaining: 0.88,
      resetsAt: Date.parse('2026-10-05T00:00:00Z'),
      resetPrecision: 'exact',
    });

    // A name the table does not know: shown for information, never routed to a model, never
    // blocking. A null reset simply states no reset.
    const orca = readings.find((reading) => reading.pool.label === 'Orca');
    expect(orca?.pool).toEqual({ label: 'Orca', kind: 'allowance', appliesTo: 'unknown' });
    expect(orca?.meter).toMatchObject({ label: 'seven_day', used: 0.4, resetPrecision: 'unknown' });
    expect('resetsAt' in (orca?.meter ?? {})).toBe(false);
  });

  it('P-39: an enabled extra-usage section becomes a credits balance pool', async () => {
    const { probe } = makeProbe([{ payload: makePayload(SYNTHETIC_RATE_LIMITS) }]);

    const readings = await pollOk(probe);

    const credits = readings.find((reading) => reading.pool.label === 'extra_usage');
    // Which models draw from the credits is plan-dependent and not in the payload, so the pool
    // stays informational ('unknown'); the counts are the provider's own credit unit.
    expect(credits?.pool).toEqual({ label: 'extra_usage', kind: 'balance', appliesTo: 'unknown' });
    expect(credits?.meter).toMatchObject({
      label: 'monthly',
      cadence: 'calendar',
      unit: 'credits',
      used: 1,
      limit: 5,
      remaining: 4,
      resetPrecision: 'unknown',
      source: 'polled',
    });
    expect('resetsAt' in (credits?.meter ?? {})).toBe(false);
  });

  it('P-39: a disabled extra-usage section creates no pool and reports a diagnostic note', async () => {
    const { probe, notes } = makeProbe([
      { payload: makePayload({ five_hour: { utilization: 30, resets_at: '2026-10-02T12:00:00Z' }, extra_usage: { is_enabled: false } }) },
    ]);

    const readings = await pollOk(probe);

    expect(readings.some((reading) => reading.pool.label === 'extra_usage')).toBe(false);
    expect(notes).toEqual(['extra_usage disabled: no credits pool']);
  });

  it('P-39: a model_scoped entry that cannot be labelled is ignored and counted in a note', async () => {
    const { probe, notes } = makeProbe([
      { payload: makePayload({
        five_hour: { utilization: 30, resets_at: '2026-10-02T12:00:00Z' },
        model_scoped: [{ display_name: 'Fable', utilization: 12, resets_at: null }, { utilization: 7, resets_at: null }],
      }) },
    ]);

    const readings = await pollOk(probe);

    expect(readings.filter((reading) => reading.meter.label === 'seven_day')).toHaveLength(1);
    expect(notes).toEqual(['ignored 1 unreadable model_scoped entries']);
  });

  it('P-39: an unreadable payload fails the probe and the diagnostic names field names, never values', async () => {
    const { probe, notes } = makeProbe([
      // Windows exist but none carries anything the meter can state.
      { payload: makePayload({ five_hour: null, seven_day: { utilization: null, resets_at: null } }) },
      // rate_limits itself is not the object the shape promises.
      { payload: { session: { total_cost_usd: 1.25 }, subscription_type: 'max', rate_limits: 'nope' } },
    ]);

    expect(await probe.poll('claude-code', null, { accountId: null, identityDir: null })).toEqual({ ok: false, error: 'probe_failed' });
    expect(await probe.poll('claude-code', null, { accountId: null, identityDir: null })).toEqual({ ok: false, error: 'probe_failed' });

    // Field names only: the note names the keys the payload carried, never their values.
    expect(notes[0]).toBe('get_usage payload unreadable; unrecognized fields: five_hour, seven_day');
    expect(notes[1]).toBe('get_usage payload unreadable; unrecognized fields: session, subscription_type, rate_limits');
  });
});
