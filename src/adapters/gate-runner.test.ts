// WO-0089 — the gate runner adapter: DOCKET executes the workspace's declared gate commands in
// the drive cwd (never the session — independence is the point), capturing exit + a bounded
// tail, under ONE host-wide lock (the antreo RAM case: N parallel drives' suites exhausted RAM
// and the OS killed processes; the lock is the order's hard dependency on WO-0088's landing).
import { describe, expect, it } from 'vitest';
import type { CommandResult, CommandRunner } from './git-console';
import { createGateLock, GATE_TAIL_CHARS, runLocalGate, shellGateSpawner, type GateSpawner } from './gate-runner';
import type { GateCommandSpec } from '../core/gate-config';

const gitOk = (sha: string): CommandRunner => async () => ({ exit: 0, stdout: `${sha}\n`, stderr: '' }) as CommandResult;
const gitBroken: CommandRunner = async () => ({ exit: 128, stdout: '', stderr: 'fatal: not a git repository' });

const spec = (command: string, expectExit = 0): GateCommandSpec => ({ command, expectExit });

describe('runLocalGate — what gets measured', () => {
  it('a passing command records exit 0 and the captured tail (both streams)', async () => {
    const spawner: GateSpawner = async (command) => (command === 'npm test' ? { exit: 0, out: 'ok\n3311 passed\n' } : { exit: 0, out: '' });
    const run = await runLocalGate({ spawner, lock: createGateLock(), gitRun: gitOk('deadbee'), cwd: '/repo', commands: [spec('npm test')] });
    expect(run.sha).toBe('deadbee');
    expect(run.results).toEqual([{ command: 'npm test', exit: 0, expectExit: 0, tail: 'ok\n3311 passed\n' }]);
    expect(typeof run.at).toBe('string');
    expect(run.at).not.toBe('');
  });

  it('a failing command records its MEASURED exit — measured-and-failed is data, never an exception', async () => {
    const spawner: GateSpawner = async () => ({ exit: 1, out: 'Changed test/build_config/orientation_drift_test.dart' });
    const run = await runLocalGate({ spawner, lock: createGateLock(), gitRun: gitOk('x'), cwd: '/repo', commands: [spec('dart format --set-exit-if-changed .')] });
    expect(run.results[0]!.exit).toBe(1);
    expect(run.results[0]!.expectExit).toBe(0);
  });

  it('a spawn failure records exit null (the unknown arm) with the reason riding the tail', async () => {
    const spawner: GateSpawner = async () => ({ exit: null, out: 'spawn ENOENT' });
    const run = await runLocalGate({ spawner, lock: createGateLock(), gitRun: gitOk('x'), cwd: '/repo', commands: [spec('make suite')] });
    expect(run.results[0]!.exit).toBeNull();
  });

  it('commands run in declaration order and all are recorded', async () => {
    const seen: string[] = [];
    const spawner: GateSpawner = async (command) => {
      seen.push(command);
      return { exit: 0, out: '' };
    };
    const run = await runLocalGate({ spawner, lock: createGateLock(), gitRun: gitOk('x'), cwd: '/repo', commands: [spec('a'), spec('b'), spec('c')] });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(run.results.map((r) => r.command)).toEqual(['a', 'b', 'c']);
  });

  it('the tail is bounded to the last GATE_TAIL_CHARS chars — evidence for the operator, not an archive', async () => {
    const big = 'x'.repeat(GATE_TAIL_CHARS + 1000);
    const spawner: GateSpawner = async () => ({ exit: 0, out: big });
    const run = await runLocalGate({ spawner, lock: createGateLock(), gitRun: gitOk('x'), cwd: '/repo', commands: [spec('big')] });
    expect(run.results[0]!.tail.length).toBe(GATE_TAIL_CHARS);
    expect(run.results[0]!.tail).toBe(big.slice(-GATE_TAIL_CHARS));
  });

  it('a cwd where rev-parse fails records the sha honestly empty — never a fabricated sha', async () => {
    const spawner: GateSpawner = async () => ({ exit: 0, out: '' });
    const run = await runLocalGate({ spawner, lock: createGateLock(), gitRun: gitBroken, cwd: '/nowhere', commands: [spec('x')] });
    expect(run.sha).toBe('');
  });
});

describe('the host-wide gate lock — the antreo RAM case', () => {
  const countingSpawner = (log: { inFlight: number; max: number; order: string[] }, ms: number): GateSpawner => async (command) => {
    log.inFlight++;
    log.max = Math.max(log.max, log.inFlight);
    log.order.push(`start ${command}`);
    await new Promise((r) => setTimeout(r, ms));
    log.order.push(`end ${command}`);
    log.inFlight--;
    return { exit: 0, out: '' };
  };

  it('acceptance 4 — two concurrent gate runs NEVER run commands simultaneously', async () => {
    const log = { inFlight: 0, max: 0, order: [] as string[] };
    const spawner = countingSpawner(log, 20);
    const lock = createGateLock();
    await Promise.all([
      runLocalGate({ spawner, lock, gitRun: gitOk('a'), cwd: '/one', commands: [spec('suite-one')] }),
      runLocalGate({ spawner, lock, gitRun: gitOk('b'), cwd: '/two', commands: [spec('suite-two')] }),
    ]);
    expect(log.max).toBe(1); // never two commands in flight at once
    expect(log.order).toEqual(['start suite-one', 'end suite-one', 'start suite-two', 'end suite-two']);
  });

  it('a failed run releases the lock — the queue never wedges on an error', async () => {
    const lock = createGateLock();
    const boom = (): Promise<void> => Promise.reject(new Error('gate blew up'));
    await expect(lock.exclusive(boom)).rejects.toThrow('gate blew up');
    const after = await lock.exclusive(async () => 'recovered');
    expect(after).toBe('recovered');
  });

  it('N concurrent runs all complete under the lock (the WO-0088 spine)', async () => {
    const log = { inFlight: 0, max: 0, order: [] as string[] };
    const spawner = countingSpawner(log, 5);
    const lock = createGateLock();
    const runs = Array.from({ length: 4 }, (_, i) =>
      runLocalGate({ spawner, lock, gitRun: gitOk(`s${i}`), cwd: `/r${i}`, commands: [spec(`cmd-${i}`)] }),
    );
    const done = await Promise.all(runs);
    expect(done).toHaveLength(4);
    expect(log.max).toBe(1);
  });
});

describe('shellGateSpawner — the real seam', () => {
  it('runs the command through /bin/sh in the cwd and reports a non-zero exit as data', async () => {
    const spawner = shellGateSpawner(5_000);
    const ok = await spawner('printf docket-gate-ok', process.cwd());
    expect(ok.exit).toBe(0);
    expect(ok.out).toContain('docket-gate-ok');
    const fail = await spawner('printf nope >&2; exit 3', process.cwd());
    expect(fail.exit).toBe(3);
    expect(fail.out).toContain('nope');
  });

  it('a command sh cannot find is a MEASURED 127 (sh measured it) — the reason rides the tail', async () => {
    const spawner = shellGateSpawner(5_000);
    const r = await spawner('docket-no-such-command-xyz', process.cwd());
    expect(r.exit).toBe(127);
    expect(r.out).toContain('docket-no-such-command-xyz');
  });

  it('a TIMED-OUT command is the true unknown arm — exit null, the timeout noted in the tail', async () => {
    const spawner = shellGateSpawner(60);
    const r = await spawner('sleep 2', process.cwd());
    expect(r.exit).toBeNull();
    expect(r.out).toContain('timed out');
  }, 10_000);
});
