import { describe, expect, it } from 'vitest';
import { gitHealth, type CommandResult, type CommandRunner } from './health';

// WO-0066 — gitHealth against observed shapes (WO-0062 §8's degradation classes, applied to git).

const res = (over: Partial<CommandResult>): CommandResult => ({ exit: 0, stdout: '', stderr: '', ...over });
const runWith = (r: CommandResult): CommandRunner => (args) => {
  expect(args).toEqual(['--version']);
  return Promise.resolve(r);
};

describe('gitHealth (WO-0066)', () => {
  it('ok with the parsed version token', async () => {
    expect(await gitHealth(runWith(res({ stdout: 'git version 2.50.1 (Apple Git-118)\n' })))).toEqual({
      tool: 'git',
      state: 'ok',
      version: '2.50.1',
    });
  });

  it('ok WITHOUT a version when the output shape is unrecognized — absence, never a guess', async () => {
    const health = await gitHealth(runWith(res({ stdout: 'some-other-git 9.9\n' })));
    expect(health.state).toBe('ok');
    expect('version' in health).toBe(false);
  });

  it('non-zero exit degrades with the stderr line', async () => {
    expect(await gitHealth(runWith(res({ exit: 1, stderr: 'git: error somewhere\n' })))).toEqual({
      tool: 'git',
      state: { degraded: 'git: error somewhere' },
    });
  });

  it('spawn failure (absent binary — exit 127) degrades with the carried message', async () => {
    expect(await gitHealth(runWith(res({ exit: 127, stderr: 'spawn git ENOENT' })))).toEqual({
      tool: 'git',
      state: { degraded: 'spawn git ENOENT' },
    });
  });

  it('a blank stderr falls back to the bare exit code', async () => {
    expect(await gitHealth(runWith(res({ exit: 128 })))).toEqual({
      tool: 'git',
      state: { degraded: 'git check failed (exit 128)' },
    });
  });
});
