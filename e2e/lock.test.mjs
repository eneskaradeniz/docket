// e2e/lock.test.mjs — WO-0101: the host-wide E2E lock, proven with real processes against a temp
// lock dir. Run: npm run test:e2e-lock (node:test; not part of vitest, which covers src/ only).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_MODULE = new URL('./lock.mjs', import.meta.url).href;

// A holder process: takes the lock, prints "got <t>", holds for `holdMs`, exits.
const holder = (lockDir, name, holdMs) => {
  const code = `import { acquireE2eLock } from ${JSON.stringify(LOCK_MODULE)};
await acquireE2eLock(${JSON.stringify(name)});
console.log('got ' + Date.now());
await new Promise((r) => setTimeout(r, ${holdMs}));
console.log('done ' + Date.now());`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, DOCKET_E2E_LOCK_DIR: lockDir, DOCKET_E2E_LOCK_POLL_MS: '50' },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  const stamp = (word) => Number((out.match(new RegExp(`${word} (\\d+)`)) ?? [])[1]);
  const until = async (word) => {
    while (!stamp(word)) await new Promise((r) => setTimeout(r, 20));
    return stamp(word);
  };
  return { child, exited, stamp, until, out: () => out };
};

const tempLock = () => join(mkdtempSync(join(tmpdir(), 'e2e-lock-')), 'e2e.lock');

test('a second suite waits until the first releases', async () => {
  const dir = tempLock();
  const a = holder(dir, 'A', 600);
  await a.until('got');
  const b = holder(dir, 'B', 10);
  await Promise.all([a.exited, b.exited]);
  assert.ok(b.stamp('got') >= a.stamp('done'), `B took the lock at ${b.stamp('got')} before A released at ${a.stamp('done')}`);
  assert.equal(existsSync(dir), false, 'the lock was left behind after both exited');
});

test('two suites started together never overlap', async () => {
  const dir = tempLock();
  const runs = [holder(dir, 'X', 300), holder(dir, 'Y', 300)];
  await Promise.all(runs.map((r) => r.exited));
  const [first, second] = runs.sort((p, q) => p.stamp('got') - q.stamp('got'));
  assert.ok(second.stamp('got') >= first.stamp('done'), 'the two holders overlapped');
});

test('a kill -9 holder is taken over, not waited on forever', async () => {
  const dir = tempLock();
  const a = holder(dir, 'A', 60_000);
  await a.until('got');
  a.child.kill('SIGKILL');
  await a.exited;
  assert.equal(existsSync(dir), true, 'SIGKILL cannot run a release — the dir must still be there');
  const b = holder(dir, 'B', 10);
  await b.until('got');
  await b.exited;
  assert.match(b.out(), /bayat kilit devralındı/);
});

test('SIGINT releases the lock', async () => {
  const dir = tempLock();
  const a = holder(dir, 'A', 60_000);
  await a.until('got');
  assert.equal(JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')).cwd, 'A');
  a.child.kill('SIGINT');
  const { code } = await a.exited;
  assert.equal(code, 130);
  assert.equal(existsSync(dir), false, 'Ctrl-C left the lock behind');
});
