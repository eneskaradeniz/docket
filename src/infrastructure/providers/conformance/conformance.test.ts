// Conformance suite (docs/v2/providers.md → P-35): the same scenarios run against every built-in
// provider definition, each through the real transport factory and the definition's own argument
// builder, with the transport's scripted fake standing in for the CLI. Adding a definition to the
// built-ins adds it here with no edit. A scenario may be marked not applicable for a definition
// only with a reason string, which the test prints; a reason that starts with "bug:" records a
// production defect the scenario reproduces, and the scenario is then required to still fail so
// the entry cannot outlive the fix.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS, type ProviderDef } from '../defs/index';
import {
  PROMPT_SENTINEL,
  createLegs,
  hasFake,
  type Leg,
  type ScenarioId,
} from './legs';

const SCENARIOS: Readonly<Record<ScenarioId, string>> = {
  launch: 'launch keeps the prompt out of argv and delivers it to the agent',
  mapping: 'maps text, tool call/result, usage and finished to AgentEvents',
  permission: 'permission ask waits for the answer',
  resume: 'resumes per the definition resume mode',
  stop: 'stop takes the whole process group down',
  watchdog: 'watchdogs stay quiet on a steady stream',
};

/** Per-definition exemptions. A reason is mandatory; "bug: …" marks a defect the scenario reproduces. */
const NOT_APPLICABLE: Readonly<Record<string, Partial<Record<ScenarioId, string>>>> = {
  agy: {
    resume:
      'bug: buildLaunch ignores LaunchInput.resume although the definition declares resume "specify", so a resumed run silently starts a fresh conversation',
  },
};

/** Exemptions the definition's own data implies. */
const derivedReason = (def: ProviderDef, scenario: ScenarioId): string | undefined => {
  if (scenario === 'permission' && def.capabilities.permissionAsk !== true) {
    return `definition declares permissionAsk=${String(def.capabilities.permissionAsk)}, so the CLI raises no ask to wait on`;
  }
  if (scenario === 'resume' && (def.resume === 'none' || def.resume === 'capture')) {
    return `definition resume mode is "${def.resume}": nothing is passed to the CLI to resume with`;
  }
  return undefined;
};

const reasonFor = (def: ProviderDef, scenario: ScenarioId): string | undefined =>
  NOT_APPLICABLE[def.id]?.[scenario] ?? derivedReason(def, scenario);

// --- event helpers ----------------------------------------------------------------------------

const sleep = (ms: number): Promise<'timeout'> =>
  new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms);
  });

interface Reader {
  readonly next: (ms: number) => Promise<AgentEvent | 'timeout' | 'end'>;
}

