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
//   7. Part 3, no switch: the in-app modal shows (screenshot e2e/.out/managed-quit/modal.png),
//      Enter does not confirm, Esc cancels, "Kapat ve durdur" quits and cancels the run.
import { strict as assert } from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
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

// --- cleanup any leftovers at the start ---
try {
  const psOutput = execSync('ps -axo pid,ppid,command', { encoding: 'utf8' });
  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const [_, pidStr, _ppidStr, cmd] = match;
    const pid = parseInt(pidStr, 10);
    if (pid === process.pid || pid === process.ppid) continue;
    if (cmd.includes('agy') || cmd.includes('claude') || cmd.includes('managed-quit.mjs')) continue;
    if (cmd.includes('duman-agent') || cmd.includes('smoke-agent.mjs')) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }
} catch {
  // best effort cleanup
}

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
    type: 'workOrder.enqueue',
    id: SEED.workOrderId,
  });
  assert.ok(enqueueResult.ok, `workOrder.enqueue failed: ${JSON.stringify(enqueueResult)}`);

  const runInfo = await waitFor('active run started', async () => {
    const detail = await detailView();
    const active = detail.runs?.find((r) => r.endedAt === undefined || r.endedAt === null);
    return active === undefined ? undefined : active;
  }, 45_000);
  activeRunId = runInfo.id;
  assert.ok(activeRunId, 'run is active');

  await waitFor('fake agent process to spawn', async () => {
    const ps = execSync('ps -axo pid,ppid,command', { encoding: 'utf8' });
    const agentRunning = ps.split('\n').some((line) => line.includes(SEED.agentBin) && !line.includes('agy'));
    return agentRunning ? true : undefined;
  }, 15_000);
});

await spec('trigger quit with DOCKET_QUIT_CONFIRM=cancel: dialog cancels, run stays running', async () => {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
  await sleep(1_000);

  const detail = await detailView();
  const run = detail.runs?.find((r) => r.id === activeRunId);
  assert.ok(run, 'run still exists');
  assert.ok(run.endedAt === undefined || run.endedAt === null, 'run has not ended');

  const ps = execSync('ps -axo pid,ppid,command', { encoding: 'utf8' });
  const agentAlive = ps.split('\n').some((line) => line.includes(SEED.agentBin) && !line.includes('agy'));
  assert.ok(agentAlive, 'fake agent process is still alive after cancelled quit');
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

  const psOutput = execSync('ps -axo pid,ppid,command', { encoding: 'utf8' });
  const cleanLines = psOutput
    .split('\n')
    .filter((line) => !line.includes('agy') && !line.includes('claude') && !line.includes('managed-quit.mjs'));
  const leaked = cleanLines.filter(
    (line) =>
      line.includes(SEED.agentBin) ||
      line.includes('cursor-agent') ||
      line.includes('docket-mcp'),
  );
  assert.equal(leaked.length, 0, `leaked agent/helper processes found: ${leaked.join('; ')}`);

  // Assert no orphan from this test remains (grep on the fake agent's script path)
  const orphans = cleanLines.filter((line) => line.includes(SEED.agentBin));
  assert.equal(orphans.length, 0, `orphan process for fake agent script path found: ${orphans.join('; ')}`);

  // Verify the run outcome is marked 'cancelled'
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(SEED.dataDir, 'docket.db'));
  const row = db.prepare('SELECT data FROM runs WHERE id = ?').get(activeRunId);
  db.close();
  assert.ok(row, 'run record found in database');
  const record = JSON.parse(row.data);
  assert.equal(record.outcome, 'cancelled', `expected run outcome to be cancelled, saw ${record.outcome}`);
  assert.ok(record.endedAt, 'run endedAt is set');
});

// --- Part 3: no switch — the in-app modal answers (U-294, U-295) ---------------------------------
// A fresh seed and launch with DOCKET_QUIT_CONFIRM set to the empty string (the app reads it as
// unset, and the quiet launcher keeps a caller's value), so the quit raises the modal in the window.
const seed3Out = execFileSync('npx', ['tsx', 'e2e/seed-smoke.ts'], { cwd: ROOT, encoding: 'utf8' });
const seed3Line = seed3Out.trim().split('\n').find((line) => line.startsWith('SEED='));
if (seed3Line === undefined) throw new Error('the seed failed: no SEED= line');
const SEED3 = JSON.parse(seed3Line.slice(5));
const profile3 = freshProfile();
const OUT_DIR = join(ROOT, 'e2e', '.out', 'managed-quit');
mkdirSync(OUT_DIR, { recursive: true });

const app3 = await launchQuietElectron({
  args: [...profile3.args, join(ROOT, 'dist-electron', 'main.js')],
  env: {
    ...process.env,
    DOCKET_DATA_DIR: SEED3.dataDir,
    DOCKET_OPENCODE_BIN: SEED3.agentBin,
    DOCKET_QUIT_CONFIRM: '',
  },
});
await assertProfileIsolated(app3, profile3.dir);
const page3 = await app3.firstWindow();
const command3 = (body) => page3.evaluate(([actor, c]) => window.docket.command(actor, c), [OPERATOR, body]);
const detail3 = () => page3.evaluate((id) => window.docket.query({ type: 'workOrder.detail', id }), SEED3.workOrderId);
const agentAlive3 = () =>
  execSync('ps -axo pid,ppid,command', { encoding: 'utf8' })
    .split('\n')
    .some((line) => line.includes(SEED3.agentBin) && !line.includes('agy'));
const requestQuit = () => app3.evaluate(({ app: electronApp }) => electronApp.quit());
const modal = page3.locator('[data-quit-dialog]');
let run3;

