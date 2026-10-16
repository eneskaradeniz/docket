import { describe, expect, it } from 'vitest';
import type { Result } from '../shared';
import { validateDefinitions } from './validate';
import type { DefinitionIssue } from './types';
import type { Definitions, RoleDef } from './types';
import type { VersionRecord } from './repo-flow';

type Obj = Record<string, unknown>;

const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const role = (over: Obj = {}): Obj => ({
  id: 'dev',
  name: 'Dev',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
  ...over,
});

const gate = (over: Obj = {}): Obj => ({ kind: 'human', id: 'approve', label: 'Approve', ...over });

const stage = (over: Obj = {}): Obj => ({ id: 'work', name: 'Work', role: 'dev', exit: [], ...over });

const binding = (over: Obj = {}): Obj => ({
  stage: 'work',
  role: { roleId: 'dev', version: 1 },
  accounts: [{ accountId: ACCOUNT }],
  ...over,
});

const repoFlow = (over: Obj = {}): Obj => ({
  flowId: 'main',
  version: 1,
  stages: [stage()],
  bindings: [binding()],
  ...over,
});

const flow = (over: Obj = {}): Obj => ({ id: 'main', name: 'Main', stages: [stage()], ...over });

const capability = (over: Obj = {}): Obj => ({
  kind: 'skill',
  id: 'sk',
  name: 'Skill',
  path: 'skills/sk.md',
  ...over,
});

const repo = (over: Obj = {}): Obj => ({
  id: 'ws',
  name: 'Repo',
  flow: repoFlow(),
  defaultLimitPolicy: 'wait_resume',
  commandSets: { build: ['npm run build'] },
  docsRoot: 'docs',
  testGlobs: ['**/*.test.ts'],
  ...over,
});

const project = (over: Obj = {}): Obj => ({
  id: 'atolye',
  name: 'Atölye',
  repos: ['docket', 'docs'],
  ...over,
});

const doc = (over: Obj = {}): Obj => ({
  roles: [role()],
  flows: [flow()],
  capabilities: [capability()],
  ...over,
});

/** A one-version library history of the seeded role, for the R-128/R-130 arms. */
const history = (body: Obj = role()): readonly VersionRecord<RoleDef>[] => [
  { definitionId: 'dev', version: 1, body: body as unknown as RoleDef, recordedAt: 0, archived: false },
];

const expectOk = (result: Result<Definitions, readonly DefinitionIssue[]>): Definitions => {
  if (!result.ok) throw new Error(`expected ok, got issues: ${JSON.stringify(result.error)}`);
  return result.value;
};

const expectErr = (result: Result<Definitions, readonly DefinitionIssue[]>): readonly DefinitionIssue[] => {
  if (result.ok) throw new Error(`expected err, got ok: ${JSON.stringify(result.value)}`);
  return result.error;
};

const codesOf = (issues: readonly DefinitionIssue[]): readonly string[] => issues.map((i) => i.code);

const deepFreeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null) return;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
};

const issue = (path: string, code: string): Obj => ({ path, code, message: expect.any(String) });

