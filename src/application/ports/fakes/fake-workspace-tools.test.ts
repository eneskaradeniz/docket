import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type WorkOrderId, type WorkspaceSlug } from '../../../domain/index';

import type { CommandResult } from '../workspace-tools';

import {
  createFakeCommandRunner,
  createFakeEvidenceChecker,
  createFakeSecretScanner,
  createFakeWorktrees,
} from './fake-workspace-tools';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const wsSlug = (s: string): WorkspaceSlug => {
  const parsed = parseSlug<'workspace'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const woIdOf = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const ok: CommandResult = { exitCode: 0, durationMs: 3, outputTail: 'fine' };
const failing: CommandResult = { exitCode: 1, durationMs: 5, outputTail: 'broken' };

describe('createFakeCommandRunner', () => {
  it('returns the scripted result for an exact command string', async () => {
    const runner = createFakeCommandRunner();
    runner.script('npm test', failing);

    expect(await runner.run('/w', 'npm test', 60_000)).toEqual(failing);
    expect(await runner.run('/w', 'npm run build', 60_000)).toEqual({ exitCode: 0, durationMs: 0, outputTail: '' });
  });

  it('unscripted commands succeed with exit code 0 by default', async () => {
    const runner = createFakeCommandRunner();
    expect(await runner.run('/w', 'npm run lint', 1_000)).toEqual({ exitCode: 0, durationMs: 0, outputTail: '' });
  });

  it('scripts for the same command are consumed in registration order', async () => {
    const runner = createFakeCommandRunner();
    runner.script('npm test', ok);
    runner.script('npm test', failing);
    runner.script('npm test', ok);

    expect(await runner.run('/w', 'npm test', 1)).toEqual(ok);
    expect(await runner.run('/w', 'npm test', 1)).toEqual(failing);
    expect(await runner.run('/w', 'npm test', 1)).toEqual(ok);
    expect(await runner.run('/w', 'npm test', 1)).toEqual({ exitCode: 0, durationMs: 0, outputTail: '' });
  });

  it('records every call with its cwd, command and timeout', async () => {
    const runner = createFakeCommandRunner();
    await runner.run('/w1', 'npm test', 10);
    await runner.run('/w2', 'npm run lint', 20);

    expect(runner.calls()).toEqual([
      { cwd: '/w1', command: 'npm test', timeoutMs: 10 },
      { cwd: '/w2', command: 'npm run lint', timeoutMs: 20 },
    ]);
  });

  it('records the env a call passed', async () => {
    const runner = createFakeCommandRunner();
    const env: Readonly<Record<string, string>> = { DEPLOY_URL: 'https://stg.example' };

    await runner.run('/w', 'deploy', 10, env);

    expect(runner.calls()).toEqual([{ cwd: '/w', command: 'deploy', timeoutMs: 10, env }]);
  });

  it('records calls without env as having none', async () => {
    const runner = createFakeCommandRunner();
    await runner.run('/w', 'npm test', 10, { A: 'one' });
    await runner.run('/w', 'npm run lint', 20);

    const [first, second] = runner.calls();
    expect(first?.env).toEqual({ A: 'one' });
    expect(second?.env).toBeUndefined();
  });

  it('snapshots the env at call time; later caller mutations are not visible', async () => {
    const runner = createFakeCommandRunner();
    const env: Record<string, string> = { K: 'kept-value' };

    await runner.run('/w', 'deploy', 10, env);
    env.K = 'changed-after';

    const [call] = runner.calls();
    expect(call?.env).toEqual({ K: 'kept-value' });
  });
});

describe('createFakeSecretScanner', () => {
  it('reports zero findings by default and what setFindings scripts', async () => {
    const scanner = createFakeSecretScanner();
    expect(await scanner.scan('/w')).toEqual({ findings: 0 });

    scanner.setFindings(3);
    expect(await scanner.scan('/w')).toEqual({ findings: 3 });
  });

  it('records the scanned directories in order', async () => {
    const scanner = createFakeSecretScanner();
    await scanner.scan('/w1');
    await scanner.scan('/w2');
    expect(scanner.calls()).toEqual(['/w1', '/w2']);
  });
});

describe('createFakeEvidenceChecker', () => {
  it('resolves an empty pointer list (vacuously) and nothing else by default', async () => {
    const checker = createFakeEvidenceChecker();
    expect(await checker.resolvePointers('/w', [])).toBe(true);
    expect(await checker.resolvePointers('/w', ['src/a.ts:1'])).toBe(false);
  });

  it('resolves exactly the pointers setResolvable lists', async () => {
    const checker = createFakeEvidenceChecker();
    checker.setResolvable(['src/a.ts:1', 'src/b.ts:2']);

    expect(await checker.resolvePointers('/w', ['src/a.ts:1'])).toBe(true);
    expect(await checker.resolvePointers('/w', ['src/a.ts:1', 'src/b.ts:2'])).toBe(true);
    expect(await checker.resolvePointers('/w', ['src/a.ts:1', 'src/c.ts:3'])).toBe(false);
  });
});

describe('createFakeWorktrees', () => {
  it('ensures a deterministic worktree path per workspace and work order', async () => {
    const worktrees = createFakeWorktrees();
    const first = await worktrees.ensure(wsSlug('acme'), woIdOf(U1));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.path).toBe(`/fake/worktrees/acme/${U1}`);

    const second = await worktrees.ensure(wsSlug('other'), woIdOf(U1));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.path).toBe(`/fake/worktrees/other/${U1}`);
  });

  it('markNoRepo makes ensure fail with no_repo for that workspace only', async () => {
    const worktrees = createFakeWorktrees();
    worktrees.markNoRepo(wsSlug('acme'));

    const denied = await worktrees.ensure(wsSlug('acme'), woIdOf(U1));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe('no_repo');

    const allowed = await worktrees.ensure(wsSlug('other'), woIdOf(U1));
    expect(allowed.ok).toBe(true);
  });
});
