// agy /usage parser tests — rule P-19 (docs/v2/providers.md → "Quota probes"); the payload and
// the mapping are the observed ones from docs/v2/quota.md → "Observed: Antigravity /usage".
import { describe, expect, it } from 'vitest';

import type { MeterReading } from '../../../../application/index';

import { parseAgyUsage } from './usage-parser';

// --- fixtures ---------------------------------------------------------------------------------------

const OBSERVED_AT = 1_790_000_000_000;

const WEEKLY_RESET = Date.parse('2026-09-29T15:24:06Z');
const FIVE_HOUR_RESET = Date.parse('2026-09-26T19:17:25Z');

/** The observed print-mode payload (docs/v2/quota.md); elided fields are filled to the same shape. */
const PAYLOAD = `{
  "status": "SUCCESS", "num_turns": 0,
  "command": { "name": "usage", "data": { "description": "Usage and limits for the signed-in account.", "groups": [
    { "name": "Gemini Models", "description": "Models within this group: Gemini Flash, Gemini Pro",
      "buckets": [
        { "id": "gemini-weekly", "name": "Weekly Limit Remaining", "window": "weekly",
          "remaining_fraction": 0.6869, "reset_time": "2026-09-29T15:24:06Z", "description": "Remaining weekly allowance." },
        { "id": "gemini-5h", "name": "Five Hour Limit Remaining", "window": "5h",
          "remaining_fraction": 1, "reset_time": "2026-09-26T19:17:25Z" } ] },
    { "name": "Claude and GPT models",
      "description": "Models within this group: Claude Sonnet 4.5, Claude Opus 4.1, GPT 5.1",
      "buckets": [
        { "id": "3p-weekly", "name": "Weekly Limit Remaining", "window": "weekly",
          "remaining_fraction": 0.4231, "reset_time": "2026-09-29T15:24:06Z" },
        { "id": "3p-5h", "name": "Five Hour Limit Remaining", "window": "5h",
          "remaining_fraction": 0.9312, "reset_time": "2026-09-26T19:17:25Z" } ] } ] } },
  "response": "Gemini Models\\tWeekly Limit Remaining\\t0.6869\\nClaude and GPT models\\tWeekly Limit Remaining\\t0.4231"
}`;

const geminiPool: MeterReading['pool'] = {
  label: 'Gemini Models',
  kind: 'allowance',
  appliesTo: [{ exact: 'Gemini Flash' }, { exact: 'Gemini Pro' }],
};

const thirdPartyPool: MeterReading['pool'] = {
  label: 'Claude and GPT models',
  kind: 'allowance',
  appliesTo: [{ exact: 'Claude Sonnet 4.5' }, { exact: 'Claude Opus 4.1' }, { exact: 'GPT 5.1' }],
};

const EXPECTED_FROM_DOC: readonly MeterReading[] = [
  {
    pool: geminiPool,
    meter: {
      label: 'Weekly Limit Remaining',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      remaining: 0.6869,
      resetsAt: WEEKLY_RESET,
      resetPrecision: 'exact',
      observedAt: OBSERVED_AT,
      source: 'polled',
    },
  },
  {
    pool: geminiPool,
    meter: {
      label: 'Five Hour Limit Remaining',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      remaining: 1,
      resetsAt: FIVE_HOUR_RESET,
      resetPrecision: 'exact',
      observedAt: OBSERVED_AT,
      source: 'polled',
    },
  },
  {
    pool: thirdPartyPool,
    meter: {
      label: 'Weekly Limit Remaining',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      remaining: 0.4231,
      resetsAt: WEEKLY_RESET,
      resetPrecision: 'exact',
      observedAt: OBSERVED_AT,
      source: 'polled',
    },
  },
  {
    pool: thirdPartyPool,
    meter: {
      label: 'Five Hour Limit Remaining',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      remaining: 0.9312,
      resetsAt: FIVE_HOUR_RESET,
      resetPrecision: 'exact',
      observedAt: OBSERVED_AT,
      source: 'polled',
    },
  },
];

// --- the parser -------------------------------------------------------------------------------------

describe('parseAgyUsage', () => {
  it('P-19: maps the observed payload exactly — group to pool, bucket to meter', () => {
    expect(parseAgyUsage(PAYLOAD, '', OBSERVED_AT)).toEqual(EXPECTED_FROM_DOC);
  });

  it('P-19: the payload is read from stderr as well as stdout, even wrapped in other output', () => {
    // The observed probe run printed the payload on stderr; stdout alone is equally valid.
    expect(parseAgyUsage('', PAYLOAD, OBSERVED_AT)).toEqual(EXPECTED_FROM_DOC);
    expect(parseAgyUsage(`spinning up…\n${PAYLOAD}\ndone\n`, '', OBSERVED_AT)).toEqual(EXPECTED_FROM_DOC);
    expect(parseAgyUsage('warn: telemetry enabled', `${PAYLOAD}\n`, OBSERVED_AT)).toEqual(EXPECTED_FROM_DOC);
  });

  it('P-19: model matchers come only from the model list in the description, verbatim', () => {
    const payload = `{"command": { "name": "usage", "data": { "groups": [
      { "name": "Gemini Models", "description": "All included models, subject to change",
        "buckets": [ { "id": "gemini-weekly", "name": "Weekly Limit Remaining", "window": "weekly",
          "remaining_fraction": 0.5, "reset_time": "2026-09-29T15:24:06Z" } ] } ] } } }`;

    const readings = parseAgyUsage(payload, '', OBSERVED_AT);
    expect(readings).toHaveLength(1);
    // Neither the group name ("Gemini Models") nor the bucket id ("gemini-weekly") is a matcher
    // source: without a stated model list the pool applies to everything rather than to a guess.
    expect(readings?.[0]?.pool.appliesTo).toBe('all');
  });

  it('P-19: durationMs is never derived from the window name', () => {
    const readings = parseAgyUsage(PAYLOAD, '', OBSERVED_AT) ?? [];
    expect(readings).toHaveLength(4);
    for (const { meter } of readings) {
      // 'weekly' and '5h' are labels the CLI uses, not durations it asserts; a stated duration
      // would be a field of its own, and none exists in the observed payload.
      expect(meter.durationMs).toBeUndefined();
    }
  });

  it('P-19: no usable payload on either stream yields null', () => {
    expect(parseAgyUsage('', '', OBSERVED_AT)).toBeNull();
    expect(parseAgyUsage('agy: unknown command', 'error: boom', OBSERVED_AT)).toBeNull();
    // The tab-separated `response` rendering alone is ignored; only command.data.groups counts.
    expect(parseAgyUsage('"response": "Gemini Models\\t0.6869"', '', OBSERVED_AT)).toBeNull();
    // A command result that is not the usage command is not a usage payload.
    const status = `{"command": { "name": "status", "data": { "groups": [] } } }`;
    expect(parseAgyUsage(status, '', OBSERVED_AT)).toBeNull();
    // A usage answer with no groups carries nothing to persist.
    expect(parseAgyUsage(`{"command": { "name": "usage", "data": { "groups": [] } } }`, '', OBSERVED_AT)).toBeNull();
  });
});
