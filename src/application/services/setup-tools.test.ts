import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type RoleSlug, type RunId } from '../../domain/index';

import { createFakeClock, createFakeDeps, createFakeProposalRepo } from '../ports/fakes/index';
import { defaultSetupAnswers } from '../use-cases/setup';

import { createSetupTools, type SetupPathReader } from './setup-tools';
import { SetupReadGrants, type ReadContext, type ReadScope } from './setup-permissions';

const REPO = '/Users/op/work/widget';
const HOME = '/Users/op/.docket';

const runParsed = parseUlid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const roleParsed = parseSlug<'role'>('developer');
if (!runParsed.ok || !roleParsed.ok) throw new Error('fixture ids');
const AGENT: Actor = { kind: 'agent', runId: runParsed.value as RunId, role: roleParsed.value as RoleSlug };

const memoryReader = (files: Readonly<Record<string, string>>, dirs: Readonly<Record<string, readonly string[]>> = {}): SetupPathReader => ({
  resolve: (path) => (path.startsWith('/') ? path : `${REPO}/${path}`),
  read: async (path) => {
    if (dirs[path] !== undefined) return { kind: 'dir', names: [...dirs[path]] };
    const content = files[path];
    return content === undefined ? { kind: 'missing' } : { kind: 'file', content };
  },
});

const ctx = (reader: SetupPathReader) => ({
  scope: { paths: [REPO, HOME], sessionOnly: true } as ReadScope,
  readCtx: { repoFolder: REPO, docketHome: HOME } as ReadContext,
  grants: new SetupReadGrants(),
  reader,
});

describe('setup tools', () => {
  it('A-336: docket_read_path redacts secret-shaped file content', async () => {
    const reader = memoryReader({ [`${REPO}/note.txt`]: 'api_key="abcdefghijklmnopqrstuvwxyz"' });
    const tools = createSetupTools({ ...createFakeDeps(), proposals: createFakeProposalRepo(), clock: createFakeClock(1) }, ctx(reader));
    const response = await tools.call('docket_read_path', { path: `${REPO}/note.txt`, reason: 'inspect' }, AGENT);
    expect(response.ok).toBe(true);
    if (response.ok) expect(JSON.stringify(response.result)).toContain('[redacted]');
  });

  it('A-338: docket_setup_propose creates a project_setup proposal', async () => {
    const proposals = createFakeProposalRepo();
    const deps = createFakeDeps({ proposals, clock: createFakeClock(1) });
    const answers = defaultSetupAnswers('Widget', 'widget');
    const tools = createSetupTools(deps, ctx(memoryReader({})));
    const response = await tools.call(
      'docket_setup_propose',
      {
        project: (answers as { project: unknown }).project,
        repos: ['widget'],
        flow: (answers as { repo: { flow: unknown } }).repo.flow,
        defaultLimitPolicy: 'wait_resume',
        commandSets: { tests: ['npm test'] },
      },
      AGENT,
    );
    expect(response.ok).toBe(true);
    const listed = await proposals.list({});
    expect(listed).toHaveLength(1);
    expect(listed[0]?.target).toBe('project_setup');
  });
});
