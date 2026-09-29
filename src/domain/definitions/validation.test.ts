// definitions/validation.test.ts — E-1..E-5: environments, deploy and remote_checks gates.
// The issue names `../index` as the import, but that resolves to src/domain/index.ts, which the
// layer checker (D4) forbids domain-module files from importing. The definitions module barrel
// `./index` is the same discipline one level down.
import { describe, expect, it } from 'vitest';
import { validateDefinitions, type DefinitionIssue, type Definitions } from './index';

type Obj = Record<string, unknown>;
type ValidationResult = ReturnType<typeof validateDefinitions>;

const role = (over: Obj = {}): Obj => ({
  id: 'dev',
  name: 'Dev',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
  ...over,
});

const stage = (over: Obj = {}): Obj => ({ id: 'work', name: 'Work', role: 'dev', exit: [], ...over });

const flow = (over: Obj = {}): Obj => ({ id: 'main', name: 'Main', stages: [stage()], ...over });

const capability = (over: Obj = {}): Obj => ({
  kind: 'skill',
  id: 'sk',
  name: 'Skill',
  path: 'skills/sk.md',
  ...over,
});

const deployGate = (over: Obj = {}): Obj => ({ kind: 'deploy', id: 'ship', environment: 'stg', ...over });

const remoteChecksGate = (over: Obj = {}): Obj => ({
  kind: 'remote_checks',
  id: 'ci',
  required: 'all',
  timeoutMinutes: 10,
  ...over,
});

const env = (over: Obj = {}): Obj => ({
  id: 'stg',
  name: 'Staging',
  order: 1,
  deploy: 'build',
  env: {},
  protected: false,
  ...over,
});