describe('validateDefinitions', () => {
  it('returns ok with typed definitions for a valid document', () => {
    const input = {
      roles: [
        {
          id: 'implementer',
          name: 'Implementer',
          instructions: 'Write the code.',
          writeScope: { kind: 'paths', globs: ['src/**'] },
          capabilities: ['mcp-fs', 'skill-review'],
          active: true,
        },
        {
          id: 'reviewer',
          name: 'Reviewer',
          instructions: 'Review the diff.',
          writeScope: { kind: 'none' },
          capabilities: [],
          active: false,
        },
      ],
      flows: [
        {
          id: 'default',
          name: 'Default',
          stages: [
            {
              id: 'build',
              name: 'Build',
              role: 'implementer',
              exit: [{ kind: 'command', id: 'tests-pass', commandSet: 'build' }],
              onFail: { goto: 'build', maxAttempts: 3 },
            },
            {
              id: 'review',
              name: 'Review',
              role: null,
              exit: [
                { kind: 'human', id: 'human-review', label: 'Approve' },
                { kind: 'agent_verdict', id: 'verdict', role: 'implementer' },
                { kind: 'secret_scan', id: 'scan' },
                { kind: 'page_approval', id: 'page', label: 'Page looks right' },
              ],
            },
          ],
        },
      ],
      capabilities: [
        {
          kind: 'mcp',
          id: 'mcp-fs',
          name: 'Filesystem',
          command: 'npx',
          args: ['-y', 'fs-server'],
          env: { CACHE_DIR: { literal: '/tmp/cache' }, API_TOKEN: { secretRef: 'fs-token' } },
        },
        { kind: 'skill', id: 'skill-review', name: 'Review', path: 'skills/review.md' },
        { kind: 'hook', id: 'hook-log', name: 'Log', event: 'after_write', command: 'echo done' },
        { kind: 'context', id: 'ctx-arch', name: 'Architecture', path: 'docs/architecture.md' },
      ],
      repo: {
        id: 'main',
        name: 'Main',
        flow: {
          flowId: 'default',
          version: 1,
          stages: [
            {
              id: 'build',
              name: 'Build',
              role: 'implementer',
              exit: [{ kind: 'command', id: 'tests-pass', commandSet: 'build' }],
              onFail: { goto: 'build', maxAttempts: 3 },
            },
            {
              id: 'review',
              name: 'Review',
              role: null,
              exit: [
                { kind: 'human', id: 'human-review', label: 'Approve' },
                { kind: 'agent_verdict', id: 'verdict', role: 'implementer' },
                { kind: 'secret_scan', id: 'scan' },
                { kind: 'page_approval', id: 'page', label: 'Page looks right' },
              ],
            },
          ],
          bindings: [
            { stage: 'build', role: { roleId: 'implementer', version: 1 }, accounts: [{ accountId: ACCOUNT }] },
            { stage: 'review', accounts: [] },
          ],
        },
        defaultLimitPolicy: 'wait_resume',
        commandSets: { build: ['npm run build', 'npm test'] },
        docsRoot: 'docs',
        testGlobs: ['**/*.test.ts'],
      },
    };

    const result = validateDefinitions(input);

    expect(result.ok).toBe(true);
    expect(expectOk(result)).toEqual(input);
  });

  it('accepts a document without a repo', () => {
    const result = validateDefinitions(doc());
    expect(expectOk(result).repo).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const input = doc({ repo: repo() });
    deepFreeze(input);
    const result = validateDefinitions(input);
    expect(result.ok).toBe(true);
  });

  it('R-3: all issues are collected; validation never stops at the first issue', () => {
    const input = doc({
      roles: [
        role({ capabilities: ['missing-cap'] }),
        role(),
      ],
      flows: [
        flow({
          stages: [
            stage({ role: 'ghost', onFail: { goto: 'check', maxAttempts: 11 } }),
            stage({ id: 'check', name: 'Check' }),
          ],
        }),
      ],
      repo: repo({ flow: repoFlow({ bindings: [binding({ stage: 'nowhere' })] }) }),
    });

    const issues = expectErr(validateDefinitions(input));

    expect(issues).toHaveLength(6);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('roles[0].capabilities[0]', 'unknown_capability'),
        issue('roles[1].id', 'duplicate_id'),
        issue('flows[0].stages[0].role', 'unknown_role'),
        issue('flows[0].stages[0].onFail.goto', 'forward_goto'),
        issue('flows[0].stages[0].onFail.maxAttempts', 'bad_attempts'),
        issue('repo.flow.bindings[0].stage', 'binding_stage_mismatch'),
      ]),
    );
  });

  it('R-4: ids are unique per kind, stage ids unique within a flow, gate ids unique within a stage', () => {
    const input = doc({
      roles: [role(), role()],
      flows: [
        flow({ stages: [stage({ exit: [gate(), gate()] }), stage()] }),
        flow({ stages: [stage()] }),
      ],
      capabilities: [capability(), capability()],
    });

    const issues = expectErr(validateDefinitions(input));

    expect(issues).toHaveLength(5);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('roles[1].id', 'duplicate_id'),
        issue('flows[1].id', 'duplicate_id'),
        issue('flows[0].stages[1].id', 'duplicate_id'),
        issue('flows[0].stages[0].exit[1].id', 'duplicate_id'),
        issue('capabilities[1].id', 'duplicate_id'),
      ]),
    );
  });

  it('R-4 edge: the same stage id in different flows and gate id in different stages is allowed', () => {
    const input = doc({
      flows: [flow(), flow({ id: 'other', stages: [stage()] })],
    });
    const result = validateDefinitions(input);
    expect(result.ok).toBe(true);
  });

  it('R-5: stage.role must exist and be active; agent_verdict.role must exist', () => {
    const input = doc({
      roles: [role({ active: false })],
      flows: [
        flow({
          stages: [
            stage(),
            stage({ id: 'check', name: 'Check', role: null, exit: [gate({ kind: 'agent_verdict', role: 'nobody' })] }),
          ],
        }),
      ],
    });

    const issues = expectErr(validateDefinitions(input));

    expect(issues).toHaveLength(2);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('flows[0].stages[0].role', 'inactive_role'),
        issue('flows[0].stages[1].exit[0].role', 'unknown_role'),
      ]),
    );
  });

  it('R-5 edge: a null stage role is a human-only stage and passes', () => {
    const result = validateDefinitions(doc({ flows: [flow({ stages: [stage({ role: null })] })] }));
    expect(result.ok).toBe(true);
  });

  it('R-5 edge: agent_verdict.role only needs to exist, not be active', () => {
    const input = doc({
      roles: [role({ active: false })],
      flows: [flow({ stages: [stage({ role: null, exit: [gate({ kind: 'agent_verdict', role: 'dev' })] })] })],
    });
    expect(validateDefinitions(input).ok).toBe(true);
  });

  it('R-6: onFail.goto may target the same index or an earlier stage', () => {
    const back = doc({
      flows: [flow({ stages: [stage(), stage({ id: 'check', name: 'Check', onFail: { goto: 'work', maxAttempts: 2 } })] })],
    });
    expect(validateDefinitions(back).ok).toBe(true);

    const self = doc({
      flows: [flow({ stages: [stage({ onFail: { goto: 'work', maxAttempts: 2 } })] })],
    });
    expect(validateDefinitions(self).ok).toBe(true);
  });

  it('R-6: onFail.goto naming a later stage is forward_goto', () => {
    const input = doc({
      flows: [
        flow({
          stages: [
            stage({ onFail: { goto: 'check', maxAttempts: 2 } }),
            stage({ id: 'check', name: 'Check' }),
          ],
        }),
      ],
    });

    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toContain('forward_goto');
    expect(issues[0]?.path).toBe('flows[0].stages[0].onFail.goto');
  });

  it('R-6: onFail.goto naming an unknown stage is unknown_stage', () => {
    const input = doc({ flows: [flow({ stages: [stage({ onFail: { goto: 'nowhere', maxAttempts: 2 } })] })] });

    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['unknown_stage']);
    expect(issues[0]?.path).toBe('flows[0].stages[0].onFail.goto');
  });

  it('R-6: maxAttempts is an integer 1..10', () => {
    for (const maxAttempts of [1, 10]) {
      const input = doc({ flows: [flow({ stages: [stage({ onFail: { goto: 'work', maxAttempts } })] })] });
      expect(validateDefinitions(input).ok).toBe(true);
    }
    for (const maxAttempts of [0, 11, 2.5]) {
      const input = doc({ flows: [flow({ stages: [stage({ onFail: { goto: 'work', maxAttempts } })] })] });
      const issues = expectErr(validateDefinitions(input));
      expect(codesOf(issues)).toEqual(['bad_attempts']);
      expect(issues[0]?.path).toBe('flows[0].stages[0].onFail.maxAttempts');
    }
  });

  it('R-7: command gates must name a commandSet present in repo.commandSets', () => {
    const okInput = doc({
      flows: [flow({ stages: [stage({ exit: [gate({ kind: 'command', commandSet: 'build' })] })] })],
      repo: repo(),
    });
    expect(validateDefinitions(okInput).ok).toBe(true);

    const badInput = doc({
      flows: [flow({ stages: [stage({ exit: [gate({ kind: 'command', commandSet: 'test' })] })] })],
      repo: repo(),
    });
    const issues = expectErr(validateDefinitions(badInput));
    expect(codesOf(issues)).toEqual(['unknown_command_set']);
    expect(issues[0]?.path).toBe('flows[0].stages[0].exit[0].commandSet');
  });

  it('a changes gate carries only kind and id', () => {
    const input = doc({
      flows: [flow({ stages: [stage({ exit: [{ kind: 'changes', id: 'changed' }] })] })],
    });
    const value = expectOk(validateDefinitions(input));
    expect(value.flows[0]?.stages[0]?.exit[0]).toEqual({ kind: 'changes', id: 'changed' });
  });

  it('R-7 edge: command gates pass when no repo is given', () => {
    const input = doc({
      flows: [flow({ stages: [stage({ exit: [gate({ kind: 'command', commandSet: 'test' })] })] })],
    });
    expect(validateDefinitions(input).ok).toBe(true);
  });

  it('R-8: a bare string env value is wrong_type', () => {
    const input = doc({
      capabilities: [capability({ kind: 'mcp', command: 'run', args: [], env: { CACHE_DIR: 'bare' } })],
    });

    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['wrong_type']);
    expect(issues[0]?.path).toBe('capabilities[0].env.CACHE_DIR');
  });

  it('R-8: a literal under a secret-looking key is secret_literal', () => {
    for (const key of ['API_TOKEN', 'password', 'MY_SECRET', 'TOKEN_COUNT_HINT', 'DB_PASSWORD']) {
      const input = doc({
        capabilities: [capability({ kind: 'mcp', command: 'run', args: [], env: { [key]: { literal: 'value' } } })],
      });
      const issues = expectErr(validateDefinitions(input));
      expect(codesOf(issues)).toEqual(['secret_literal']);
      expect(issues[0]?.path).toBe(`capabilities[0].env.${key}`);
    }
  });

  it('R-8 edge: literal under a benign key and secretRef are accepted; malformed values are wrong_type', () => {
    const okInput = doc({
      capabilities: [
        capability({
          kind: 'mcp',
          command: 'run',
          args: [],
          env: { CACHE_DIR: { literal: '/tmp' }, API_TOKEN: { secretRef: 'vault-key' } },
        }),
      ],
    });
    expect(validateDefinitions(okInput).ok).toBe(true);

    for (const bad of [42, {}, { literal: 42 }, { secretRef: 42 }, { literal: 'a', secretRef: 'b' }, { other: 'x' }]) {
      const input = doc({
        capabilities: [capability({ kind: 'mcp', command: 'run', args: [], env: { CACHE_DIR: bad } })],
      });
      const issues = expectErr(validateDefinitions(input));
      expect(codesOf(issues)).toEqual(['wrong_type']);
      expect(issues[0]?.path).toBe('capabilities[0].env.CACHE_DIR');
    }
  });

  it('R-9: superseded — the repo owns one flow; the legacy flows/defaultFlow fields are rejected as unknown keys', () => {
    const legacy = doc({
      repo: repo({
        flows: ['main'],
        defaultFlow: 'main',
        roleOverrides: [],
      }),
    });
    const issues = expectErr(validateDefinitions(legacy));
    expect(issues).toEqual([
      issue('repo.flows', 'unknown_field'),
      issue('repo.defaultFlow', 'unknown_field'),
      issue('repo.roleOverrides', 'unknown_field'),
    ]);
  });

  it('R-46: a valid project lands in Definitions.project, with or without a budget', () => {
    const bare = expectOk(validateDefinitions(doc({ project: project() })));
    expect(bare.project).toEqual({ id: 'atolye', name: 'Atölye', repos: ['docket', 'docs'] });
    expect('budget' in (bare.project ?? {})).toBe(false);

    const capped = expectOk(validateDefinitions(doc({ project: project({ budget: { amountUsd: 25, warnPercent: 80 } }) })));
    expect(capped.project?.budget).toEqual({ amountUsd: 25, warnPercent: 80 });

    const without = expectOk(validateDefinitions(doc()));
    expect(without.project).toBeUndefined();
  });

  it('R-46: repos must be non-empty (empty_repos)', () => {
    const issues = expectErr(validateDefinitions(doc({ project: project({ repos: [] }) })));
    expect(codesOf(issues)).toEqual(['empty_repos']);
    expect(issues[0]?.path).toBe('project.repos');
  });

  it('R-46: duplicate repo entries are reported as duplicate_id', () => {
    const issues = expectErr(validateDefinitions(doc({ project: project({ repos: ['docket', 'docs', 'docket'] }) })));
    expect(codesOf(issues)).toEqual(['duplicate_id']);
    expect(issues[0]?.path).toBe('project.repos[2]');
  });

  it('R-81: docketTools is an optional boolean on a role, kept as written; absent stays absent', () => {
    const defs = expectOk(
      validateDefinitions(
        doc({ roles: [role({ id: 'dev', docketTools: false }), role({ id: 'loud', docketTools: true }), role({ id: 'plain' })] }),
      ),
    );
    expect(defs.roles.map((r) => r.docketTools)).toEqual([false, true, undefined]);
    expect('docketTools' in (defs.roles[2] ?? {})).toBe(false);
  });

  it('R-81: a non-boolean docketTools is wrong_type at its path, in a role and in a binding overlay', () => {
    const inRole = expectErr(validateDefinitions(doc({ roles: [role({ docketTools: 'no' })] })));
    expect(inRole).toEqual([issue('roles[0].docketTools', 'wrong_type')]);
    const inOverlay = expectErr(
      validateDefinitions(
        doc({ repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { docketTools: 0 } } })] }) }) }),
      ),
    );
    expect(inOverlay).toEqual([issue('repo.flow.bindings[0].role.overlay.docketTools', 'wrong_type')]);
  });

  it('R-81: a binding overlay may switch the tools off', () => {
    const defs = expectOk(
      validateDefinitions(
        doc({ repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { docketTools: false } } })] }) }) }),
      ),
    );
    expect(defs.repo?.flow.bindings[0]?.role?.overlay?.docketTools).toBe(false);
  });

  it('R-126: ProjectDef carries no mainRepo — the field is an unknown key, like every legacy project field', () => {
    const issues = expectErr(validateDefinitions(doc({ project: project({ mainRepo: 'docket' }) })));
    expect(issues).toEqual([issue('project.mainRepo', 'unknown_field')]);
  });

  it('R-126 edge: unknown project keys are rejected the same way', () => {
    const issues = expectErr(validateDefinitions(doc({ project: project({ roles: [] }) })));
    expect(issues).toEqual([issue('project.roles', 'unknown_field')]);
  });

  it('R-46: a budget that is not a valid SpendCap is wrong_type', () => {
    const notObject = expectErr(validateDefinitions(doc({ project: project({ budget: 5 }) })));
    expect(codesOf(notObject)).toEqual(['wrong_type']);
    expect(notObject[0]?.path).toBe('project.budget');

    const badAmount = expectErr(
      validateDefinitions(doc({ project: project({ budget: { amountUsd: '25', warnPercent: 80 } }) })),
    );
    expect(codesOf(badAmount)).toEqual(['wrong_type']);
    expect(badAmount[0]?.path).toBe('project.budget.amountUsd');

    const missingWarn = expectErr(validateDefinitions(doc({ project: project({ budget: { amountUsd: 25 } }) })));
    expect(codesOf(missingWarn)).toEqual(['wrong_type']);
    expect(missingWarn[0]?.path).toBe('project.budget.warnPercent');

    const outOfRange = expectErr(
      validateDefinitions(doc({ project: project({ budget: { amountUsd: 25, warnPercent: 101 } }) })),
    );
    expect(codesOf(outOfRange)).toEqual(['wrong_type']);
    expect(outOfRange[0]?.path).toBe('project.budget.warnPercent');
  });

  it('R-46 edge: project fields are type- and slug-checked like every other definition', () => {
    const notObject = expectErr(validateDefinitions(doc({ project: 'x' })));
    expect(codesOf(notObject)).toEqual(['wrong_type']);
    expect(notObject[0]?.path).toBe('project');

    const badId = expectErr(validateDefinitions(doc({ project: project({ id: 'Atölye' }) })));
    expect(codesOf(badId)).toEqual(['invalid_slug']);
    expect(badId[0]?.path).toBe('project.id');

    const badRepoEntry = expectErr(validateDefinitions(doc({ project: project({ repos: ['docket', 'Docs'] }) })));
    expect(codesOf(badRepoEntry)).toEqual(['invalid_slug']);
    expect(badRepoEntry[0]?.path).toBe('project.repos[1]');

    const noRepos = project() as Obj;
    delete noRepos.repos;
    const missing = expectErr(validateDefinitions(doc({ project: noRepos })));
    expect(codesOf(missing)).toEqual(['missing_field']);
    expect(missing[0]?.path).toBe('project.repos');
  });

  it('R-127: bindings hold exactly one binding per stage, in stage order', () => {
    const missing = doc({ repo: repo({ flow: repoFlow({ bindings: [] }) }) });
    expect(expectErr(validateDefinitions(missing))).toEqual([issue('repo.flow.bindings', 'binding_stage_mismatch')]);

    const swapped = doc({
      repo: repo({
        flow: repoFlow({
          stages: [stage(), stage({ id: 'check', name: 'Check', role: null })],
          bindings: [binding({ stage: 'check', role: undefined }), binding()],
        }),
      }),
    });
    const swappedIssues = expectErr(validateDefinitions(swapped));
    expect(codesOf(swappedIssues)).toEqual(['binding_stage_mismatch', 'binding_stage_mismatch']);
    expect(swappedIssues[0]?.path).toBe('repo.flow.bindings[0].stage');
    expect(swappedIssues[1]?.path).toBe('repo.flow.bindings[1].stage');

    const extra = doc({
      repo: repo({
        flow: repoFlow({ bindings: [binding(), binding({ stage: 'ghost' })] }),
      }),
    });
    const extraIssues = expectErr(validateDefinitions(extra));
    expect(extraIssues).toEqual([issue('repo.flow.bindings[1].stage', 'binding_stage_mismatch')]);
  });

  it('rejects malformed account routes in StageBinding.accounts', () => {
    const notArray = doc({ repo: repo({ flow: repoFlow({ bindings: [binding({ accounts: 'nope' })] }) }) });
    expect(codesOf(expectErr(validateDefinitions(notArray)))).toContain('wrong_type');

    const badEntry = doc({
      repo: repo({ flow: repoFlow({ bindings: [binding({ accounts: [{ accountId: 'nope' }, 42] })] }) }),
    });
    const issues = expectErr(validateDefinitions(badEntry));
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('repo.flow.bindings[0].accounts[0].accountId', 'wrong_type'),
        issue('repo.flow.bindings[0].accounts[1]', 'wrong_type'),
      ]),
    );

    const badModel = doc({
      repo: repo({
        flow: repoFlow({
          bindings: [
            binding({
              accounts: [{ accountId: '01ARZ3NDEKTSV4RRFFQ69G5FAA', model: 7 }],
            }),
          ],
        }),
      }),
    });
    expect(codesOf(expectErr(validateDefinitions(badModel)))).toContain('wrong_type');
  });

  it('R-127 edge: two bindings for one stage are duplicate_binding', () => {
    const input = doc({
      repo: repo({
        flow: repoFlow({
          stages: [stage(), stage({ id: 'check', name: 'Check', role: null })],
          bindings: [binding(), binding({ stage: 'work' }), binding({ stage: 'check', role: undefined })],
        }),
      }),
    });
    const issues = expectErr(validateDefinitions(input));
    expect(issues).toEqual([
      issue('repo.flow.bindings[1].stage', 'duplicate_binding'),
      // The duplicate pushed "check" out of stage order — both defects are reported.
      issue('repo.flow.bindings[2].stage', 'binding_stage_mismatch'),
    ]);
  });

  it('R-128: a human-only stage forbids a role on its binding (role_forbidden)', () => {
    const input = doc({
      repo: repo({
        flow: repoFlow({
          stages: [stage({ role: null })],
          bindings: [binding()],
        }),
      }),
    });
    const issues = expectErr(validateDefinitions(input));
    expect(issues).toEqual([issue('repo.flow.bindings[0].role', 'role_forbidden')]);
  });

  it('R-128: a stage with a role requires one on its binding (role_required)', () => {
    const input = doc({ repo: repo({ flow: repoFlow({ bindings: [binding({ role: undefined })] }) }) });
    const issues = expectErr(validateDefinitions(input));
    expect(issues).toEqual([issue('repo.flow.bindings[0].role', 'role_required')]);
  });

  it('R-128: a non-detached ref must name an existing library version (unknown_role_version)', () => {
    const missing = doc({ repo: repo() });
    const missingIssues = expectErr(validateDefinitions(missing, { roles: [] }));
    expect(missingIssues).toEqual([issue('repo.flow.bindings[0].role.version', 'unknown_role_version')]);

    const wrongVersion = doc({
      repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 2 } })] }) }),
    });
    const wrongIssues = expectErr(validateDefinitions(wrongVersion, { roles: history() }));
    expect(wrongIssues).toEqual([issue('repo.flow.bindings[0].role.version', 'unknown_role_version')]);

    const present = doc({ repo: repo() });
    expect(validateDefinitions(present, { roles: history() }).ok).toBe(true);
  });

  it('R-128 edge: a detached ref skips the library check; no histories means no check', () => {
    const detached = doc({
      repo: repo({
        flow: repoFlow({
          bindings: [binding({ role: { roleId: 'dev', version: 9, detached: role({ id: 'local-dev' }) } })],
        }),
      }),
    });
    expect(validateDefinitions(detached, { roles: history() }).ok).toBe(true);

    // Without histories the version check is skipped, never guessed.
    expect(validateDefinitions(doc({ repo: repo() })).ok).toBe(true);
  });

  it('R-128 edge: the overlay never carries id or active — they are unknown keys', () => {
    const withId = doc({
      repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { id: 'other' } } })] }) }),
    });
    expect(expectErr(validateDefinitions(withId))).toEqual([
      issue('repo.flow.bindings[0].role.overlay.id', 'unknown_field'),
    ]);

    const withActive = doc({
      repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { active: false } } })] }) }),
    });
    expect(expectErr(validateDefinitions(withActive))).toEqual([
      issue('repo.flow.bindings[0].role.overlay.active', 'unknown_field'),
    ]);
  });

  it('R-128 edge: unknown keys in the repo section are rejected (unknown_field)', () => {
    const issues = expectErr(validateDefinitions(doc({ repo: repo({ legacyImported: true }) })));
    expect(issues).toEqual([issue('repo.legacyImported', 'unknown_field')]);
  });

  it('R-130: with histories the answer carries each binding’s effective role and the repo’s own flow copy', () => {
    const overlaid = doc({
      repo: repo({
        flow: repoFlow({
          bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { name: 'Yerel Dev' } } })],
        }),
      }),
    });
    const defs = expectOk(validateDefinitions(overlaid, { roles: history() }));

    // Roles: the binding's R-130 effective role — the library body with the overlay applied.
    expect(defs.roles).toEqual([
      { id: 'dev', name: 'Yerel Dev', instructions: 'Do the work.', writeScope: { kind: 'repo' }, capabilities: [], active: true },
    ]);

    // Flows: the library list with the repo-owned flow's own stages under its id.
    expect(defs.flows).toEqual([{ id: 'main', name: 'Main', stages: defs.repo?.flow.stages }]);

    // Without histories the parsed library view stands (the version check is skipped, never guessed).
    const plain = expectOk(validateDefinitions(overlaid));
    expect(plain.roles).toHaveLength(1);
    expect(plain.roles[0]?.name).toBe('Dev');
  });

  it('R-130 edge: a detached binding answers its own body; two stages binding one role answer one role', () => {
    const input = doc({
      repo: repo({
        flow: repoFlow({
          stages: [stage(), stage({ id: 'check', name: 'Check', role: null })],
          bindings: [
            binding({ role: { roleId: 'dev', version: 1, detached: role({ id: 'dev', name: 'Yerel Dev' }) } }),
            binding({ stage: 'check', role: undefined }),
          ],
        }),
      }),
    });
    const defs = expectOk(validateDefinitions(input, { roles: history() }));
    expect(defs.roles.map((r) => r.name)).toEqual(['Yerel Dev']);
  });

  it('reports missing_field for absent required fields at any depth', () => {
    const noTop: Obj = {};
    const topIssues = expectErr(validateDefinitions(noTop));
    expect(topIssues).toHaveLength(3);
    expect(topIssues).toEqual(
      expect.arrayContaining([
        issue('roles', 'missing_field'),
        issue('flows', 'missing_field'),
        issue('capabilities', 'missing_field'),
      ]),
    );

    const roleNoId = { ...role() } as Obj;
    delete roleNoId.id;
    expect(codesOf(expectErr(validateDefinitions(doc({ roles: [roleNoId] }))))).toContain('missing_field');

    const roleNoScope = { ...role() } as Obj;
    delete roleNoScope.writeScope;
    const scopeIssues = expectErr(validateDefinitions(doc({ roles: [roleNoScope] })));
    expect(scopeIssues).toEqual([issue('roles[0].writeScope', 'missing_field')]);

    const scopeNoGlobs = doc({ roles: [role({ writeScope: { kind: 'paths' } })] });
    const globsIssues = expectErr(validateDefinitions(scopeNoGlobs));
    expect(globsIssues).toEqual([issue('roles[0].writeScope.globs', 'missing_field')]);

    const stageNoName = { ...stage() } as Obj;
    delete stageNoName.name;
    expect(codesOf(expectErr(validateDefinitions(doc({ flows: [flow({ stages: [stageNoName] })] }))))).toContain(
      'missing_field',
    );

    const gateNoKind = { kind: 'human', id: 'approve', label: 'OK' } as Obj;
    delete gateNoKind.kind;
    const gateIssues = expectErr(validateDefinitions(doc({ flows: [flow({ stages: [stage({ exit: [gateNoKind] })] })] })));
    expect(gateIssues).toEqual([issue('flows[0].stages[0].exit[0].kind', 'missing_field')]);

    const onFailNoGoto = doc({ flows: [flow({ stages: [stage({ onFail: { maxAttempts: 2 } })] })] });
    const onFailIssues = expectErr(validateDefinitions(onFailNoGoto));
    expect(codesOf(onFailIssues)).toEqual(['missing_field']);
    expect(onFailIssues[0]?.path).toBe('flows[0].stages[0].onFail.goto');

    const mcpNoEnv = doc({ capabilities: [capability({ kind: 'mcp', command: 'run', args: [] })] });
    expect(codesOf(expectErr(validateDefinitions(mcpNoEnv)))).toContain('missing_field');

    const ws: Obj = { ...repo() };
    delete ws.docsRoot;
    expect(codesOf(expectErr(validateDefinitions(doc({ repo: ws }))))).toContain('missing_field');

    const envNoProtected = doc({
      repo: repo({ environments: [{ id: 'stg', name: 'Staging', order: 1, deploy: 'build', env: {} }] }),
    });
    const envIssues = expectErr(validateDefinitions(envNoProtected));
    expect(envIssues).toEqual([issue('repo.environments[0].protected', 'missing_field')]);

    const noFlow: Obj = { ...repo() };
    delete noFlow.flow;
    const flowIssues = expectErr(validateDefinitions(doc({ repo: noFlow })));
    expect(flowIssues).toEqual([issue('repo.flow', 'missing_field')]);

    const noPolicy: Obj = { ...repo() };
    delete noPolicy.defaultLimitPolicy;
    expect(expectErr(validateDefinitions(doc({ repo: noPolicy })))).toEqual([
      issue('repo.defaultLimitPolicy', 'missing_field'),
    ]);
  });

  it('reports wrong_type for mistyped required fields at any depth', () => {
    expect(codesOf(expectErr(validateDefinitions(null)))).toEqual(['wrong_type']);
    expect(codesOf(expectErr(validateDefinitions('nope')))).toEqual(['wrong_type']);
    expect(codesOf(expectErr(validateDefinitions(doc({ roles: 'x' }))))).toContain('wrong_type');
    expect(codesOf(expectErr(validateDefinitions(doc({ roles: [role({ id: 42 })] }))))).toContain('wrong_type');
    expect(codesOf(expectErr(validateDefinitions(doc({ roles: [role({ active: 'yes' })] }))))).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ roles: [role({ writeScope: { kind: 'weird' } })] })))),
    ).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ roles: [role({ writeScope: { kind: 'paths', globs: 'src' } })] })))),
    ).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ roles: [role({ writeScope: { kind: 'paths', globs: [42] } })] })))),
    ).toContain('wrong_type');
    expect(codesOf(expectErr(validateDefinitions(doc({ flows: [flow({ stages: 'x' })] }))))).toContain('wrong_type');
    expect(
      codesOf(
        expectErr(validateDefinitions(doc({ flows: [flow({ stages: [stage({ onFail: { goto: 'work', maxAttempts: '3' } })] })] }))),
      ),
    ).toContain('wrong_type');
    expect(
      codesOf(
        expectErr(validateDefinitions(doc({ capabilities: [capability({ kind: 'hook', event: 42, command: 'x' })] }))),
      ),
    ).toContain('wrong_type');
    expect(
      codesOf(
        expectErr(validateDefinitions(doc({ capabilities: [capability({ kind: 'mcp', command: 'x', env: {} })] })))),
    ).toContain('missing_field');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ repo: repo({ commandSets: { build: 'npm run build' } }) })))),
    ).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ repo: repo({ commandSets: { build: [42] } }) })))),
    ).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ repo: repo({ defaultLimitPolicy: 'sometimes' }) })))),
    ).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ repo: repo({ flow: repoFlow({ version: 0 }) }) })))),
    ).toContain('wrong_type');
    expect(
      codesOf(
        expectErr(validateDefinitions(doc({ repo: repo({ flow: repoFlow({ bindings: [binding({ accounts: [{ accountId: 'nope' }] })] }) }) }))),
      ),
    ).toContain('wrong_type');
  });

  it('reports invalid_slug for malformed ids and slug-typed references', () => {
    const input = doc({
      roles: [role({ id: 'Bad' }), role()],
      flows: [flow({ stages: [stage({ onFail: { goto: 'Nope', maxAttempts: 2 } })] })],
      capabilities: [capability()],
      repo: repo({ id: 'REPO' }),
    });

    const issues = expectErr(validateDefinitions(input));
    expect(issues).toHaveLength(3);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('roles[0].id', 'invalid_slug'),
        issue('flows[0].stages[0].onFail.goto', 'invalid_slug'),
        issue('repo.id', 'invalid_slug'),
      ]),
    );
  });

  it('reports empty_flow for a flow with no stages', () => {
    const input = doc({ flows: [flow({ stages: [] })] });
    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['empty_flow']);
    expect(issues[0]?.path).toBe('flows[0].stages');
  });

  it('validates binding overlay capabilities against known capabilities', () => {
    const unknown = doc({
      repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { capabilities: ['missing-cap'] } } })] }) }),
    });
    const unknownIssues = expectErr(validateDefinitions(unknown));
    expect(codesOf(unknownIssues)).toEqual(['unknown_capability']);
    expect(unknownIssues[0]?.path).toBe('repo.flow.bindings[0].role.overlay.capabilities[0]');

    const applies = doc({
      repo: repo({ flow: repoFlow({ bindings: [binding({ role: { roleId: 'dev', version: 1, overlay: { capabilities: ['sk'] } } })] }) }),
    });
    expect(validateDefinitions(applies).ok).toBe(true);
  });

  it('validates every capability kind shape', () => {
    const input = doc({
      capabilities: [
        capability({ id: 'sk-skill', kind: 'skill' }),
        capability({ id: 'sk-hook', kind: 'hook', event: 'run_end', command: 'notify' }),
        capability({ id: 'sk-context', kind: 'context', path: 'ctx.md' }),
        capability({ id: 'sk-mcp', kind: 'mcp', command: 'run', args: ['--flag', 42] }),
      ],
    });
    const issues = expectErr(validateDefinitions(input));
    expect(issues).toHaveLength(2);
    expect([...codesOf(issues)].sort()).toEqual(['missing_field', 'wrong_type']);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('capabilities[3].args[1]', 'wrong_type'),
        issue('capabilities[3].env', 'missing_field'),
      ]),
    );
  });
});

