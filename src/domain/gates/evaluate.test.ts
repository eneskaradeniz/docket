import { describe, expect, it } from 'vitest';
import type { GateDef } from '../definitions';
import type { Actor, GateSlug, RoleSlug } from '../shared';
import { evaluateGate, GATE_EVALUATORS, type GateContext, type GateEvidence, type GateVerdict } from './evaluate';

const USER: Actor = { kind: 'user', id: 'u-1' };

const gate = (id: string): GateSlug => id as GateSlug;

const HUMAN: GateDef = { kind: 'human', id: gate('plan-approval'), label: 'Plan onayı' };
const PAGE: GateDef = { kind: 'page_approval', id: gate('findings'), label: 'Bulgular' };
const COMMAND: GateDef = { kind: 'command', id: gate('tests'), commandSet: 'tests' };
const SECRET_SCAN: GateDef = { kind: 'secret_scan', id: gate('secrets') };
const AGENT_VERDICT: GateDef = { kind: 'agent_verdict', id: gate('review-verdict'), role: 'reviewer' as RoleSlug };

const CTX: GateContext = {
  commandSets: {
    tests: ['npm test', 'npm run lint'],
    empty: [],
  },
};

const approved = (by: Actor = USER): GateEvidence['approval'] => ({ decision: 'approved', by });
const rejected = (note?: string): GateEvidence['approval'] => ({ decision: 'rejected', by: USER, note });

const run = (gateDef: GateDef, evidence: GateEvidence, ctx: GateContext = CTX): GateVerdict =>
  evaluateGate(gateDef, evidence, ctx);

const viaRegistry = <K extends GateDef['kind']>(
  gateDef: Extract<GateDef, { kind: K }>,
  evidence: GateEvidence,
  ctx: GateContext = CTX,
): GateVerdict => GATE_EVALUATORS[gateDef.kind](gateDef, evidence, ctx);

describe('GATE_EVALUATORS', () => {
  it('has exactly one entry per GateDef kind', () => {
    expect(Object.keys(GATE_EVALUATORS).sort()).toEqual(
      ['agent_verdict', 'command', 'human', 'page_approval', 'secret_scan'],
    );
  });

  it('R-12: every kind is reachable through the registry, matching evaluateGate', () => {
    const evidence: GateEvidence = { approval: approved() };
    for (const gateDef of [HUMAN, PAGE, COMMAND, SECRET_SCAN, AGENT_VERDICT] as const) {
      expect(viaRegistry(gateDef, evidence)).toEqual(run(gateDef, evidence));
    }
  });
});

describe('evaluateGate — human (R-12)', () => {
  it('R-12: no approval decision is pending', () => {
    expect(run(HUMAN, {})).toEqual({ status: 'pending' });
    expect(run(HUMAN, { secretScan: { findings: 0 } })).toEqual({ status: 'pending' });
  });

  it('R-12: approved passes', () => {
    expect(run(HUMAN, { approval: approved() })).toEqual({ status: 'passed' });
  });

  it('R-12: rejected fails with the note', () => {
    expect(run(HUMAN, { approval: rejected('diff too large') })).toEqual({
      status: 'failed',
      reason: 'diff too large',
    });
  });

  it('R-12: rejected without a note fails with "rejected"', () => {
    expect(run(HUMAN, { approval: rejected() })).toEqual({ status: 'failed', reason: 'rejected' });
  });

  it('R-12: a human gate ignores page approval evidence', () => {
    expect(run(HUMAN, { pageApproval: { decision: 'approved', by: USER } })).toEqual({ status: 'pending' });
  });
});

