import { describe, expect, it } from 'vitest';
import type { EnvironmentDef, GateDef } from '../definitions';
import type { Actor, EnvSlug, GateSlug, RoleSlug, RunId } from '../shared';
import { evaluateGate, type CheckRunResult, type GateContext, type GateEvidence, type GateVerdict } from './evaluate';

const USER: Actor = { kind: 'user', id: 'u-1' };
const AGENT: Actor = { kind: 'agent', runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' as RunId, role: 'reviewer' as RoleSlug };
const SYSTEM: Actor = { kind: 'system', component: 'scheduler' };

const gate = (id: string): GateSlug => id as GateSlug;
const env = (id: string): EnvSlug => id as EnvSlug;

const DEPLOY: GateDef = { kind: 'deploy', id: gate('deploy-stg'), environment: env('stg') };
const REMOTE_CHECKS: GateDef = { kind: 'remote_checks', id: gate('ci'), required: 'all', timeoutMinutes: 10 };

const environment = (overrides: Partial<EnvironmentDef> = {}): EnvironmentDef => ({
  id: env('stg'),
  name: 'Staging',
  order: 1,
  deploy: 'deploy-stg',
  env: {},
  protected: false,
  ...overrides,
});

const OPEN_CTX: GateContext = { commandSets: {} };
const STG_CTX: GateContext = { commandSets: {}, environments: [environment()] };
const PROTECTED_CTX: GateContext = { commandSets: {}, environments: [environment({ protected: true })] };

type Deployment = NonNullable<GateEvidence['deployment']>;

const deployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  environment: env('stg'),
  commit: '9f8e7d6c',
  result: 'success',
  approvedBy: USER,
  ...overrides,
});

const remoteChecks = (
  status: NonNullable<GateEvidence['remoteChecks']>['status'],
  checks: readonly CheckRunResult[],
): GateEvidence => ({ remoteChecks: { status, checks } });

const check = (name: string, status: CheckRunResult['status']): CheckRunResult => ({ name, status });

const run = (gateDef: GateDef, evidence: GateEvidence, ctx: GateContext = STG_CTX): GateVerdict =>
  evaluateGate(gateDef, evidence, ctx);

describe('evaluateGate — deploy (E-6, E-7, E-8)', () => {
  it('E-6: the environment missing from ctx.environments is unknown, naming it', () => {
    const verdict = run(DEPLOY, { deployment: deployment() }, { commandSets: {}, environments: [environment({ id: env('prd') })] });
    expect(verdict.status).toBe('unknown');
    if (verdict.status === 'unknown') expect(verdict.reason).toContain('stg');
  });

  it('E-6: an absent environments field is unknown even with evidence present', () => {
    expect(run(DEPLOY, { deployment: deployment() }, OPEN_CTX)).toMatchObject({ status: 'unknown' });
  });

  it('E-6: an empty environments list is unknown', () => {
    expect(run(DEPLOY, { deployment: deployment() }, { commandSets: {}, environments: [] })).toMatchObject({ status: 'unknown' });
  });

  it('E-6: missing deployment evidence is pending, even with a human approval recorded', () => {
    expect(run(DEPLOY, {})).toEqual({ status: 'pending' });
    expect(run(DEPLOY, { approval: { decision: 'approved', by: USER } })).toEqual({ status: 'pending' });
  });

  it('E-6: a successful deployment passes', () => {
    expect(run(DEPLOY, { deployment: deployment() })).toEqual({ status: 'passed' });
  });

  it('E-6: a failed deployment fails with the environment id in the reason', () => {
    const verdict = run(DEPLOY, { deployment: deployment({ result: 'failed' }) });
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'failed') expect(verdict.reason).toContain('stg');
  });

  it('E-7: an agent approval is pending, even for a successful deployment', () => {
    expect(run(DEPLOY, { deployment: deployment({ approvedBy: AGENT }) })).toEqual({ status: 'pending' });
  });

  it('E-7: a system approval is pending too', () => {
    expect(run(DEPLOY, { deployment: deployment({ approvedBy: SYSTEM }) })).toEqual({ status: 'pending' });
  });

  it('E-8: a protected environment without a confirmedEnvironment is pending', () => {
    expect(run(DEPLOY, { deployment: deployment() }, PROTECTED_CTX)).toEqual({ status: 'pending' });
  });

  it('E-8: a protected environment with a different confirmedEnvironment is pending', () => {
    expect(run(DEPLOY, { deployment: deployment({ confirmedEnvironment: env('prd') }) }, PROTECTED_CTX)).toEqual({
      status: 'pending',
    });
  });

  it('E-8: a protected environment passes when the user typed the gate environment to confirm', () => {
    expect(run(DEPLOY, { deployment: deployment({ confirmedEnvironment: env('stg') }) }, PROTECTED_CTX)).toEqual({
      status: 'passed',
    });
  });

  it('E-8: a protected environment is pending even when the deployment failed', () => {
    expect(run(DEPLOY, { deployment: deployment({ result: 'failed' }) }, PROTECTED_CTX)).toEqual({ status: 'pending' });
  });

  it('E-8: an unprotected environment ignores the confirmation field', () => {
    expect(run(DEPLOY, { deployment: deployment({ confirmedEnvironment: env('prd') }) })).toEqual({ status: 'passed' });
  });
});