describe('validateDefinitions — plugin and command capabilities', () => {
  const plugin = (over: Obj = {}): Obj => ({
    kind: 'plugin',
    id: 'pl',
    name: 'Plugin',
    source: { kind: 'path', path: 'plugins/pl' },
    includes: ['sk'],
    ...over,
  });
  const command = (over: Obj = {}): Obj => ({
    kind: 'command',
    id: 'cmd',
    name: 'Command',
    template: 'Review {{target}} for {{focus}}',
    arguments: [
      { name: 'target', required: true },
      { name: 'focus', required: false },
    ],
    ...over,
  });

  it('R-140: a plugin and a command with declared placeholders are accepted', () => {
    const value = expectOk(
      validateDefinitions(
        doc({
          capabilities: [
            capability(),
            plugin({ source: { kind: 'marketplace', marketplace: 'acme', name: 'pl' }, version: '1.2.0' }),
            command(),
          ],
        }),
      ),
    );
    expect(value.capabilities.map((c) => c.kind)).toEqual(['skill', 'plugin', 'command']);
    expect(value.capabilities[1]).toMatchObject({ version: '1.2.0', includes: ['sk'] });
  });

  it('R-140: a plugin include naming no capability is unknown_capability', () => {
    const issues = expectErr(validateDefinitions(doc({ capabilities: [capability(), plugin({ includes: ['sk', 'ghost'] })] })));
    expect(issues).toEqual([issue('capabilities[1].includes[1]', 'unknown_capability')]);
  });

  it('R-140: a plugin including itself or forming a cycle is plugin_cycle', () => {
    const self = expectErr(validateDefinitions(doc({ capabilities: [plugin({ includes: ['pl'] })] })));
    expect(codesOf(self)).toEqual(['plugin_cycle']);
    const cycle = expectErr(
      validateDefinitions(
        doc({ capabilities: [plugin({ id: 'a', includes: ['b'] }), plugin({ id: 'b', includes: ['a'] }), plugin({ id: 'c', includes: ['a'] })] }),
      ),
    );
    expect(cycle).toEqual([issue('capabilities[0].includes', 'plugin_cycle'), issue('capabilities[1].includes', 'plugin_cycle')]);
  });

  it('R-140: a command placeholder missing from arguments is unknown_argument', () => {
    const issues = expectErr(validateDefinitions(doc({ capabilities: [command({ template: 'Do {{what}} to {{target}}' })] })));
    expect(issues).toEqual([issue('capabilities[0].template', 'unknown_argument')]);
  });

  it('R-140 edge: malformed plugin and command fields are reported, not thrown', () => {
    const issues = expectErr(
      validateDefinitions(
        doc({
          capabilities: [
            plugin({ source: { kind: 'ftp' }, includes: 'sk' }),
            command({ template: undefined, arguments: [{ name: 'x' }] }),
          ],
        }),
      ),
    );
    expect(codesOf(issues)).toEqual(expect.arrayContaining(['wrong_type', 'missing_field']));
  });
});

