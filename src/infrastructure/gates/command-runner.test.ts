import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCommandRunner } from './command-runner';

// The runner goes through /bin/sh -c, so every command below is POSIX; the Windows branch
// (cmd.exe) is implemented per the contract but not exercised by these tests. The skip sits on
// the describe so every rule title is registered through a literal it('I-n: …') call, which is
// what the rule-coverage check matches.
const describePosix = describe.skipIf(process.platform === 'win32');

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'docket-command-runner-'));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Generous ceiling for commands that must finish on their own; only the timeout tests run near it. */
const RUN_TIMEOUT_MS = 10_000;

/** True while the pid still names a live process (signal 0 is an existence probe). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until the command has written its pid file, tolerating the create/write window. */
async function pollForPid(pidFile: string): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(pidFile)) {
      const pid = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
      if (!Number.isNaN(pid)) return pid;
    }
    await delay(50);
  }
  throw new Error(`the command never wrote its pid to ${pidFile}`);
}

describePosix('createCommandRunner', () => {
  it('I-24: the command runs in the given cwd', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, 'pwd', RUN_TIMEOUT_MS);
    expect(result.exitCode).toBe(0);
    // macOS hands out /var/... temp paths that are symlinks to /private/var/...; pwd resolves them.
    expect(result.outputTail.trim()).toBe(realpathSync(cwd));
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it('I-24: the command goes through /bin/sh -c', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, 'echo a$(echo b)c', RUN_TIMEOUT_MS);
    expect(result.exitCode).toBe(0);
    expect(result.outputTail).toBe('abc\n');
  });

  it('I-24: the child environment is exactly config.env — nothing is inherited from process.env', async () => {
    const cwd = await tempDir();
    process.env.DOCKET_RUNNER_LEAK = 'leak-secret-value';
    try {
      // A 7-char value: visible to the command, yet below the 8-char redaction threshold.
      const runner = createCommandRunner({ env: { DOCKET_ONLY: 'own-val' } });
      // 'leak-secret-value' is 17 characters: if process.env ever leaked in, env redaction
      // would turn the probe into '[env]' instead of the expected empty brackets.
      const leakProbe = await runner.run(cwd, 'echo "[$DOCKET_RUNNER_LEAK]"', RUN_TIMEOUT_MS);
      expect(leakProbe.outputTail).toBe('[]\n');
      const ownValue = await runner.run(cwd, 'echo "$DOCKET_ONLY"', RUN_TIMEOUT_MS);
      expect(ownValue.exitCode).toBe(0);
      expect(ownValue.outputTail).toBe('own-val\n');
    } finally {
      delete process.env.DOCKET_RUNNER_LEAK;
    }
  });

  it('I-24: resolves with the command exit code and raw output', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const ok = await runner.run(cwd, 'echo hello', RUN_TIMEOUT_MS);
    expect(ok.exitCode).toBe(0);
    expect(ok.outputTail).toBe('hello\n');
    const failed = await runner.run(cwd, 'exit 3', RUN_TIMEOUT_MS);
    expect(failed.exitCode).toBe(3);
  });

  it(
    'I-25: a timed-out command returns exitCode 124 and leaves no child process',
    async () => {
      const cwd = await tempDir();
      const runner = createCommandRunner({ env: {} });
      // sh is the process-group leader; the background sleep is in the same group, so the
      // timeout must reach the whole group or the sleep survives.
      const result = await runner.run(cwd, 'sleep 30 & echo $!; wait', 200);
      expect(result.exitCode).toBe(124);
      expect(Number.isInteger(result.durationMs)).toBe(true);
      expect(result.durationMs).toBeLessThan(10_000);
      const pid = Number.parseInt(result.outputTail.trim(), 10);
      expect(Number.isNaN(pid)).toBe(false);
      const deadline = Date.now() + 5_000;
      while (pidAlive(pid) && Date.now() < deadline) await delay(50);
      expect(pidAlive(pid)).toBe(false);
    },
    15_000,
  );

  it('I-25: a spawn failure returns exitCode 127 and outputTail "spawn failed: <code>"', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(join(cwd, 'does-not-exist'), 'echo hi', RUN_TIMEOUT_MS);
    expect(result.exitCode).toBe(127);
    expect(result.outputTail).toBe('spawn failed: ENOENT');
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it('I-25: a command killed by SIGKILL exits with 137', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    // A process inside the command tree is SIGKILLed while the shell itself survives; sh reports
    // a signal death as 128 + signal number, so the run must surface 137 — a gate failure the
    // caller can tell apart from a timeout, which would report 124.
    const result = await runner.run(cwd, 'sleep 60 & pid=$!; kill -9 $pid; wait $pid', RUN_TIMEOUT_MS);
    expect(result.exitCode).toBe(137);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it(
    'I-25: a command that ignores the group SIGTERM is ended by the group SIGKILL',
    async () => {
      const cwd = await tempDir();
      const timeoutMs = 300;
      const killGraceMs = 200;
      const runner = createCommandRunner({ env: {}, killGraceMs });
      // The trap is installed before the child starts, so the shell and the background sleep both
      // ignore SIGTERM (an ignored disposition is inherited): only the escalation's group SIGKILL
      // can end the run. The child's pid lands in the cwd so the test can check it after the run.
      const resultPromise = runner.run(cwd, "trap '' TERM; sleep 60 & echo $! > killed.pid; wait $!", timeoutMs);
      const pid = await pollForPid(join(cwd, 'killed.pid'));
      const result = await resultPromise;
      expect(result.exitCode).toBe(124);
      // Outlasting the timeout plus the whole grace is the race-free proof that the group ignored
      // SIGTERM: a SIGTERM death would have closed the run at ~timeoutMs, so only the post-grace
      // group SIGKILL can explain a duration this long — no wall-clock waiting needed.
      expect(result.durationMs).toBeGreaterThanOrEqual(timeoutMs + killGraceMs);
      expect(result.durationMs).toBeLessThan(5_000);
      // The background sleep ignores SIGTERM too, so its death shows the group signal reached it.
      expect(pidAlive(pid)).toBe(false);
    },
    10_000,
  );

  it('I-26: outputTail interleaves stdout and stderr in arrival order', async () => {
    const cwd = await tempDir();
    // Two pipes have no cross-pipe write ordering, so the command pauses between writes:
    // each chunk is flushed and consumed before the next is produced, making the arrival
    // order the runner must preserve observable.
    const runner = createCommandRunner({ env: { PATH: '/usr/bin:/bin' } });
    const command = 'printf o1; sleep 0.2; printf e1 >&2; sleep 0.2; printf o2; sleep 0.2; printf e2 >&2';
    const result = await runner.run(cwd, command, RUN_TIMEOUT_MS);
    expect(result.exitCode).toBe(0);
    expect(result.outputTail).toBe('o1e1o2e2');
  });

  it('I-26: outputTail keeps the last tailBytes bytes', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {}, tailBytes: 10 });
    const result = await runner.run(cwd, "printf 'abcdefghij0123456789'", RUN_TIMEOUT_MS);
    expect(result.exitCode).toBe(0);
    expect(result.outputTail).toBe('0123456789');
  });

  it('I-26: outputTail defaults to the last 8192 bytes', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, `printf '${'x'.repeat(9000)}'`, RUN_TIMEOUT_MS);
    expect(result.outputTail.length).toBe(8192);
    expect(result.outputTail.endsWith('x'.repeat(64))).toBe(true);
  });

  it('I-26: the tail cut lands on a UTF-8 character boundary', async () => {
    const cwd = await tempDir();
    // 'abc' + U+1F600 (4 UTF-8 bytes) + 'def': 10 bytes in total; a 6-byte tail starts
    // inside the emoji and must drop the split character instead of decoding half of it.
    const emojiBytes = '\\360\\237\\230\\200';
    const aligned = createCommandRunner({ env: {} });
    expect((await aligned.run(cwd, `printf 'abc${emojiBytes}def'`, RUN_TIMEOUT_MS)).outputTail).toBe('abc\u{1F600}def');
    const misaligned = createCommandRunner({ env: {}, tailBytes: 6 });
    expect((await misaligned.run(cwd, `printf 'abc${emojiBytes}def'`, RUN_TIMEOUT_MS)).outputTail).toBe('def');
  });

  it('I-26: every env value of at least 8 characters is replaced with [env]', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: { DOCKET_VALUE: 'v'.repeat(14) } });
    const result = await runner.run(cwd, 'echo "$DOCKET_VALUE-$DOCKET_VALUE"', RUN_TIMEOUT_MS);
    expect(result.outputTail).toBe('[env]-[env]\n');
  });

  it('I-26: env values shorter than 8 characters are kept', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: { S: 'short' } });
    const result = await runner.run(cwd, 'echo "$S"', RUN_TIMEOUT_MS);
    expect(result.outputTail).toBe('short\n');
  });

  it('I-26: secret-looking output is replaced with [redacted]', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const secret = 'AKIA' + 'X'.repeat(16);
    const result = await runner.run(cwd, `echo ${secret}`, RUN_TIMEOUT_MS);
    expect(result.outputTail).toBe('[redacted]\n');
  });

  it('I-26: env redaction runs before secret redaction', async () => {
    const cwd = await tempDir();
    // The env value is itself secret-shaped: env redaction must turn it into '[env]' first,
    // leaving nothing for the secret patterns to match.
    const runner = createCommandRunner({ env: { K: 'sk-' + 'a'.repeat(32) } });
    const result = await runner.run(cwd, 'echo "$K"', RUN_TIMEOUT_MS);
    expect(result.outputTail).toBe('[env]\n');
  });

  it('I-24: a call-only env variable is visible to the command', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, 'echo "[$DOCKET_CALL_ONLY]"', RUN_TIMEOUT_MS, {
      DOCKET_CALL_ONLY: 'here',
    });
    expect(result.exitCode).toBe(0);
    expect(result.outputTail).toBe('[here]\n');
  });

  it('I-24: the call env adds to config.env — its entries stay visible', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: { DOCKET_BASE: 'cfg' } });
    const result = await runner.run(cwd, 'echo "$DOCKET_BASE-$DOCKET_EXTRA"', RUN_TIMEOUT_MS, {
      DOCKET_EXTRA: 'x2',
    });
    expect(result.outputTail).toBe('cfg-x2\n');
  });

  it('I-24: on a name clash the call env wins, and only for that call', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: { DOCKET_CLASH: 'cfg' } });
    const withCall = await runner.run(cwd, 'echo "$DOCKET_CLASH"', RUN_TIMEOUT_MS, {
      DOCKET_CLASH: 'call',
    });
    expect(withCall.outputTail).toBe('call\n');
    const withoutCall = await runner.run(cwd, 'echo "$DOCKET_CLASH"', RUN_TIMEOUT_MS);
    expect(withoutCall.outputTail).toBe('cfg\n');
  });

  it('I-24: nothing from process.env leaks in when only the call env is given', async () => {
    const cwd = await tempDir();
    process.env.DOCKET_RUNNER_CALL_LEAK = 'leak-call-value';
    try {
      const runner = createCommandRunner({ env: {} });
      const result = await runner.run(cwd, 'echo "[$DOCKET_RUNNER_CALL_LEAK]"', RUN_TIMEOUT_MS, {
        DOCKET_ONLY: 'cv',
      });
      expect(result.outputTail).toBe('[]\n');
    } finally {
      delete process.env.DOCKET_RUNNER_CALL_LEAK;
    }
  });

  it('I-26: a call env value of at least 8 characters is replaced with [env]', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, 'echo "$T"', RUN_TIMEOUT_MS, { T: 't'.repeat(12) });
    expect(result.outputTail).toBe('[env]\n');
  });

  it('I-26: a call env value shorter than 8 characters is kept', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, 'echo "$S"', RUN_TIMEOUT_MS, { S: 'tiny' });
    expect(result.outputTail).toBe('tiny\n');
  });

  it('I-26: config and call env values are redacted in the same output', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: { B: 'b'.repeat(9) } });
    const result = await runner.run(cwd, 'echo "$B-$C-$B"', RUN_TIMEOUT_MS, { C: 'c'.repeat(9) });
    expect(result.outputTail).toBe('[env]-[env]-[env]\n');
  });

  it('I-26: a secret-shaped call env value is redacted as [env], not [redacted]', async () => {
    const cwd = await tempDir();
    const runner = createCommandRunner({ env: {} });
    const result = await runner.run(cwd, 'echo "$K"', RUN_TIMEOUT_MS, { K: 'sk-' + 'c'.repeat(32) });
    expect(result.outputTail).toBe('[env]\n');
  });
});