const repo = (over: Obj = {}): Obj => ({
  id: 'ws',
  name: 'Repo',
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

const expectOk = (result: ValidationResult): Definitions => {
  if (!result.ok) throw new Error(`expected ok, got issues: ${JSON.stringify(result.error)}`);
  return result.value;
};

const expectErr = (result: ValidationResult): readonly DefinitionIssue[] => {
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
  it('E-1: EnvSlug follows the same parseSlug rules as other slugs', () => {
    const valid = doc({ repo: repo({ environments: [env({ id: 'dev' }), env({ id: 'stg', order: 2 })] }) });
    expect(validateDefinitions(valid).ok).toBe(true);

    for (const id of ['Stg', '-stg', 'stg_1', 's'.repeat(64), '']) {
      const input = doc({ repo: repo({ environments: [env({ id })] }) });
      const issues = expectErr(validateDefinitions(input));
      expect(codesOf(issues)).toEqual(['invalid_slug']);
      expect(issues[0]?.path).toBe('repo.environments[0].id');
    }
  });

  it('E-1 edge: promoteFrom and a deploy gate environment are slug-checked too', () => {
    const promote = doc({ repo: repo({ environments: [env({ promoteFrom: 'Stg' })] }) });
    const promoteIssues = expectErr(validateDefinitions(promote));
    expect(codesOf(promoteIssues)).toEqual(['invalid_slug']);
    expect(promoteIssues[0]?.path).toBe('repo.environments[0].promoteFrom');

    const gateInput = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [deployGate({ environment: 'Stg' })] })] })],
      repo: repo({ environments: [env()] }),
    });
    const gateIssues = expectErr(validateDefinitions(gateInput));
    expect(codesOf(gateIssues)).toEqual(['invalid_slug']);
    expect(gateIssues[0]?.path).toBe('flows[0].stages[0].exit[0].environment');
  });

  it('E-2: environment ids are unique within a repo', () => {
    const input = doc({ repo: repo({ environments: [env(), env({ name: 'Other', order: 2 })] }) });
    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['duplicate_id']);
    expect(issues[0]?.path).toBe('repo.environments[1].id');
  });

  it('E-2: order values are unique within a repo (duplicate_env_order)', () => {
    const input = doc({ repo: repo({ environments: [env(), env({ id: 'dev', order: 1 })] }) });
    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['duplicate_env_order']);
    expect(issues[0]?.path).toBe('repo.environments[1].order');

    const sparse = doc({ repo: repo({ environments: [env({ order: 3 }), env({ id: 'dev', order: 7 })] }) });
    expect(validateDefinitions(sparse).ok).toBe(true);
  });

  it('E-3: deploy and verify must name a commandSet present in repo.commandSets (env_command_set_missing)', () => {
    const deployMissing = doc({ repo: repo({ environments: [env({ deploy: 'nope' })] }) });
    const deployIssues = expectErr(validateDefinitions(deployMissing));
    expect(codesOf(deployIssues)).toEqual(['env_command_set_missing']);
    expect(deployIssues[0]?.path).toBe('repo.environments[0].deploy');

    const verifyMissing = doc({ repo: repo({ environments: [env({ verify: 'nope' })] }) });
    const verifyIssues = expectErr(validateDefinitions(verifyMissing));
    expect(codesOf(verifyIssues)).toEqual(['env_command_set_missing']);
    expect(verifyIssues[0]?.path).toBe('repo.environments[0].verify');

    const both = doc({ repo: repo({ environments: [env({ deploy: 'nope', verify: 'nope' })] }) });
    expect(expectErr(validateDefinitions(both))).toHaveLength(2);

    const fine = doc({ repo: repo({ environments: [env({ verify: 'build' })] }) });
    expect(validateDefinitions(fine).ok).toBe(true);
  });

  it('E-4: a deploy gate environment must name an environment in repo.environments (unknown_environment)', () => {
    const known = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [deployGate()] })] })],
      repo: repo({ environments: [env()] }),
    });
    expect(validateDefinitions(known).ok).toBe(true);

    const unknown = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [deployGate({ environment: 'ghost' })] })] })],
      repo: repo({ environments: [env()] }),
    });
    const issues = expectErr(validateDefinitions(unknown));
    expect(codesOf(issues)).toEqual(['unknown_environment']);
    expect(issues[0]?.path).toBe('flows[0].stages[0].exit[0].environment');
  });

  it('E-4 edge: no repo lets deploy gates pass; a repo without environments makes them unknown', () => {
    const noRepo = doc({ flows: [flow({ stages: [stage({ role: null, exit: [deployGate({ environment: 'ghost' })] })] })] });
    expect(validateDefinitions(noRepo).ok).toBe(true);

    const noEnvironments = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [deployGate()] })] })],
      repo: repo(),
    });
    const issues = expectErr(validateDefinitions(noEnvironments));
    expect(codesOf(issues)).toEqual(['unknown_environment']);
    expect(issues[0]?.path).toBe('flows[0].stages[0].exit[0].environment');
  });

  it('E-5: a protected environment must have promoteFrom set (missing_promote_from)', () => {
    const input = doc({ repo: repo({ environments: [env({ protected: true })] }) });
    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['missing_promote_from']);
    expect(issues[0]?.path).toBe('repo.environments[0].promoteFrom');

    const unprotected = doc({ repo: repo({ environments: [env({ protected: false })] }) });
    expect(validateDefinitions(unprotected).ok).toBe(true);
  });

  it('E-5: promoteFrom must name another environment with a lower order', () => {
    const higher = doc({
      repo: repo({
        environments: [env({ id: 'prd', order: 5, protected: true, promoteFrom: 'stg' }), env({ id: 'stg', order: 9 })],
      }),
    });
    const higherIssues = expectErr(validateDefinitions(higher));
    expect(codesOf(higherIssues)).toEqual(['promote_cycle']);
    expect(higherIssues[0]?.path).toBe('repo.environments[0].promoteFrom');

    const self = doc({ repo: repo({ environments: [env({ protected: true, promoteFrom: 'stg' })] }) });
    const selfIssues = expectErr(validateDefinitions(self));
    expect(codesOf(selfIssues)).toEqual(['promote_cycle']);
    expect(selfIssues[0]?.path).toBe('repo.environments[0].promoteFrom');
  });

  it('E-5: the promoteFrom chain must be acyclic (promote_cycle)', () => {
    const cycle = doc({
      repo: repo({
        environments: [
          env({ id: 'a', order: 3, protected: true, promoteFrom: 'b' }),
          env({ id: 'b', order: 2, protected: true, promoteFrom: 'c' }),
          env({ id: 'c', order: 1, protected: true, promoteFrom: 'a' }),
        ],
      }),
    });
    const issues = expectErr(validateDefinitions(cycle));
    expect(issues).toHaveLength(3);
    expect(issues).toEqual(
      expect.arrayContaining([
        issue('repo.environments[0].promoteFrom', 'promote_cycle'),
        issue('repo.environments[1].promoteFrom', 'promote_cycle'),
        issue('repo.environments[2].promoteFrom', 'promote_cycle'),
      ]),
    );

    const chain = doc({
      repo: repo({
        environments: [
          env({ id: 'dev' }),
          env({ id: 'stg', order: 2, promoteFrom: 'dev' }),
          env({ id: 'prd', order: 3, protected: true, promoteFrom: 'stg' }),
        ],
      }),
    });
    expect(validateDefinitions(chain).ok).toBe(true);
  });

  it('E-5 edge: promoteFrom naming an unknown environment is unknown_environment', () => {
    const input = doc({
      repo: repo({ environments: [env({ id: 'prd', order: 2, protected: true, promoteFrom: 'dev' })] }),
    });
    const issues = expectErr(validateDefinitions(input));
    expect(codesOf(issues)).toEqual(['unknown_environment']);
    expect(issues[0]?.path).toBe('repo.environments[0].promoteFrom');
  });

  it('accepts environments, deploy gates and remote_checks gates in a valid document', () => {
    const input = {
      roles: [role()],
      flows: [
        {
          id: 'release',
          name: 'Release',
          stages: [
            { id: 'work', name: 'Work', role: 'dev', exit: [{ kind: 'command', id: 'tests', commandSet: 'build' }] },
            {
              id: 'ship',
              name: 'Ship',
              role: null,
              exit: [
                remoteChecksGate({ required: ['lint', 'test'] }),
                deployGate({ id: 'deploy-stg' }),
                deployGate({ id: 'deploy-prd', environment: 'prd' }),
              ],
            },
          ],
        },
      ],
      capabilities: [capability()],
      repo: repo({
        flows: ['release'],
        defaultFlow: 'release',
        commandSets: {
          build: ['npm run build'],
          'deploy-stg': ['./deploy.sh stg'],
          'verify-stg': ['./verify.sh stg'],
          'deploy-prd': ['./deploy.sh prd'],
        },
        environments: [
          {
            id: 'stg',
            name: 'Staging',
            order: 1,
            deploy: 'deploy-stg',
            verify: 'verify-stg',
            env: { REGION: { literal: 'eu-1' }, API_TOKEN: { secretRef: 'stg-api-token' } },
            protected: false,
          },
          { id: 'prd', name: 'Production', order: 2, deploy: 'deploy-prd', env: {}, protected: true, promoteFrom: 'stg' },
        ],
      }),
    };

    const result = validateDefinitions(input);

    expect(result.ok).toBe(true);
    expect(expectOk(result)).toEqual(input);
  });

  it('parses remote_checks required as "all" or a string list and timeoutMinutes as a number', () => {
    const withAll = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [remoteChecksGate({ required: 'all' })] })] })],
    });
    expect(validateDefinitions(withAll).ok).toBe(true);

    const withList = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [remoteChecksGate({ required: ['lint', 'test'] })] })] })],
    });
    expect(validateDefinitions(withList).ok).toBe(true);

    const wrongWord = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [remoteChecksGate({ required: 'some' })] })] })],
    });
    const wordIssues = expectErr(validateDefinitions(wrongWord));
    expect(codesOf(wordIssues)).toEqual(['wrong_type']);
    expect(wordIssues[0]?.path).toBe('flows[0].stages[0].exit[0].required');

    const wrongItem = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [remoteChecksGate({ required: [42] })] })] })],
    });
    const itemIssues = expectErr(validateDefinitions(wrongItem));
    expect(codesOf(itemIssues)).toEqual(['wrong_type']);
    expect(itemIssues[0]?.path).toBe('flows[0].stages[0].exit[0].required[0]');

    const noRequired = remoteChecksGate() as Obj;
    delete noRequired.required;
    const requiredIssues = expectErr(
      validateDefinitions(doc({ flows: [flow({ stages: [stage({ role: null, exit: [noRequired] })] })] })),
    );
    expect(codesOf(requiredIssues)).toEqual(['missing_field']);
    expect(requiredIssues[0]?.path).toBe('flows[0].stages[0].exit[0].required');

    const noTimeout = remoteChecksGate() as Obj;
    delete noTimeout.timeoutMinutes;
    const timeoutIssues = expectErr(
      validateDefinitions(doc({ flows: [flow({ stages: [stage({ role: null, exit: [noTimeout] })] })] })),
    );
    expect(codesOf(timeoutIssues)).toEqual(['missing_field']);
    expect(timeoutIssues[0]?.path).toBe('flows[0].stages[0].exit[0].timeoutMinutes');

    const badTimeout = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [remoteChecksGate({ timeoutMinutes: '10' })] })] })],
    });
    const badTimeoutIssues = expectErr(validateDefinitions(badTimeout));
    expect(codesOf(badTimeoutIssues)).toEqual(['wrong_type']);
    expect(badTimeoutIssues[0]?.path).toBe('flows[0].stages[0].exit[0].timeoutMinutes');
  });

  it('reports missing_field and wrong_type for malformed environments input', () => {
    const notArray = doc({ repo: repo({ environments: 'x' }) });
    const arrayIssues = expectErr(validateDefinitions(notArray));
    expect(codesOf(arrayIssues)).toEqual(['wrong_type']);
    expect(arrayIssues[0]?.path).toBe('repo.environments');

    const notObject = doc({ repo: repo({ environments: [42] }) });
    const objectIssues = expectErr(validateDefinitions(notObject));
    expect(codesOf(objectIssues)).toEqual(['wrong_type']);
    expect(objectIssues[0]?.path).toBe('repo.environments[0]');

    for (const field of ['name', 'order', 'deploy', 'env', 'protected']) {
      const stripped = env() as Obj;
      delete stripped[field];
      const issues = expectErr(validateDefinitions(doc({ repo: repo({ environments: [stripped] }) })));
      expect(codesOf(issues)).toEqual(['missing_field']);
      expect(issues[0]?.path).toBe(`repo.environments[0].${field}`);
    }
  });

  it('applies EnvValue rules to environment env maps', () => {
    const secret = doc({
      repo: repo({ environments: [env({ env: { API_TOKEN: { literal: 'super-secret' } } })] }),
    });
    const secretIssues = expectErr(validateDefinitions(secret));
    expect(codesOf(secretIssues)).toEqual(['secret_literal']);
    expect(secretIssues[0]?.path).toBe('repo.environments[0].env.API_TOKEN');

    const bare = doc({ repo: repo({ environments: [env({ env: { REGION: 'eu-1' } })] }) });
    const bareIssues = expectErr(validateDefinitions(bare));
    expect(codesOf(bareIssues)).toEqual(['wrong_type']);
    expect(bareIssues[0]?.path).toBe('repo.environments[0].env.REGION');
  });

  it('does not mutate its input', () => {
    const input = doc({
      flows: [flow({ stages: [stage({ role: null, exit: [deployGate(), remoteChecksGate()] })] })],
      repo: repo({ environments: [env({ protected: true, promoteFrom: 'dev' }), env({ id: 'dev', order: 0 })] }),
    });
    deepFreeze(input);
    const result = validateDefinitions(input);
    expect(result.ok).toBe(true);
  });
});