describe('autonomy level on project and repo (R-171)', () => {
  it('R-171: an autonomy member on the project is accepted verbatim; an absent one stays absent', () => {
    const withLevel = expectOk(validateDefinitions(doc({ project: project({ autonomy: 'auto' }) })));
    expect(withLevel.project?.autonomy).toBe('auto');

    const bare = expectOk(validateDefinitions(doc({ project: project() })));
    expect(bare.project?.autonomy).toBeUndefined();
  });

  it('R-171: an autonomy member on the repo is accepted verbatim; an absent one stays absent', () => {
    const withLevel = expectOk(validateDefinitions(doc({ repo: repo({ autonomy: 'balanced' }) })));
    expect(withLevel.repo?.autonomy).toBe('balanced');

    const bare = expectOk(validateDefinitions(doc({ repo: repo() })));
    expect(bare.repo?.autonomy).toBeUndefined();
  });

  it('R-171: a project value outside AUTONOMY_LEVELS is wrong_type at the project section', () => {
    const issues = expectErr(validateDefinitions(doc({ project: project({ autonomy: 'turbo' }) })));
    expect(issues).toEqual([issue('project.autonomy', 'wrong_type')]);
  });

  it('R-171: a repo value outside AUTONOMY_LEVELS is wrong_type at the repo section', () => {
    const issues = expectErr(validateDefinitions(doc({ repo: repo({ autonomy: 7 }) })));
    expect(issues).toEqual([issue('repo.autonomy', 'wrong_type')]);
  });

  it('R-152: FlowDef carries autonomy?: AutonomyLevel; wrong_type on unknown value', () => {
    const withLevel = expectOk(validateDefinitions(doc({ flows: [flow({ autonomy: 'auto' })] })));
    expect(withLevel.flows[0]?.autonomy).toBe('auto');

    const bare = expectOk(validateDefinitions(doc({ flows: [flow()] })));
    expect(bare.flows[0]?.autonomy).toBeUndefined();

    const issues = expectErr(validateDefinitions(doc({ flows: [flow({ autonomy: 'turbo' })] })));
    expect(issues).toEqual([issue('flows[0].autonomy', 'wrong_type')]);
  });

  it('R-152: StageDef carries autonomy?: AutonomyLevel; wrong_type on unknown value', () => {
    const withLevel = expectOk(validateDefinitions(doc({ flows: [flow({ stages: [stage({ autonomy: 'auto' })] })] })));
    expect(withLevel.flows[0]?.stages[0]?.autonomy).toBe('auto');

    const bare = expectOk(validateDefinitions(doc({ flows: [flow({ stages: [stage()] })] })));
    expect(bare.flows[0]?.stages[0]?.autonomy).toBeUndefined();

    const issues = expectErr(validateDefinitions(doc({ flows: [flow({ stages: [stage({ autonomy: 'turbo' })] })] })));
    expect(issues).toEqual([issue('flows[0].stages[0].autonomy', 'wrong_type')]);
  });

  it('R-154: RepoDef carries maxLevel?: AutonomyLevel; wrong_type on unknown value; absent stays absent', () => {
    const withLevel = expectOk(validateDefinitions(doc({ repo: repo({ maxLevel: 'manual' }) })));
    expect(withLevel.repo?.maxLevel).toBe('manual');

    const bare = expectOk(validateDefinitions(doc({ repo: repo() })));
    expect(bare.repo?.maxLevel).toBeUndefined();

    const issues = expectErr(validateDefinitions(doc({ repo: repo({ maxLevel: 'turbo' }) })));
    expect(issues).toEqual([issue('repo.maxLevel', 'wrong_type')]);
  });
});


