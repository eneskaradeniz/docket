import { describe, expect, it } from 'vitest';
import type { Result } from '../shared';
import { validateDefinitions, type DefinitionIssue } from './validate';
import type { Definitions } from './types';

type Obj = Record<string, unknown>;

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

const flow = (over: Obj = {}): Obj => ({ id: 'main', name: 'Main', stages: [stage()], ...over });

const capability = (over: Obj = {}): Obj => ({
  kind: 'skill',
  id: 'sk',
  name: 'Skill',
  path: 'skills/sk.md',
  ...over,
});

const workspace = (over: Obj = {}): Obj => ({
  id: 'ws',
  name: 'Workspace',
  repos: [{ id: 'repo', remote: 'git@example:docket/repo.git', defaultBranch: 'main' }],
  flows: ['main'],
  defaultFlow: 'main',
  commandSets: { build: ['npm run build'] },
  roleOverrides: [],
  docsRoot: 'docs',
  testGlobs: ['**/*.test.ts'],
  ...over,
});

const doc = (over: Obj = {}): Obj => ({
  roles: [role()],
  flows: [flow()],
  capabilities: [capability()],
  ...over,
});

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
      workspace: {
        id: 'main',
        name: 'Main',
        repos: [{ id: 'docket', remote: 'git@example:docket/docket.git', defaultBranch: 'v2' }],
        flows: ['default'],
        defaultFlow: 'default',
        commandSets: { build: ['npm run build', 'npm test'] },
        roleOverrides: [{ id: 'reviewer', active: true }],
        docsRoot: 'docs',
        testGlobs: ['**/*.test.ts'],
      },
    };

    const result = validateDefinitions(input);

    expect(result.ok).toBe(true);
    expect(expectOk(result)).toEqual(input);
  });

  it('accepts a document without a workspace', () => {
    const result = validateDefinitions(doc());
    expect(expectOk(result).workspace).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const input = doc({ workspace: workspace() });
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
      workspace: workspace({ defaultFlow: 'other' }),
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
        issue('workspace.defaultFlow', 'default_flow_not_enabled'),
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

  it('R-7: command gates must name a commandSet present in workspace.commandSets', () => {
    const okInput = doc({
      flows: [flow({ stages: [stage({ exit: [gate({ kind: 'command', commandSet: 'build' })] })] })],
      workspace: workspace(),
    });
    expect(validateDefinitions(okInput).ok).toBe(true);

    const badInput = doc({
      flows: [flow({ stages: [stage({ exit: [gate({ kind: 'command', commandSet: 'test' })] })] })],
      workspace: workspace(),
    });
    const issues = expectErr(validateDefinitions(badInput));
    expect(codesOf(issues)).toEqual(['unknown_command_set']);
    expect(issues[0]?.path).toBe('flows[0].stages[0].exit[0].commandSet');
  });

  it('R-7 edge: command gates pass when no workspace is given', () => {
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

  it('R-9: defaultFlow must be listed in workspace.flows and every listed flow must exist', () => {
    const notListed = doc({ workspace: workspace({ defaultFlow: 'other' }) });
    const notListedIssues = expectErr(validateDefinitions(notListed));
    expect(codesOf(notListedIssues)).toEqual(['default_flow_not_enabled']);
    expect(notListedIssues[0]?.path).toBe('workspace.defaultFlow');

    const ghost = doc({ workspace: workspace({ flows: ['main', 'ghost'] }) });
    const ghostIssues = expectErr(validateDefinitions(ghost));
    expect(codesOf(ghostIssues)).toEqual(['unknown_flow']);
    expect(ghostIssues[0]?.path).toBe('workspace.flows[1]');

    const both = doc({ workspace: workspace({ flows: ['main', 'ghost'], defaultFlow: 'other' }) });
    const bothIssues = expectErr(validateDefinitions(both));
    expect(bothIssues).toHaveLength(2);
    expect(bothIssues).toEqual(
      expect.arrayContaining([
        issue('workspace.flows[1]', 'unknown_flow'),
        issue('workspace.defaultFlow', 'default_flow_not_enabled'),
      ]),
    );
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

    const ws: Obj = { ...workspace() };
    delete ws.docsRoot;
    expect(codesOf(expectErr(validateDefinitions(doc({ workspace: ws }))))).toContain('missing_field');

    const repoNoRemote = doc({ workspace: workspace({ repos: [{ id: 'repo', defaultBranch: 'main' }] }) });
    const repoIssues = expectErr(validateDefinitions(repoNoRemote));
    expect(repoIssues).toEqual([issue('workspace.repos[0].remote', 'missing_field')]);
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
      codesOf(expectErr(validateDefinitions(doc({ capabilities: [capability({ kind: 'mcp', command: 'x', env: {} })] })))),
    ).toContain('missing_field');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ workspace: workspace({ commandSets: { build: 'npm run build' } }) })))),
    ).toContain('wrong_type');
    expect(
      codesOf(expectErr(validateDefinitions(doc({ workspace: workspace({ commandSets: { build: [42] } }) })))),
    ).toContain('wrong_type');
  });

  it('reports invalid_slug for malformed ids and slug-typed references', () => {
    const input = doc({
      roles: [role({ id: 'Bad' }), role()],
      flows: [flow({ stages: [stage({ onFail: { goto: 'Nope', maxAttempts: 2 } })] })],
      capabilities: [capability()],
      workspace: workspace({ id: 'WS' }),
    });

    const issues = expectErr(validateDefinitions(input));
    expect(issues).toHaveLength(3);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('roles[0].id', 'invalid_slug'),
        issue('flows[0].stages[0].onFail.goto', 'invalid_slug'),
        issue('workspace.id', 'invalid_slug'),
      ]),
    );
  });

  it('reports empty_flow for a flow with no stages', () => {
    const input = doc({ flows: [flow({ stages: [] })] });
    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['empty_flow']);
    expect(issues[0]?.path).toBe('flows[0].stages');
  });

  it('validates workspace roleOverrides against known roles', () => {
    const unknown = doc({ workspace: workspace({ roleOverrides: [{ id: 'ghost' }] }) });
    const unknownIssues = expectErr(validateDefinitions(unknown));
    expect(codesOf(unknownIssues)).toEqual(['unknown_role']);
    expect(unknownIssues[0]?.path).toBe('workspace.roleOverrides[0].id');

    const applies = doc({
      workspace: workspace({ roleOverrides: [{ id: 'dev', writeScope: { kind: 'docs' }, active: false }] }),
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