describe('evaluateGate — page_approval (R-12)', () => {
  it('R-12: no decision is pending, even with a human approval recorded', () => {
    expect(run(PAGE, {})).toEqual({ status: 'pending' });
    expect(run(PAGE, { approval: approved() })).toEqual({ status: 'pending' });
  });

  it('R-12: approved passes', () => {
    expect(run(PAGE, { pageApproval: { decision: 'approved', by: USER } })).toEqual({ status: 'passed' });
  });

  it('R-12: rejected fails with "rejected"', () => {
    expect(run(PAGE, { pageApproval: { decision: 'rejected', by: USER } })).toEqual({
      status: 'failed',
      reason: 'rejected',
    });
  });
});

describe('evaluateGate — command (R-13)', () => {
  const AB: GateContext = { commandSets: { ab: ['cmd-a', 'cmd-b'] } };
  const COMMAND_AB: GateDef = { kind: 'command', id: gate('ab'), commandSet: 'ab' };

  it('R-13: a missing result for any command is pending', () => {
    expect(run(COMMAND, {})).toEqual({ status: 'pending' });
    expect(run(COMMAND, { commands: {} })).toEqual({ status: 'pending' });
    expect(run(COMMAND, { commands: { 'npm test': { exitCode: 0 } } })).toEqual({ status: 'pending' });
  });

  it('R-13: an explicit undefined result is pending', () => {
    expect(run(COMMAND, { commands: { 'npm test': { exitCode: 0 }, 'npm run lint': undefined } })).toEqual({
      status: 'pending',
    });
  });

  it('R-13: order-independent — a failed command fails the gate even though an earlier command has no result yet', () => {
    const verdict = run(COMMAND_AB, { commands: { 'cmd-b': { exitCode: 1 } } }, AB);
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'failed') expect(verdict.reason).toContain('cmd-b');
  });

  it('R-13: order-independent — a failed command fails the gate even though a later command has no result', () => {
    const verdict = run(COMMAND_AB, { commands: { 'cmd-a': { exitCode: 1 } } }, AB);
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'failed') expect(verdict.reason).toContain('cmd-a');
  });

  it('R-13: a non-zero exit fails naming the command', () => {
    const verdict = run(COMMAND, {
      commands: { 'npm test': { exitCode: 0 }, 'npm run lint': { exitCode: 2 } },
    });
    expect(verdict.status).toBe('failed');
    expect(verdict).toMatchObject({ status: 'failed' });
    if (verdict.status === 'failed') expect(verdict.reason).toContain('npm run lint');
  });

  it('R-13: the first failing command in set order is named, not the first result that arrived', () => {
    const verdict = run(COMMAND, {
      commands: { 'npm run lint': { exitCode: 3 }, 'npm test': { exitCode: 1 } },
    });
    expect(verdict).toMatchObject({ status: 'failed' });
    if (verdict.status === 'failed') {
      expect(verdict.reason).toContain('npm test');
      expect(verdict.reason).not.toContain('lint');
    }
  });

  it('R-13: with every command failing, the first failing command in set order is named', () => {
    const verdict = run(COMMAND_AB, { commands: { 'cmd-a': { exitCode: 1 }, 'cmd-b': { exitCode: 2 } } }, AB);
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'failed') {
      expect(verdict.reason).toContain('cmd-a');
      expect(verdict.reason).toContain('1');
    }
  });

  it('R-13: all zero exits pass', () => {
    expect(
      run(COMMAND, { commands: { 'npm test': { exitCode: 0 }, 'npm run lint': { exitCode: 0 } } }),
    ).toEqual({ status: 'passed' });
  });

  it('R-13: results for commands outside the set are ignored', () => {
    expect(
      run(COMMAND, {
        commands: { 'npm test': { exitCode: 0 }, 'npm run lint': { exitCode: 0 }, other: { exitCode: 1 } },
      }),
    ).toEqual({ status: 'passed' });
  });

  it('R-13: an unknown command set is unknown', () => {
    const other: GateDef = { kind: 'command', id: gate('mystery'), commandSet: 'no-such-set' };
    const verdict = run(other, { commands: {} });
    expect(verdict.status).toBe('unknown');
    if (verdict.status === 'unknown') expect(verdict.reason).toContain('no-such-set');
  });

  it('R-13: an empty command set is unknown', () => {
    const nothing: GateDef = { kind: 'command', id: gate('nothing'), commandSet: 'empty' };
    expect(run(nothing, {})).toMatchObject({ status: 'unknown' });
  });
});