describe('evaluateGate — remote_checks (E-9)', () => {
  it('E-9: all_passed passes', () => {
    expect(run(REMOTE_CHECKS, remoteChecks('all_passed', [check('build', 'passed'), check('test', 'passed')]), OPEN_CTX)).toEqual({
      status: 'passed',
    });
  });

  it('E-9: has_failure fails naming the first failed check', () => {
    const verdict = run(
      REMOTE_CHECKS,
      remoteChecks('has_failure', [check('build', 'passed'), check('test', 'failed'), check('lint', 'failed')]),
      OPEN_CTX,
    );
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'failed') {
      expect(verdict.reason).toContain('test');
      expect(verdict.reason).not.toContain('lint');
    }
  });

  it('E-9: timeout fails with the exact reason "timeout"', () => {
    expect(run(REMOTE_CHECKS, remoteChecks('timeout', []), OPEN_CTX)).toEqual({ status: 'failed', reason: 'timeout' });
  });

  it('E-9: pending stays pending', () => {
    expect(run(REMOTE_CHECKS, remoteChecks('pending', [check('build', 'running')]), OPEN_CTX)).toEqual({ status: 'pending' });
  });

  it('missing remote checks evidence is pending', () => {
    expect(run(REMOTE_CHECKS, {}, OPEN_CTX)).toEqual({ status: 'pending' });
  });

  it('a cancelled check counts as the failure and is named', () => {
    const verdict = run(REMOTE_CHECKS, remoteChecks('has_failure', [check('build', 'cancelled')]), OPEN_CTX);
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'failed') expect(verdict.reason).toContain('build');
  });

  it('has_failure with no failed check in the list still fails', () => {
    const empty = run(REMOTE_CHECKS, remoteChecks('has_failure', []), OPEN_CTX);
    expect(empty).toMatchObject({ status: 'failed' });
    if (empty.status === 'failed') expect(empty.reason.length).toBeGreaterThan(0);
    const noFailure = run(REMOTE_CHECKS, remoteChecks('has_failure', [check('build', 'skipped'), check('test', 'queued')]), OPEN_CTX);
    expect(noFailure).toMatchObject({ status: 'failed' });
  });

  it('the verdict follows the reported status, not the individual check statuses', () => {
    expect(run(REMOTE_CHECKS, remoteChecks('all_passed', [check('build', 'skipped'), check('test', 'queued')]), OPEN_CTX)).toEqual({
      status: 'passed',
    });
  });
});
