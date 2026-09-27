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

interface UsageScript {
  readonly payload?: unknown; // the resolved get_usage value
  readonly rejects?: boolean; // getUsage throws instead
}

const makeProbe = (scripts: readonly UsageScript[]): {
  readonly probe: ReturnType<typeof createClaudeUsageProbe>;
  readonly calls: readonly (string | null)[];
} => {
  const calls: (string | null)[] = [];
  const queue = [...scripts];
  const getUsage: GetUsage = async (binPath) => {
    calls.push(binPath);
    const script = queue.shift();
    if (script === undefined) throw new Error('no scripted usage left');
    if (script.rejects === true) throw new Error('the usage call failed');
    return script.payload;
  };
  return { probe: createClaudeUsageProbe({ getUsage, now: () => NOW }), calls };
};

const pollOk = async (
  probe: ReturnType<typeof createClaudeUsageProbe>,
  binPath: string | null = '/fake/claude-bin',
) => {
  const result = await probe.poll('claude-code', binPath);
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

    const result = await probe.poll('claude-code', '/fake/claude-bin');

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-21: a payload with nothing usable reports probe_failed', async () => {
    const { probe } = makeProbe([
      { payload: makePayload({ five_hour: null, seven_day: { utilization: null, resets_at: null } }) },
      { payload: 'not an object' },
    ]);

    expect(await probe.poll('claude-code', null)).toEqual({ ok: false, error: 'probe_failed' });
    expect(await probe.poll('claude-code', null)).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-21: a failing usage call reports probe_failed', async () => {
    const { probe } = makeProbe([{ rejects: true }]);

    const result = await probe.poll('claude-code', '/fake/claude-bin');

    expect(result).toEqual({ ok: false, error: 'probe_failed' });
  });

  it('P-21: a foreign provider id is refused without calling the usage source', async () => {
    const { probe, calls } = makeProbe([{ payload: makePayload(FULL_RATE_LIMITS) }]);

    const result = await probe.poll('codex', '/fake/claude-bin');

    expect(result).toEqual({ ok: false, error: 'unknown_provider' });
    expect(calls).toEqual([]);
  });
});
