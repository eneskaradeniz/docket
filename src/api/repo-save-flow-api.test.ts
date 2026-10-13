// A-354 through the api boundary: repo.saveFlow maps account_not_connected with every offender.
import { describe, expect, it } from 'vitest';

import type { Actor, RepoDef, RepoSlug, RoleDef, Ulid } from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';
import type { AccountRecord } from '../application/ports';
import {
  createFakeAccountRepo,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeRepoRegistry,
} from '../application/ports/fakes';

import { createApi } from './api';
import type { RepoFlowInput } from './commands';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid');
  return parsed.value;
};

const REPO: RepoSlug = slugOf<'repo'>('acme');
const CONNECTED = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');
const MISSING = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB4');

const WORKER: RoleDef = {
  id: slugOf<'role'>('worker'),
  name: 'Worker',
  instructions: 'Work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const baseRepoDef = (): RepoDef => ({
  id: REPO,
  name: 'Acme',
  commandSets: {},
  docsRoot: 'docs',
  testGlobs: [],
  defaultLimitPolicy: 'wait_resume',
  flow: {
    flowId: slugOf<'flow'>('flow-a'),
    version: 1,
    stages: [{ id: slugOf<'stage'>('implement'), name: 'Implement', role: WORKER.id, exit: [] }],
    bindings: [
      {
        stage: slugOf<'stage'>('implement'),
        role: { roleId: WORKER.id, version: 1 },
        accounts: [],
      },
    ],
  },
});

const flowInput = (accounts: readonly { readonly accountId: string }[]): RepoFlowInput => ({
  flowId: 'flow-a',
  version: 1,
  stages: [{ id: 'implement', name: 'Implement', role: 'worker', exit: [] }],
  bindings: [
    {
      stage: 'implement',
      role: { roleId: 'worker', version: 1 },
      accounts,
    },
  ],
});

const accountRecord = (id: Ulid<'account'>): AccountRecord => ({
  id,
  provider: 'provider-a',
  label: 'Work',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

const seededApi = async (withConnected = false) => {
  const repos = createFakeRepoRegistry();
  await repos.register({
    repoId: '01HZX0000000000000000000A1',
    slug: REPO,
    path: '/c/acme',
    fingerprint: { rootCommit: '' },
  });
  const definitions = createFakeDefinitionStore();
  await definitions.appendVersion('roles', 'worker', WORKER, 900);
  const repoDef = baseRepoDef();
  definitions.setRepoDef(REPO, repoDef);
  await definitions.writeFile({ kind: 'repo', repo: REPO }, 'repo.yaml', JSON.stringify(repoDef), '');
  const accounts = createFakeAccountRepo();
  if (withConnected) await accounts.save(accountRecord(CONNECTED));
  const deps = createFakeDeps({ repos, definitions, accounts });
  return { api: createApi(deps), definitions, repoDef };
};

describe('A-354 api', () => {
  it('A-354: repo.saveFlow answers account_not_connected with every disconnected stage and account', async () => {
    const { api } = await seededApi(false);
    const result = await api.command(ACTOR, { type: 'repo.saveFlow', repo: 'acme', flow: flowInput([{ accountId: MISSING }]) });
    expect(result).toEqual({
      ok: false,
      code: 'account_not_connected',
      accounts: [{ stage: 'implement', accountId: MISSING }],
    });
  });

  it('A-354: repo.saveFlow succeeds when every chained account is connected', async () => {
    const { api } = await seededApi(true);
    expect(await api.command(ACTOR, { type: 'repo.saveFlow', repo: 'acme', flow: flowInput([{ accountId: CONNECTED }]) })).toEqual({
      ok: true,
    });
  });
});