/** Pulls events one at a time; a timed-out wait keeps its pending pull, so no event is ever lost. */
const readerOf = (events: AsyncIterable<AgentEvent>): Reader => {
  const iterator = events[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<AgentEvent>> | undefined;
  return {
    next: async (ms) => {
      pending ??= iterator.next();
      const raced = await Promise.race([pending, sleep(ms)]);
      if (raced === 'timeout') return 'timeout';
      pending = undefined;
      return raced.done === true ? 'end' : raced.value;
    },
  };
};

const GENEROUS_MS = 15_000;

const drain = async (reader: Reader): Promise<readonly AgentEvent[]> => {
  const events: AgentEvent[] = [];
  for (;;) {
    const next = await reader.next(GENEROUS_MS);
    if (next === 'timeout') throw new Error(`the stream stalled after: ${events.map((e) => e.type).join(', ')}`);
    if (next === 'end') return events;
    events.push(next);
  }
};

const readUntil = async (reader: Reader, type: AgentEvent['type']): Promise<readonly AgentEvent[]> => {
  const events: AgentEvent[] = [];
  for (;;) {
    const next = await reader.next(GENEROUS_MS);
    if (next === 'timeout' || next === 'end') {
      throw new Error(`no ${type} event; saw: ${events.map((e) => e.type).join(', ')}`);
    }
    events.push(next);
    if (next.type === type) return events;
  }
};

const finishedOf = (events: readonly AgentEvent[]): readonly Extract<AgentEvent, { type: 'finished' }>[] =>
  events.filter((event): event is Extract<AgentEvent, { type: 'finished' }> => event.type === 'finished');

const expectOneFinished = (events: readonly AgentEvent[], reason: 'completed' | 'cancelled'): void => {
  expect(finishedOf(events).map((event) => event.reason)).toEqual([reason]);
  expect(events[events.length - 1]?.type).toBe('finished');
};

// --- the scenarios ----------------------------------------------------------------------------

const SCENARIO_RUNS: Readonly<Record<ScenarioId, (leg: Leg) => Promise<void>>> = {
  launch: async (leg) => {
    const run = await leg.start('happy');
    await drain(readerOf(run.handle.events));
    // The prompt reaches the agent through stdin, the input envelope or the protocol — never argv.
    expect(run.received()).toContain(PROMPT_SENTINEL);
    expect(run.launchText()).not.toContain('PROMPT-SENTINEL');
    const argv = run.argv();
    if (argv !== undefined) {
      // The definition's own argument builder produced the launch, not a test stand-in.
      const expected = leg.def.buildLaunch({ prompt: PROMPT_SENTINEL, configDir: '/unused' }).args;
      for (const arg of expected) expect(argv).toContain(arg);
    }
  },

  mapping: async (leg) => {
    const run = await leg.start('happy');
    const events = await drain(readerOf(run.handle.events));
    const types = events.map((event) => event.type);
    for (const type of ['session_started', 'text', 'tool_call', 'tool_result', 'usage'] as const) {
      expect(types, `${leg.def.id} must deliver ${type}`).toContain(type);
    }
    const call = events.find((event) => event.type === 'tool_call');
    const result = events.find((event) => event.type === 'tool_result');
    if (call?.type !== 'tool_call' || result?.type !== 'tool_result') throw new Error('tool events missing');
    expect(result.id).toBe(call.id);
    expect(result.ok).toBe(true);
    const usage = events.find((event) => event.type === 'usage');
    if (usage?.type !== 'usage') throw new Error('usage event missing');
    expect(usage.inputTokens + usage.outputTokens).toBeGreaterThan(0);
    const text = events.filter((event) => event.type === 'text');
    expect(text.length).toBeGreaterThan(0);
    expectOneFinished(events, 'completed');
  },

  permission: async (leg) => {
    const run = await leg.start('permission');
    const reader = readerOf(run.handle.events);
    const before = await readUntil(reader, 'permission_ask');
    const ask = before[before.length - 1];
    if (ask?.type !== 'permission_ask') throw new Error('ask missing');
    // Nothing is auto-answered: with the ask open, the run neither finishes nor proceeds.
    expect(await reader.next(500)).toBe('timeout');
    run.handle.answerPermission(ask.id, 'allow');
    const after = await drain(reader);
    expectOneFinished([...before, ...after], 'completed');
  },

  resume: async (leg) => {
    const ref = 'sess_resume_ref_1';
    const run = await leg.start('resume', { resume: ref });
    const events = await drain(readerOf(run.handle.events));
    if (leg.def.resume === 'specify') {
      expect(run.resumeInLaunch(ref), 'the session ref must reach the launch').toBe(true);
    } else {
      expect(run.received(), 'the session ref must travel in the protocol').toContain(ref);
    }
    expectOneFinished(events, 'completed');
  },

  stop: async (leg) => {
    const run = await leg.start('hang');
    const reader = readerOf(run.handle.events);
    const before = await readUntil(reader, 'text');
    await run.handle.stop();
    const after = await drain(reader);
    expectOneFinished([...before, ...after], 'cancelled');
    // Spawned legs: the leader and a child in its group are both gone. SDK leg: the session was aborted.
    expect(await run.gone()).toBe(true);
  },

  watchdog: async (leg) => {
    // First-output stays generous so a slow spawn is not the thing under test; the inactivity
    // limit is shorter than the whole stream but longer than any gap in it.
    const inactivityMs = 1000;
    const tight: ProviderDef = { ...leg.def, firstOutputTimeoutMs: 5000, inactivityTimeoutMs: inactivityMs };
    const started = Date.now();
    const run = await leg.start('steady', { def: tight });
    const events = await drain(readerOf(run.handle.events));
    expect(Date.now() - started, 'the stream must outlast the limit for the test to mean anything').toBeGreaterThan(
      inactivityMs,
    );
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
    expectOneFinished(events, 'completed');
  },
};

// --- the table --------------------------------------------------------------------------------

let root = '';
let legs: readonly Leg[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-conformance-'));
  legs = createLegs(root, BUILTIN_PROVIDER_DEFS.filter(hasFake));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const legOf = (def: ProviderDef): Leg => {
  const leg = legs.find((candidate) => candidate.def.id === def.id);
  if (leg === undefined) throw new Error(`no conformance leg for ${def.id}`);
  return leg;
};

describe.concurrent('P-35: conformance of every built-in definition', () => {
  it('P-35: every built-in definition has a scripted fake to run against', () => {
    const missing = BUILTIN_PROVIDER_DEFS.filter((def) => !hasFake(def)).map(
      (def) => `${def.id} (${def.transport}${def.streamDialect === undefined ? '' : `/${def.streamDialect}`})`,
    );
    expect(missing, 'add a fake for the transport or dialect in conformance/legs.ts').toEqual([]);
  });

  it('P-35: every exemption names a built-in definition and a scenario, with a reason', () => {
    const ids = new Set(BUILTIN_PROVIDER_DEFS.map((def) => def.id));
    for (const [id, scenarios] of Object.entries(NOT_APPLICABLE)) {
      expect(ids.has(id), `exemption for unknown definition ${id}`).toBe(true);
      for (const [scenario, reason] of Object.entries(scenarios)) {
        expect(Object.keys(SCENARIOS), `exemption for unknown scenario ${scenario}`).toContain(scenario);
        expect(reason?.trim() ?? '', `exemption ${id}/${scenario} needs a reason`).not.toBe('');
      }
    }
  });

  for (const def of BUILTIN_PROVIDER_DEFS) {
    for (const scenario of Object.keys(SCENARIOS) as ScenarioId[]) {
      const reason = reasonFor(def, scenario);
      if (reason === undefined) {
        it(`P-35: ${def.id} ${SCENARIOS[scenario]}`, async () => {
          await SCENARIO_RUNS[scenario](legOf(def));
        });
        continue;
      }
      it(`P-35: ${def.id} ${SCENARIOS[scenario]} — n/a: ${reason}`, async () => {
        console.info(`P-35 n/a ${def.id}/${scenario}: ${reason}`);
        if (reason.startsWith('bug:')) {
          await expect(SCENARIO_RUNS[scenario](legOf(def)), 'the bug no longer reproduces: drop the exemption').rejects.toThrow();
        }
      });
    }
  }
});
