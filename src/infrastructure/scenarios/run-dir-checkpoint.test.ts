// infrastructure/scenarios/run-dir-checkpoint.test.ts — rule I-62: a scripted run in a real git
// worktree. The transport writes the run-scoped provider config (carrying the run's token) the way
// the real transports do, and the agent writes a file into the worktree. After the run the
// checkpoint commits hold the agent's file and nothing of the config; the run directory is gone;
// the token is in no tracked file.
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type AgentEvent, type QueueItem, type RoleDef, type Ulid } from '../../domain/index';

import type { AgentTransport, RunRequest } from '../../application/index';
import { executeRun } from '../../application/index';
import {
  createFakeAccountRepo,
  createFakeClock,
  createFakeDeps,
  createFakeRunTokens,
  createFakeTransportResolver,
  createFakeWorkOrderRepo,
} from '../../application/ports/fakes/index';
import { createRunDirs } from '../compose/index';
import { BUILTIN_PROVIDER_DEFS } from '../providers/index';
import { writeRunConfig } from '../providers/launch/index';
import { createCheckpoints, runGit } from '../vcs/index';

const ulid = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid');
  return parsed.value;
};
const slug = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

const WORK_ORDER = ulid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ACCOUNT = ulid<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const T0 = 1_700_000_000_000;
const ROLE: RoleDef = { id: slug<'role'>('impl'), name: 'Impl', instructions: 'x', writeScope: { kind: 'repo' }, capabilities: [], active: true };
const ITEM: QueueItem = {
  id: ulid<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FAD'),
  workOrderId: WORK_ORDER,
  repo: slug('ws'),
  stage: slug<'stage'>('implement'),
  route: { accountId: ACCOUNT },
  priority: 0,
  enqueuedAt: T0,
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return result.stdout;
};

describe('run directory and checkpoints', () => {
  it('I-62: a run\'s provider config lives in its run directory — the worktree stays free of it, the checkpoint holds only the agent\'s work, the directory goes away with the run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dkt-rundir-'));
    roots.push(root);
    const dataDir = join(root, 'data');
    const worktree = join(root, 'worktree');
    await mkdir(worktree, { recursive: true });
    await git(worktree, ['init', '-b', 'main']);
    await git(worktree, ['config', 'user.name', 'Real User']);
    await git(worktree, ['config', 'user.email', 'real@user.example']);
    await writeFile(join(worktree, 'seed.txt'), 'seed\n');
    await git(worktree, ['add', 'seed.txt']);
    await git(worktree, ['commit', '-m', 'seed']);

    const runTokens = createFakeRunTokens();
    const transports = createFakeTransportResolver();
    const accounts = createFakeAccountRepo();
    const workOrders = createFakeWorkOrderRepo();
    const deps = createFakeDeps({
      clock: createFakeClock(T0),
      runTokens,
      transports,
      accounts,
      workOrders,
      runDirs: createRunDirs({ dataDir }),
      checkpoints: createCheckpoints({ redact: (text) => text }),
      mcpEndpoint: { socketPath: '/s', command: '/c', args: [], env: {} },
    });
    await workOrders.create({ id: WORK_ORDER, project: slug('proj'), repo: slug('ws'), flow: slug('standard'), title: 'T', createdAt: T0, createdBy: { kind: 'user', id: 'u', label: 'U' } });
    await accounts.save({ id: ACCOUNT, provider: 'p', label: 'Main', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });

    const seen: { runDir: string; configExistedDuringRun: boolean }[] = [];
    const agent: AgentTransport = {
      start: async (request: RunRequest) => {
        // What a real transport does with the capabilities it was given.
        const mcp = request.capabilities.flatMap((c) =>
          c.kind === 'mcp'
            ? [{ kind: 'mcp' as const, id: c.id, name: c.name, command: c.command, args: [...c.args], env: Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, 'literal' in v ? v.literal : ''])) }]
            : [],
        );
        const def = BUILTIN_PROVIDER_DEFS[0];
        if (def === undefined) throw new Error('a provider def');
        const config = await writeRunConfig(request.runDir, def, mcp);
        await writeFile(join(request.cwd, 'feature.txt'), 'the agent\'s work\n');
        await access(join(config.configDir, 'mcp.json'));
        seen.push({ runDir: request.runDir, configExistedDuringRun: true });
        const events = (async function* (): AsyncGenerator<AgentEvent, void> {
          yield { type: 'tool_result', at: T0 + 1, id: 't', ok: true };
          yield { type: 'finished', at: T0 + 2, reason: 'completed' };
        })();
        return { ok: true, value: { events, answerPermission: () => undefined, steer: () => undefined, stop: async () => undefined } };
      },
    };
    transports.register(ACCOUNT, agent);

    const outcome = await executeRun(deps, { onAsk: async () => 'allow' }, { item: ITEM, role: ROLE, prompt: 'go', cwd: worktree, capabilities: [] });
    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });

    const token = runTokens.minted()[0]?.token ?? '';
    expect(token).not.toBe('');
    expect(seen).toHaveLength(1);
    const runDir = seen[0]?.runDir ?? '';

    // The worktree: no config directory, a clean tree (the checkpoint took the agent's file), and
    // the commit holds exactly the agent's work.
    await expect(access(join(worktree, 'config'))).rejects.toThrow();
    expect(await git(worktree, ['status', '--porcelain'])).not.toMatch(/config\//);
    expect((await git(worktree, ['status', '--porcelain'])).trim()).toBe('');
    const tracked = (await git(worktree, ['ls-files'])).split('\n').filter((line) => line !== '');
    expect(tracked.sort()).toEqual(['feature.txt', 'seed.txt']);
    expect(tracked.some((file) => file.startsWith('config/'))).toBe(false);
    expect(await git(worktree, ['grep', '-c', token]).catch(() => 'none')).toBe('none');

    // The run directory lived outside the worktree and is gone now.
    expect(runDir.startsWith(`${worktree}/`)).toBe(false);
    expect(runDir.startsWith(join(dataDir, 'runs'))).toBe(true);
    await expect(access(runDir)).rejects.toThrow();
  });
});
