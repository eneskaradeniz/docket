// e2e/ui.mjs — the Playwright-Electron driver (WO-0031 → WO-0031c): launches the BUILT app against a
// seeded temp db (DOCKET_DB_PATH + DOCKET_E2E), runs the console spec set, and drops screenshots into
// docs/ui-shots. Under DOCKET_E2E the main process wires the scripted e2e-runner (electron/e2e-runner.ts)
// instead of the SDK — drives are REAL UI clicks answered by scripted RunnerEvents pushed through
// `window.docket.e2e.emit`, token-free.
//
// Harness rules (WO-0031c / audit A6 repair): every screenshot is named by the screen it ACTUALLY
// captures, and every spec that shoots the board navigates back to it first — filenames never lie.
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
const page = await app.firstWindow();
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

const setSize = async (w, h) => {
  await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [w, h]);
  await page.waitForTimeout(250);
};
const openDetail = async (title) => {
  await page.locator('[data-wo-id]', { hasText: title }).first().click();
  await page.waitForTimeout(450);
};
const backToBoard = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
};

await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(700); // board load effect

console.log('\nWO-0031c console specs');

await spec('window opens at the compact default (980×620, content)', async () => {
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  assert.equal(size[0], 980);
  assert.equal(size[1], 620);
});

await spec('board renders the seeded work orders', async () => {
  const cards = await page.locator('[data-wo-id]').count();
  assert.ok(cards >= 5, `expected ≥5 cards, got ${cards}`);
});

await spec('card opens the detail; esc goes back (v4: esc=geri)', async () => {
  await page.locator('[data-wo-id]').first().click();
  await page.waitForTimeout(450);
  const heading = await page.locator('h1').first().textContent();
  assert.ok(heading && heading.length > 0, 'no title heading on detail');
  const back = await page.locator('button[aria-label="← İş emirleri"]').count();
  assert.ok(back >= 1, 'no back affordance in the strip');
  await backToBoard();
  const cards = await page.locator('[data-wo-id]').count();
  assert.ok(cards >= 1, 'esc did not return to the board');
});

await spec('new-work-order dialog opens and ESC closes it (dialog outranks esc=back)', async () => {
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  const dialog = await page.locator('[role="dialog"]').count();
  assert.ok(dialog >= 1, 'dialog did not open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const after = await page.locator('[role="dialog"]').count();
  assert.equal(after, 0, 'dialog did not close on ESC');
  // the detail is NOT open here (we were on the board) — the board must still be showing
  const cards = await page.locator('[data-wo-id]').count();
  assert.ok(cards >= 1, 'board lost after dialog esc');
});

await spec('plan approval: step cards + rail Onayla/İtiraz; objection is an inline layer (esc peels it)', async () => {
  await openDetail('Plan bekliyor');
  assert.ok((await page.getByText('Mimar 1 adım önerdi').count()) >= 1, 'no plan approval cards');
  assert.ok((await page.getByRole('button', { name: 'Onayla', exact: true }).count()) >= 1, 'no rail Onayla');
  const glow = await page.locator('.glow-signal').count();
  assert.ok(glow >= 1, 'no amber glow at the decision moment');
  await page.getByRole('button', { name: 'İtiraz et' }).first().click();
  await page.waitForTimeout(250);
  assert.ok((await page.getByText('İtirazın ne?').count()) >= 1, 'objection layer did not open');
  await page.keyboard.press('Escape'); // peels the layer, NOT the screen
  await page.waitForTimeout(250);
  assert.equal(await page.getByText('İtirazın ne?').count(), 0, 'esc did not close the objection layer');
  assert.ok((await page.locator('h1').count()) >= 1, 'esc closed the whole screen instead of the layer');
  await backToBoard();
});

await spec('fake runner: Plan iste runs, rail owns the one Durdur (no filler line), stop reverts', async () => {
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: 'Plan iste' }).first().click();
  await page.waitForTimeout(500);
  const live = await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count();
  assert.ok(live >= 1, 'no running turn line');
  assert.ok((await page.locator('.glow-run').count()) >= 1, 'no running glow');
  const stopButtons = await page.getByRole('button', { name: 'Durdur', exact: true }).count();
  assert.equal(stopButtons, 1, `expected exactly one Durdur (the rail's), got ${stopButtons}`);
  const stopRailText = await page.locator('[data-rail]').textContent();
  assert.equal((stopRailText ?? '').trim(), 'Durdur', `rail carries more than the stop while running: ${stopRailText}`);
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(700); // wind-down + onEnd detail reload
  assert.ok((await page.getByRole('button', { name: 'Plan iste' }).count()) >= 1, 'rail did not revert after stop');
  await backToBoard();
});

