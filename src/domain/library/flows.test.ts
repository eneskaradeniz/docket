import { describe, expect, it } from 'vitest';
import { validateDefinitions } from '../definitions/index';
import type { FlowDef } from '../definitions/index';
import { BUILTIN_COMMAND_SET_NAMES, BUILTIN_FLOWS } from './flows';
import { BUILTIN_ROLES } from './roles';

const flowById = (id: string): FlowDef => {
  const found = BUILTIN_FLOWS.find((flow) => flow.id === id);
  if (found === undefined) throw new Error(`expected a built-in flow "${id}"`);
  return found;
};

const fixtureWorkspace = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'builtin-fixture',
  name: 'Built-in fixture',
  repos: [],
  flows: ['standard', 'quick-fix', 'security-reviewed', 'research'],
  defaultFlow: 'standard',
  commandSets: { tests: ['npm test'] },
  roleOverrides: [],
  docsRoot: 'docs',
  testGlobs: ['**/*.test.ts'],
  ...over,
});

describe('BUILTIN_FLOWS', () => {
  it('has the four contract flows in order', () => {
    expect(BUILTIN_FLOWS.map((flow) => flow.id)).toEqual(['standard', 'quick-fix', 'security-reviewed', 'research']);
    expect(BUILTIN_FLOWS.map((flow) => flow.name)).toEqual(['Standart', 'Hızlı düzeltme', 'Güvenlik incelemeli', 'Araştırma']);
  });

  it('standard: matches the contract stages, gate ids, gate kinds and onFail exactly', () => {
    expect(flowById('standard').stages).toEqual([
      {
        id: 'plan',
        name: 'Planlama',
        role: 'planner',
        exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan onayı' }],
      },
      {
        id: 'implement',
        name: 'Uygulama',
        role: 'developer',
        exit: [
          { kind: 'command', id: 'tests', commandSet: 'tests' },
          { kind: 'secret_scan', id: 'secrets' },
        ],
        onFail: { goto: 'implement', maxAttempts: 3 },
      },
      {
        id: 'review',
        name: 'Gözden geçirme',
        role: 'reviewer',
        exit: [
          { kind: 'agent_verdict', id: 'review-verdict', role: 'reviewer' },
          { kind: 'human', id: 'review-approval', label: 'Gözden geçirme onayı' },
        ],
        onFail: { goto: 'implement', maxAttempts: 3 },
      },
      {
        id: 'close',
        name: 'Kapatma',
        role: null,
        exit: [{ kind: 'human', id: 'closure', label: 'Kapanış onayı' }],
      },
    ]);
  });

  it('quick-fix: runs implement then close with the same exit gates', () => {
    expect(flowById('quick-fix').stages).toEqual([
      {
        id: 'implement',
        name: 'Uygulama',
        role: 'developer',
        exit: [
          { kind: 'command', id: 'tests', commandSet: 'tests' },
          { kind: 'secret_scan', id: 'secrets' },
        ],
        onFail: { goto: 'implement', maxAttempts: 3 },
      },
      {
        id: 'close',
        name: 'Kapatma',
        role: null,
        exit: [{ kind: 'human', id: 'closure', label: 'Kapanış onayı' }],
      },
    ]);
  });

  it('security-reviewed: inserts the security stage between implement and review', () => {
    expect(flowById('security-reviewed').stages.map((stage) => stage.id)).toEqual([
      'plan',
      'implement',
      'security',
      'review',
      'close',
    ]);
    expect(flowById('security-reviewed').stages[2]).toEqual({
      id: 'security',
      name: 'Güvenlik incelemesi',
      role: 'security-auditor',
      exit: [
        { kind: 'agent_verdict', id: 'security-verdict', role: 'security-auditor' },
        { kind: 'human', id: 'security-approval', label: 'Güvenlik onayı' },
      ],
    });
  });

  it('research: is a single analyst stage exiting through a findings page approval', () => {
    expect(flowById('research').stages).toEqual([
      {
        id: 'research',
        name: 'Araştırma',
        role: 'analyst',
        exit: [{ kind: 'page_approval', id: 'findings', label: 'Bulgular onayı' }],
      },
    ]);
  });

  it('never sends onFail forward: every goto targets the same or an earlier stage', () => {
    for (const flow of BUILTIN_FLOWS) {
      flow.stages.forEach((stage, index) => {
        const onFail = stage.onFail;
        if (onFail === undefined) return;
        const target = flow.stages.findIndex((s) => s.id === onFail.goto);
        expect(target, `${flow.id}.${stage.id} onFail target`).toBeGreaterThanOrEqual(0);
        expect(target, `${flow.id}.${stage.id} onFail target`).toBeLessThanOrEqual(index);
        expect(onFail.maxAttempts).toBeGreaterThanOrEqual(1);
        expect(onFail.maxAttempts).toBeLessThanOrEqual(10);
      });
    }
  });
});

describe('BUILTIN_COMMAND_SET_NAMES', () => {
  it('is exactly the tests set the built-in flows reference', () => {
    expect(BUILTIN_COMMAND_SET_NAMES).toEqual(['tests']);
  });
});

describe('the built-in library', () => {
  it('R-45: validateDefinitions accepts the whole built-in library with a workspace that defines tests', () => {
    const result = validateDefinitions({
      roles: BUILTIN_ROLES,
      flows: BUILTIN_FLOWS,
      capabilities: [],
      workspace: fixtureWorkspace(),
    });
    if (!result.ok) {
      throw new Error(`expected ok, got issues: ${JSON.stringify(result.error, null, 2)}`);
    }
    expect(result.value.roles).toHaveLength(BUILTIN_ROLES.length);
    expect(result.value.flows).toHaveLength(BUILTIN_FLOWS.length);
  });

  it('fails validation when the workspace lacks the tests command set the flows reference', () => {
    const result = validateDefinitions({
      roles: BUILTIN_ROLES,
      flows: BUILTIN_FLOWS,
      capabilities: [],
      workspace: fixtureWorkspace({ commandSets: {} }),
    });
    if (result.ok) throw new Error('expected err without the tests command set');
    expect(result.error.map((issue) => issue.code)).toEqual(['unknown_command_set', 'unknown_command_set', 'unknown_command_set']);
  });
});