describe('evaluateGate — secret_scan (R-14)', () => {
  it('R-14: missing scan result is pending', () => {
    expect(run(SECRET_SCAN, {})).toEqual({ status: 'pending' });
  });

  it('R-14: zero findings passes', () => {
    expect(run(SECRET_SCAN, { secretScan: { findings: 0 } })).toEqual({ status: 'passed' });
  });

  it('R-14: a positive findings count fails', () => {
    const one = run(SECRET_SCAN, { secretScan: { findings: 1 } });
    expect(one).toMatchObject({ status: 'failed' });
    const many = run(SECRET_SCAN, { secretScan: { findings: 7 } });
    expect(many).toMatchObject({ status: 'failed' });
    if (many.status === 'failed') expect(many.reason).toContain('7');
  });
});

describe('evaluateGate — agent_verdict (R-15)', () => {
  it('R-15: missing verdict is pending', () => {
    expect(run(AGENT_VERDICT, {})).toEqual({ status: 'pending' });
  });

  it('R-15: approve with resolved pointers passes', () => {
    expect(run(AGENT_VERDICT, { agentVerdict: { approve: true, pointersResolved: true } })).toEqual({
      status: 'passed',
    });
  });

  it('R-15: approve with unresolved pointers is unknown with the fixed reason', () => {
    expect(run(AGENT_VERDICT, { agentVerdict: { approve: true, pointersResolved: false } })).toEqual({
      status: 'unknown',
      reason: 'evidence pointers did not resolve',
    });
  });

  it('R-15: no approve fails regardless of pointer resolution', () => {
    expect(run(AGENT_VERDICT, { agentVerdict: { approve: false, pointersResolved: true } })).toMatchObject({
      status: 'failed',
    });
    expect(run(AGENT_VERDICT, { agentVerdict: { approve: false, pointersResolved: false } })).toMatchObject({
      status: 'failed',
    });
  });
});

describe('evaluateGate — unknown handling (R-16)', () => {
  it('R-16: unknown never counts as passed', () => {
    const unknownProducing: readonly GateVerdict[] = [
      run({ kind: 'command', id: gate('nothing'), commandSet: 'empty' }, {}),
      run({ kind: 'command', id: gate('mystery'), commandSet: 'no-such-set' }, {}),
      run(AGENT_VERDICT, { agentVerdict: { approve: true, pointersResolved: false } }),
    ];
    for (const verdict of unknownProducing) {
      expect(verdict.status).toBe('unknown');
      expect(verdict).not.toEqual({ status: 'passed' });
    }
  });
});

describe('evaluateGate — purity', () => {
  it('does not mutate the gate, the evidence, or the context', () => {
    const gateDef: GateDef = { kind: 'command', id: gate('tests'), commandSet: 'tests' };
    const evidence: GateEvidence = {
      commands: { 'npm test': { exitCode: 0 } },
      agentVerdict: { approve: true, pointersResolved: false },
      approval: rejected('keep me'),
    };
    const context: GateContext = { commandSets: { tests: ['npm test', 'npm run lint'] } };
    const gateSnapshot = structuredClone(gateDef) as unknown as GateDef;
    const evidenceSnapshot = structuredClone(evidence) as unknown as GateEvidence;
    const ctxSnapshot = structuredClone(context) as unknown as GateContext;

    run(gateDef, evidence, context);

    expect(gateDef).toEqual(gateSnapshot);
    expect(evidence).toEqual(evidenceSnapshot);
    expect(context).toEqual(ctxSnapshot);
  });
});