await spec('stopped_asking: ask card + aria-live Sıra sende + quiet rail message (SADE)', async () => {
  await openDetail('İzin bekliyor');
  const live = await page.locator('[aria-live="polite"]').getByText('Sıra sende').count();
  assert.ok(live >= 1, 'no aria-live Sıra sende line');
  assert.ok((await page.getByRole('button', { name: 'İzin ver', exact: true }).count()) >= 1, 'no ask card');
  assert.ok((await page.getByText('Oturum durdu — maliyet işlemez.').count()) >= 1, 'no quiet rail message');
  assert.ok((await page.locator('.glow-signal').count()) >= 1, 'no amber glow while asking');
});

await spec('DETAY at 980: sections are tabs; the seeded terminal survives a tab switch (forceMount)', async () => {
  // still on 'İzin bekliyor' — its step is ACTIVE with a persisted transcript, so the Terminal tab
  // actually holds an xterm instance with content.
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('[role="tablist"]').count()) >= 1, 'no tab bar at 980');
  for (const tab of ['Terminal', 'Adımlar', 'Kanıt', 'Çizelge', 'Belgeler']) {
    assert.ok((await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).count()) >= 1, `no ${tab} tab`);
  }
  await page.getByRole('tab', { name: /Adımlar/ }).click();
  await page.waitForTimeout(250);
  assert.ok((await page.getByText('0/1', { exact: true }).count()) >= 1, 'steps section not shown');
  await page.getByRole('tab', { name: /Terminal/ }).click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('.xterm').count()) >= 1, 'terminal canvas gone after a tab switch');
  await page.screenshot({ path: join(SHOTS, 'detail-tabs@980.png') });
});

await spec('DETAY at 1240: the 250px rack beside the content, no tabs', async () => {
  await setSize(1240, 620);
  assert.equal(await page.locator('[role="tablist"]').count(), 0, 'tab bar at ≥1080');
  const grid = await page.evaluate(() => {
    const el = document.querySelector('main .grid');
    return el ? getComputedStyle(el).gridTemplateColumns : '';
  });
  assert.ok(grid.includes('250px'), `expected a 250px rack column, got: ${grid}`);
  await page.screenshot({ path: join(SHOTS, 'detail-rack@1240.png') });
});

await spec('SADE/DETAY is remembered across a reload (global view mode)', async () => {
  await page.reload();
  await page.waitForTimeout(700);
  await setSize(980, 620); // back to the tab-width before asserting tabs (we were 1240/rack before reload)
  await openDetail('İzin bekliyor');
  await page.waitForTimeout(400);
  assert.ok((await page.locator('[role="tablist"]').count()) >= 1, 'DETAY not remembered after reload');
  await page.getByRole('button', { name: 'SADE' }).first().click(); // leave it tidy for later specs
  await page.waitForTimeout(250);
  await backToBoard();
});

await spec('closed WO: green glow, closure card, and NO rail (arşivde ray yok)', async () => {
  // the closed cards live in the collapsed drawer — open it first
  await page.locator('details > summary').click();
  await page.waitForTimeout(250);
  await openDetail('Kapandı');
  assert.ok((await page.locator('.glow-done').count()) >= 1, 'no green glow on a closed WO');
  assert.ok((await page.getByText('Kapandı', { exact: true }).count()) >= 1, 'no closure card');
  assert.equal(await page.locator('[data-rail]').count(), 0, 'a closed WO rendered a rail');
  await backToBoard();
});

await spec('dialog FULLY visible at min window size (760×480)', async () => {
  await setSize(760, 480);
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

await spec('no horizontal overflow at 940×560 on the board (A6: shot taken ON the board)', async () => {
  await setSize(940, 560);
  const cards = await page.locator('[data-wo-id]').count();
  assert.ok(cards >= 1, 'not on the board for the board shot');
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  assert.equal(overflow, 0, `horizontal overflow of ${overflow}px at 940px`);
  await page.screenshot({ path: join(SHOTS, 'board@940.png') });
});

await spec('zero renderer console errors', async () => {
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
});

await app.close();
console.log(failures.length ? `\n${failures.length} failing: ${failures.join(', ')}` : '\nall UI specs green');
process.exit(failures.length ? 1 : 0);
