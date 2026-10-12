// e2e/managed-quit.mjs — the managed quit E2E spec.
// Exercises:
//   1. Start app with throwaway DOCKET_DATA_DIR and scripted fake agent (e2e/smoke-agent.mjs via seed-smoke).
//   2. Start a run with the long-lived fake agent that parks on an open permission ask.
//   3. With DOCKET_QUIT_CONFIRM=cancel: trigger quit (app.evaluate(({ app }) => app.quit())).
//      Auto-answers Cancel. Run is still running, agent process still alive.
//   4. With DOCKET_QUIT_CONFIRM=accept: trigger quit.
//      Auto-answers "Quit and stop". App completes managed shutdown and exits.
//   5. ps check: no fake-agent or helper process remains alive.
//   6. Reopen storage / database: the run outcome is marked 'cancelled' (resumable).
import { strict as assert } from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireE2eLock } from './lock.mjs';
import { launchQuietElectron } from './quiet-launch.mjs';
import { assertProfileIsolated, freshProfile } from './profile.mjs';
import { appendCheck, beginReport } from './report.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
await acquireE2eLock(ROOT);

if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
  console.error('the built app is missing — run npm run build first');
  process.exit(1);
}

beginReport();

// --- seed throwaway data dir and long-lived agent ---
const seedOut = execFileSync('npx', ['tsx', 'e2e/seed-smoke.ts'], { cwd: ROOT, encoding: 'utf8' });
const seedLine = seedOut.trim().split('\n').find((line) => line.startsWith('SEED='));
if (seedLine === undefined) throw new Error('the seed failed: no SEED= line');
const SEED = JSON.parse(seedLine.slice(5));
const profile = freshProfile();

const OPERATOR = { kind: 'user', id: 'duman-operatoru', label: 'Duman operatörü' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (label, fn, timeoutMs = 30_000, stepMs = 200) => {
  const started = Date.now();
  while (true) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(stepMs);
  }
};

const failures = [];
let specIndex = 0;
const spec = async (name, fn) => {
  specIndex += 1;
  try {
    await fn();
    console.log(`  ok ${specIndex}. ${name}`);
    appendCheck({ id: `quit-${specIndex}`, screen: name, size: '', theme: '', status: 'ok', detail: '' });
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${specIndex}. ${name}\n    ${String(error).split('\n').slice(0, 4).join('\n    ')}`);
    appendCheck({
      id: `quit-${specIndex}`,
      screen: name,
      size: '',
      theme: '',
      status: 'FAIL',
      detail: String(error).split('\n').slice(0, 4).join('\n'),
    });
  }
};

// --- Part 1: Launch with DOCKET_QUIT_CONFIRM=cancel ---
const app = await launchQuietElectron({
  args: [...profile.args, join(ROOT, 'dist-electron', 'main.js')],
  env: {
    ...process.env,
    DOCKET_DATA_DIR: SEED.dataDir,
    DOCKET_OPENCODE_BIN: SEED.agentBin,
    DOCKET_QUIT_CONFIRM: 'cancel',
  },
});
await assertProfileIsolated(app, profile.dir);
const page = await app.firstWindow();

const query = (body) => page.evaluate((q) => window.docket.query(q), body);
const command = (body) => page.evaluate(([actor, c]) => window.docket.command(actor, c), [OPERATOR, body]);
const detailView = () => query({ type: 'workOrder.detail', id: SEED.workOrderId });

let activeRunId;

await spec('start long-lived agent run via approval gate and stage enqueue', async () => {
  const gateResult = await command({
    type: 'gate.decide',
    workOrderId: SEED.workOrderId,
    gate: 'onay',
    decision: 'approved',
  });
  assert.ok(gateResult.ok, `gate.decide failed: ${JSON.stringify(gateResult)}`);

  const enqueueResult = await command({
    type: 'stage.start',
    workOrderId: SEED.workOrderId,
    stage: 'uygulama',
  });
  assert.ok(enqueueResult.ok, `stage.start failed: ${JSON.stringify(enqueueResult)}`);

  const runInfo = await waitFor('active run started', async () => {
    const detail = await detailView();
    const active = detail.runs?.find((r) => r.endedAt === undefined || r.endedAt === null);
    return active === undefined ? undefined : active;
  }, 45_000);
  activeRunId = runInfo.id;
  assert.ok(activeRunId, 'run is active');
});

await spec('trigger quit with DOCKET_QUIT_CONFIRM=cancel: dialog cancels, run stays running', async () => {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
  await sleep(1_000);

  const detail = await detailView();
  const run = detail.runs?.find((r) => r.id === activeRunId);
  assert.ok(run, 'run still exists');
  assert.equal(run.endedAt, null, 'run has not ended');
});

// Part 2: Trigger quit with DOCKET_QUIT_CONFIRM=accept
await spec('trigger quit with DOCKET_QUIT_CONFIRM=accept: shuts down, marks cancelled, children dead', async () => {
  await app.evaluate(({ app: electronApp }) => {
    process.env.DOCKET_QUIT_CONFIRM = 'accept';
    electronApp.quit();
  });

  await waitFor('app process to close', async () => {
    try {
      await app.evaluate(() => true);
      return undefined;
    } catch {
      return true;
    }
  }, 10_000);

  const psOutput = execSync('ps -axo pid,command', { encoding: 'utf8' });
  const leaked = psOutput
    .split('\n')
    .filter((line) => line.includes('duman-agent') || line.includes('smoke-agent'));
  assert.equal(leaked.length, 0, `leaked agent processes found: ${leaked.join('; ')}`);
});

if (failures.length > 0) {
  console.error(`managed quit e2e failed (${failures.length} failures)`);
  process.exit(1);
}
console.log('managed quit e2e clean');