await spec('modal part: start a long-lived run', async () => {
  assert.ok((await command3({ type: 'gate.decide', workOrderId: SEED3.workOrderId, gate: 'onay', decision: 'approved' })).ok, 'gate.decide');
  assert.ok((await command3({ type: 'workOrder.enqueue', id: SEED3.workOrderId })).ok, 'enqueue');
  run3 = await waitFor('active run started', async () => (await detail3()).runs?.find((r) => r.endedAt === undefined || r.endedAt === null), 45_000);
  await waitFor('fake agent process', async () => (agentAlive3() ? true : undefined), 15_000);
});

await spec('quit without the switch shows the in-app modal (no native dialog)', async () => {
  await requestQuit();
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  const text = await modal.innerText();
  assert.ok(text.includes('Docket kapatılsın mı?'), `title missing: ${text}`);
  assert.ok(text.includes('1 iş çalışıyor'), `count line missing: ${text}`);
  assert.ok(text.includes('Vazgeç') && text.includes('Kapat ve durdur'), `buttons missing: ${text}`);
  const focused = await page3.evaluate(() => document.activeElement?.textContent?.trim());
  assert.equal(focused, 'Vazgeç', 'Vazgeç holds the default focus');
  // The dialog enters with an opacity/translate/scale transition, so "visible" fires mid-entrance
  // and a screenshot there shows the bare cockpit. Wait for the entrance to settle first.
  const readDialog = () =>
    page3.evaluate(() => {
      const dialog = document.querySelector('[data-quit-dialog]');
      if (dialog === null) return null;
      const box = dialog.getBoundingClientRect();
      return { opacity: getComputedStyle(dialog).opacity, x: box.x, y: box.y, width: box.width, height: box.height };
    });
  await waitFor('quit dialog entrance to reach opacity 1', async () => {
    const snap = await readDialog();
    return snap !== null && snap.opacity === '1' ? true : undefined;
  }, 10_000);
  const settled = await readDialog();
  assert.ok(settled !== null, 'quit dialog is mounted');
  await sleep(100);
  const resampled = await readDialog();
  assert.ok(
    resampled !== null &&
      settled.x === resampled.x &&
      settled.y === resampled.y &&
      settled.width === resampled.width &&
      settled.height === resampled.height,
    'quit dialog bounding box is stable across two consecutive 100 ms samples',
  );
  await sleep(200);
  const { scrimCovers, dialogInside } = await page3.evaluate(() => {
    const scrim = document.querySelector('[data-quit-dialog-scrim]');
    const dialog = document.querySelector('[data-quit-dialog]');
    if (scrim === null || dialog === null) return { scrimCovers: false, dialogInside: false };
    const scrimBox = scrim.getBoundingClientRect();
    const dialogBox = dialog.getBoundingClientRect();
    return {
      scrimCovers: scrimBox.width >= window.innerWidth && scrimBox.height >= window.innerHeight,
      dialogInside:
        dialogBox.x >= 0 &&
        dialogBox.y >= 0 &&
        dialogBox.x + dialogBox.width <= window.innerWidth &&
        dialogBox.y + dialogBox.height <= window.innerHeight,
    };
  });
  assert.ok(scrimCovers, 'the quit scrim covers the window');
  assert.ok(dialogInside, 'the quit dialog sits inside the window');
  await page3.screenshot({ path: join(OUT_DIR, 'modal.png') });
});

await spec('Enter does not confirm; Escape cancels: app stays open and the run keeps running', async () => {
  await page3.keyboard.press('Enter'); // on Vazgeç this is its own press — but must never be a confirm
  await sleep(500);
  assert.equal(await app3.evaluate(() => true), true, 'app is still open');
  // Enter pressed Vazgeç (default focus), so the modal is gone: ask again and use Escape.
  await requestQuit();
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  await page3.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });
  await sleep(1_000);
  assert.equal(await app3.evaluate(() => true), true, 'app is still open after Escape');
  const run = (await detail3()).runs?.find((r) => r.id === run3.id);
  assert.ok(run && (run.endedAt === undefined || run.endedAt === null), 'run is still running');
  assert.ok(agentAlive3(), 'fake agent still alive');
});

await spec('quit again, click "Kapat ve durdur": app exits, run cancelled, nothing left', async () => {
  await requestQuit();
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  await page3.getByRole('button', { name: 'Kapat ve durdur' }).click();
  await waitFor('app process to close', async () => {
    try {
      await app3.evaluate(() => true);
      return undefined;
    } catch {
      return true;
    }
  }, 15_000);
  await sleep(500);
  assert.ok(!agentAlive3(), 'fake agent is gone');
  const leaked = execSync('ps -axo pid,ppid,command', { encoding: 'utf8' })
    .split('\n')
    .filter((line) => !line.includes('agy') && !line.includes('claude') && !line.includes('managed-quit.mjs'))
    .filter((line) => line.includes(SEED3.agentBin) || line.includes('cursor-agent') || line.includes('docket-mcp'));
  assert.equal(leaked.length, 0, `leaked processes: ${leaked.join('; ')}`);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(SEED3.dataDir, 'docket.db'));
  const row = db.prepare('SELECT data FROM runs WHERE id = ?').get(run3.id);
  db.close();
  assert.equal(JSON.parse(row.data).outcome, 'cancelled', 'run outcome is cancelled');
});

if (failures.length > 0) {
  console.error(`managed quit e2e failed (${failures.length} failures)`);
  process.exit(1);
}
console.log('managed quit e2e clean');
