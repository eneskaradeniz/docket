// e2e/ui.mjs — the Playwright-Electron driver (WO-0031): launches the BUILT app against a seeded temp
// db (DOCKET_DB_PATH + DOCKET_E2E), runs the Phase-A spec set, and drops screenshots into docs/ui-shots.
// Run: npm run test:ui  (builds first). Exit code = failing spec count.
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SHOTS = join(ROOT, 'docs', 'ui-shots');
mkdirSync(SHOTS, { recursive: true });

// seed
const seedOut = execFileSync('npx', ['tsx', 'e2e/seed.ts'], { cwd: ROOT, encoding: 'utf8' });
const dbLine = seedOut.trim().split('\n').find((l) => l.startsWith('DB='));
if (!dbLine) throw new Error('seed failed: no DB= line');
const DB = dbLine.slice(3);

const failures = [];
const spec = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${String(e).split('\n')[0]}`);
  }
};

const app = await electron.launch({
  args: [join(ROOT, 'dist-electron', 'main.js')],
  env: { ...process.env, DOCKET_DB_PATH: DB, DOCKET_E2E: '1', NODE_ENV: 'production' },
});
const win = await app.firstWindow();
const page = win;
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));
const consoleErrors = [];

await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(700); // board load effect

console.log('\nWO-0031 Phase-A UI specs');

await spec('window opens at the compact default (980×620, content)', async () => {
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  assert.equal(size[0], 980);
  assert.equal(size[1], 620);
});

await spec('board renders the seeded work orders', async () => {
  const cards = await page.locator('[data-wo-id]').count();
  assert.ok(cards >= 4, `expected ≥4 cards, got ${cards}`);
});

await spec('card opens the detail', async () => {
  // Phase A: the detail keeps its WO-0013 chrome (instrument restyle is Phase B) — assert the stable
  // back affordance + the work-order title heading.
  await page.locator('[data-wo-id]').first().click();
  await page.waitForTimeout(450);
  const back = await page.getByText('← İş emirleri').count();
  assert.ok(back >= 1, 'detail did not open (no back link)');
  const heading = await page.locator('h1').first().textContent();
  assert.ok(heading && heading.length > 0, 'no title heading on detail');
});

await spec('new-work-order dialog opens and ESC closes it', async () => {
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  const dialog = await page.locator('[role="dialog"]').count();
  assert.ok(dialog >= 1, 'dialog did not open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const after = await page.locator('[role="dialog"]').count();
  assert.equal(after, 0, 'dialog did not close on ESC');
});

await spec('detail: two-pane at 1400 (rail beside session)', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900));
  await page.waitForTimeout(300);
  const grid = await page.evaluate(() => {
    const el = document.querySelector('main .grid');
    return el ? getComputedStyle(el).gridTemplateColumns : '';
  });
  assert.ok(grid.includes('320px'), `expected a 320px rail column, got: ${grid}`);
  await page.screenshot({ path: join(SHOTS, 'detail@1400.png') });
});

await spec('detail: stacked at 980 (rail below session)', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(980, 620));
  await page.waitForTimeout(300);
  const grid = await page.evaluate(() => {
    const el = document.querySelector('main .grid');
    return el ? getComputedStyle(el).gridTemplateColumns : '';
  });
  assert.ok(!grid.includes('320px'), `expected stacked at 980, got: ${grid}`);
  await page.screenshot({ path: join(SHOTS, 'detail@980.png') });
});

await spec('detail rail: steps + evidence sections render on a stepped WO', async () => {
  // we are on the FIRST card's detail (written WO — no steps). Back to the board, open the stepped WO.
  await page.getByText('← İş emirleri').first().click();
  await page.waitForTimeout(400);
  await page.getByText('Uygulama sürüyor').first().click();
  await page.waitForTimeout(450);
  // the steps header carries an aside count in the same h2 (exact match won't hit) — assert the count
  // aside (1/1) and the evidence header instead.
  const stepsCount = await page.getByText('1/1', { exact: true }).count();
  const evidence = await page.getByText('Kanıtlar', { exact: true }).count();
  assert.ok(stepsCount >= 1, 'no steps section (1/1 aside missing)');
  assert.ok(evidence >= 1, 'no Kanıtlar section');
});

await spec('dialog FULLY visible at min window size (760×480)', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(760, 480));
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  const box = await page.locator('[role="dialog"]').boundingBox();
  assert.ok(box, 'dialog not found at min size');
  const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  assert.ok(box.y >= 0 && box.x >= 0, `dialog off-screen top/left: ${JSON.stringify(box)}`);
  assert.ok(box.y + box.height <= (vp?.height ?? 0) + 1, `dialog bottom cut: ${box.y + box.height} > ${vp?.height}`);
  assert.ok(box.x + box.width <= (vp?.width ?? 0) + 1, `dialog right cut: ${box.x + box.width} > ${vp?.width}`);
  await page.screenshot({ path: join(SHOTS, 'dialog@760.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

await spec('no horizontal overflow at 940×560', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 560));
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  assert.equal(overflow, 0, `horizontal overflow of ${overflow}px at 940px`);
  await page.screenshot({ path: join(SHOTS, 'board@940.png') });
});

await spec('no horizontal overflow at 1400×900', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 900));
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  assert.equal(overflow, 0, `horizontal overflow of ${overflow}px at 1400px`);
  await page.screenshot({ path: join(SHOTS, 'board@1400.png') });
});

await spec('zero renderer console errors', async () => {
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
});

await app.close();
console.log(failures.length ? `\n${failures.length} failing: ${failures.join(', ')}` : '\nall UI specs green');
process.exit(failures.length ? 1 : 0);
