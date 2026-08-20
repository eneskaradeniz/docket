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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// gates cadence chains drives (step → review → verdict → next step…): stop whatever is running
// until the chain rests, or the one-drive-at-a-time rule blocks the next spec.
const stopAllDrives = async () => {
  for (let i = 0; i < 4; i++) {
    const btn = page.getByRole('button', { name: 'Durdur', exact: true });
    if ((await btn.count()) === 0) return;
    await btn.first().click();
    await page.waitForTimeout(700);
  }
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

await spec('card Süre is the finished-session sum, drawn only when > 0 (WO-0031f T3)', async () => {
  // wo3 'Uygulama sürüyor': 6dk + 2dk dated sessions → '8dk 0sn' beside the cost
  const busy = await page.locator('[data-wo-id]', { hasText: 'Uygulama sürüyor' }).first().textContent();
  assert.ok(busy && busy.includes('8dk 0sn'), `no session-sum duration on the busy card: ${busy}`);
  // the fresh WO (zero sessions) draws neither cost nor Süre
  const fresh = await page.locator('[data-wo-id]', { hasText: 'Yeni iş emri örneği' }).first().textContent();
  assert.ok(fresh && !/\d+dk/.test(fresh), `never-run card draws a duration: ${fresh}`);
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
  // v4: the stopped state offers Sürdür (the interrupted session resumes), not a fresh Plan iste
  assert.ok((await page.getByRole('button', { name: /Sürdür/ }).count()) >= 1, 'no Sürdür after the wind-down');
  assert.ok((await page.getByText('Durduruldu. Rapor kısmi kalır.').count()) >= 1, 'no stopped rail message');
  await backToBoard();
});

await spec('stopped_asking: ask card + aria-live Sıra sende + quiet rail message (SADE)', async () => {
  await openDetail('İzin bekliyor');
  const live = await page.locator('[aria-live="polite"]').getByText('Sıra sende').count();
  assert.ok(live >= 1, 'no aria-live Sıra sende line');
  assert.ok((await page.getByRole('button', { name: 'İzin ver', exact: true }).count()) >= 1, 'no ask card');
  assert.ok((await page.getByText('Oturum durdu — maliyet işlemez.').count()) >= 1, 'no quiet rail message');
  assert.ok((await page.locator('.glow-signal').count()) >= 1, 'no amber glow while asking');
  // WO-0031d: the window title carries the waiting counter ((n) izin bekliyor)
  const title = await page.title();
  assert.match(title, /^\(\d+\) izin bekliyor$/, `title counter missing: ${title}`);
});

await spec('DETAY at 980: two surfaces — Akış | Kayıt; the terminal lives in the driven row (WO-0031f)', async () => {
  // still on 'İzin bekliyor' — its step is ACTIVE with a persisted transcript, so the spine's
  // driven row actually holds an xterm instance with content.
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('[role="tablist"]').count()) >= 1, 'no tab bar at 980');
  // v6 Y-3: EXACTLY two tabs — Akış (done/total steps) and Kayıt (satisfied/total evidence)
  const tabs = await page.locator('[role="tab"]').allTextContents();
  assert.equal(tabs.length, 2, `expected exactly 2 tabs, got: ${tabs.join(' | ')}`);
  assert.ok(tabs[0]?.includes('Akış'), `the first tab is not Akış: ${tabs[0]}`);
  assert.ok(tabs[0]?.includes('0/1'), `Akış carries no done/total count: ${tabs[0]}`);
  assert.ok(tabs[1]?.includes('Kayıt'), `the second tab is not Kayıt: ${tabs[1]}`);
  assert.ok(/\d+\/\d+/.test(tabs[1] ?? ''), `Kayıt carries no evidence count: ${tabs[1]}`);
  // S1-C: the active tab wears the signal underline
  const underline = await page.evaluate(() => {
    const el = document.querySelector('[role="tab"][data-state="active"]');
    return el ? getComputedStyle(el).boxShadow : 'missing';
  });
  assert.ok(underline.includes('245, 181, 68'), `the active tab has no signal underline: ${underline}`);
  // Y-2: the Çizelge surface is DEAD everywhere
  assert.equal(await page.getByRole('tab', { name: /Çizelge/ }).count(), 0, 'a Çizelge tab still exists');
  assert.equal(await page.getByText('Çizelge', { exact: true }).count(), 0, 'a Çizelge surface still exists');
  // the terminal is INLINE in the driven step's row (pinned — no toggle hides it)
  assert.ok((await page.locator('[data-step-live] .xterm').count()) >= 1, 'no xterm inside the driven step row');
  await page.getByRole('tab', { name: /Kayıt/ }).click();
  await page.waitForTimeout(250);
  // tur-2 A2: the click actually SWITCHES panels — the active one is visible, the other hidden
  // (forceMount keeps the xterm alive; the old spec passed tautologically with everything stacked).
  assert.equal(await page.locator('[role="tabpanel"][data-state="active"]').count(), 1, 'not exactly one active panel');
  assert.ok(await page.locator('[role="tabpanel"][data-state="active"]').isVisible(), 'the active panel is hidden');
  const inactive = page.locator('[role="tabpanel"][data-state="inactive"]');
  assert.ok((await inactive.count()) >= 1, 'no inactive panels to hide');
  assert.ok(await inactive.first().isHidden(), 'an inactive panel stayed visible');
  await page.getByRole('tab', { name: /Akış/ }).click();
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

await spec('closed WO: green glow, closure card, NO rail, and the ledger IS the body (v4 §4)', async () => {
  // WO-0031f T1: the closed cards sit behind the toggle — 1 closed ≤5, so it starts OPEN
  assert.ok((await page.locator('[data-closed-toggle]').count()) >= 1, 'no closed-list toggle on the mixed board');
  await openDetail('Kapandı');
  assert.ok((await page.locator('.glow-done').count()) >= 1, 'no green glow on a closed WO');
  assert.ok((await page.getByText('Kapandı', { exact: true }).count()) >= 1, 'no closure card');
  // tur-2 A1: the substrip says Kapandı (TurnState 'done'), never a false "Sıra sende"
  assert.ok((await page.locator('[aria-live="polite"]').getByText('Kapandı').count()) >= 1, 'substrip does not say Kapandı');
  assert.equal(await page.locator('[aria-live="polite"]').getByText('Sıra sende').count(), 0, 'closed WO claims Sıra sende');
  // tur-2 A3: the closure sha is the short form (7 chars; the full sha rides the title attribute)
  // (the seeded repo has no commits — the store's honest 'uncommitted' marker rides the same short slot)
  const shaText = await page.locator('[data-closure-card] button').first().textContent();
  assert.ok(shaText && shaText.trim().length <= 7, `sha is not the short form: ${shaText}`);
  assert.equal(await page.locator('[data-rail]').count(), 0, 'a closed WO rendered a rail');
  // the session ledger renders by default in the archive: 3 rows + the Toplam line
  assert.ok((await page.locator('[data-audit-table] tbody tr').count()) >= 4, 'no audit table rows on the closed WO');
  assert.ok((await page.getByText('Bağımsız', { exact: true }).count()) >= 1, 'the unscoped session is not named Bağımsız');
  assert.equal(await page.getByText('Adım 0', { exact: false }).count(), 0, 'an "Adım 0" row leaked into the ledger');
  assert.ok((await page.getByText('Toplam', { exact: true }).count()) >= 1, 'no Toplam row');
  assert.ok((await page.getByText('$6,27', { exact: true }).count()) >= 1, 'the total cost is not the honest sum');
  // WO-0031e tur-3: every session of this closed WO has an EMPTY transcript — no row may render
  // an expander (absent, never disabled)
  assert.equal(await page.locator('[data-audit-toggle]').count(), 0, 'expanders rendered for empty transcripts');
  await backToBoard();
});

// ===== WO-0031c c2 specs (rules, editing, notifications) =====

await spec('risky ask: riskli yazım tag + İzin ver resolves + the timeline records the decision', async () => {
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: 'Plan iste' }).first().click();
  await page.waitForTimeout(500);
  // a RISKY write ask (the settings default is risky_excluded → only risky asks surface)
  await page.evaluate(() => window.docket.e2e?.emit({
    kind: 'permission_request',
    requestId: 'r-e2e-risky',
    tool: 'Write',
    input: { file_path: '.github/workflows/check.yml', content: 'name: ci\n' },
  }));
  await page.waitForTimeout(400);
  assert.ok((await page.getByText('riskli yazım').count()) >= 1, 'no risky tag on the ask card');
  assert.ok((await page.getByRole('button', { name: 'Bu iş emri için hep otomatik' }).count()) >= 1, 'no always-auto lift');
  assert.ok((await page.getByText('Oturum durdu — maliyet işlemez.').count()) >= 1, 'no asking rail line');
  await page.getByRole('button', { name: 'İzin ver', exact: true }).first().click();
  await page.waitForTimeout(400);
  // end the turn; WO-0031f Y-2 killed the Çizelge surface, so the decision is asserted where it
  // still lives — the stored event stream (the port is untouched; only the UI section died)
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(600);
  const decisionKinds = await page.evaluate(async () => {
    const wos = await window.docket.source.getWorkOrders();
    const wo = wos.find((w) => w.title === 'Yeni iş emri örneği');
    const evs = await window.docket.source.getWorkOrderEvents(wo.id);
    return evs.map((e) => e.kind);
  });
  assert.ok(decisionKinds.includes('permission_decision'), `the event stream lost the permission decision: ${decisionKinds.join(',')}`);
  await backToBoard();
});

await spec('rule lift from the ask card: badge flips, timeline logs, confirm toast', async () => {
  await openDetail('Yeni iş emri örneği');
  // the strip badge shows the default (risky_excluded) before the lift
  assert.ok((await page.locator('[data-permission-rule="risky_excluded"]').count()) >= 1, 'no default rule badge');
  await page.getByRole('button', { name: 'Plan iste' }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.docket.e2e?.emit({
    kind: 'permission_request',
    requestId: 'r-e2e-lift',
    tool: 'Write',
    input: { file_path: '.github/workflows/check.yml', content: 'x' },
  }));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Bu iş emri için hep otomatik' }).click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('[data-permission-rule="full_auto"]').count()) >= 1, 'the badge did not flip to full_auto');
  assert.ok((await page.getByText('Kural kaydedildi').count()) >= 1, 'no confirm toast');
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(500);
  await backToBoard();
});

await spec('plan editing: Düzenle → role cycle → aim edit → add → counter → edited approval lands', async () => {
  await openDetail('Plan bekliyor');
  await page.locator('[data-rail]').getByRole('button', { name: 'Düzenle' }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.getByText('+ Adım ekle').count()) >= 1, 'the editor did not open');
  // cycle step 1's role chip: implementer → architect
  await page.locator('[data-plan-cards] button[aria-label^="Rol:"]').first().click();
  await page.waitForTimeout(150);
  // edit step 1's aim
  await page.locator('[data-plan-cards] input').first().fill('düzenlenmiş adım');
  // add a second step and type into it
  await page.getByRole('button', { name: '+ Adım ekle' }).click();
  await page.waitForTimeout(150);
  await page.locator('[data-plan-cards] input').nth(1).fill('eklenen adım');
  await page.waitForTimeout(250);
  // the count is per-STEP (aim+role on one step = one change): step-1 edited + one added = 2
  assert.ok((await page.getByText('2 değişiklik', { exact: false }).count()) >= 1, 'no change counter in the rail');
  await page.getByRole('button', { name: 'Onayla', exact: true }).first().click();
  await page.waitForTimeout(700);
  // the plan is approved; WO-0031f Y-2 killed the Çizelge surface, so the edited approval is
  // asserted in the stored event stream (detail 'edited:N' — what the dead timeline rendered from)
  assert.ok((await page.getByText('Plan hazır', { exact: true }).count()) === 0, 'approval did not land');
  const approved = await page.evaluate(async () => {
    const wos = await window.docket.source.getWorkOrders();
    const wo = wos.find((w) => w.title === 'Plan bekliyor');
    const evs = await window.docket.source.getWorkOrderEvents(wo.id);
    return evs.find((e) => e.kind === 'plan_approved')?.detail ?? '';
  });
  assert.equal(approved, 'edited:2', `the edited approval did not land in the event stream: ${approved}`);
  // gates cadence: approval chained the drives ("Onayla — adımlar sırayla koşar") — stop the whole
  // chain (step + the auto-review it triggers) before leaving.
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(200);
  await stopAllDrives();
  await backToBoard();
});

await spec('create + plan in one step: Oluştur ve plan iste starts the architect on arrival', async () => {
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  assert.ok((await page.getByText('İzin kuralı — ajan sizden ne zaman izin istesin').count()) >= 1, 'no rule field in create modal');
  assert.ok((await page.getByRole('button', { name: 'Kapılarda', exact: true }).count()) >= 1, 'review options not renamed');
  await page.locator('[role="dialog"] input').first().fill('Tek adımda oluşturulan iş emri');
  await page.getByRole('button', { name: 'Oluştur ve plan iste' }).click();
  await page.waitForTimeout(2000);
  const live = await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count();
  assert.ok(live >= 1, 'the architect did not auto-start after create+plan');
  // stop the drive and clean up: delete the throwaway WO
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(600);
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

// ===== WO-0031d specs (ADR-0012 contract, gating, dialogs, results card) =====

await spec('substrip: step segments replace the esc hint (adım N/T + cells)', async () => {
  await setSize(980, 620);
  await openDetail('İzin bekliyor'); // 1 step, active (not done)
  assert.ok((await page.locator('[data-segments="1"]').count()) >= 1, 'no segment group in the substrip');
  assert.ok((await page.locator('[data-seg]').count()) >= 1, 'no segment cells');
  assert.ok((await page.getByText('adım 0/1').count()) >= 1, 'no adım N/T readout');
  assert.equal(await page.getByText('esc geri').count(), 0, 'the standing esc hint still renders');
  // tur-2 A7 → WO-0031f: the segments are a real jump — click → DETAY + the Akış surface active
  await page.locator('button[data-segments]').first().click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('[role="tablist"]').count()) >= 1, 'the jump did not switch to DETAY');
  const activeTab = await page.locator('[role="tab"][data-state="active"]').first().textContent();
  assert.ok(activeTab && activeTab.includes('Akış'), `the jump did not select Akış: ${activeTab}`);
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(250);
  await backToBoard();
});

await spec('substrip band: sıra · odak · ilerleme in one breath (WO-0031f H-4)', async () => {
  await openDetail('İzin bekliyor'); // the driven step's aim is the seeded 'askı senaryosunu yürü'
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  // DETAY: the FILLED band carries the three values — turn (left) · focus (middle) · segments + N/T
  const band = page.locator('[data-substrip-band]');
  assert.ok((await band.count()) >= 1, 'no band in DETAY');
  assert.ok((await band.locator('[aria-live="polite"]').getByText('Sıra sende').count()) >= 1, 'the band carries no turn');
  const focus = await band.locator('[data-substrip-focus]').textContent();
  assert.equal(focus, 'askı senaryosunu yürü', `the band focus is not the active step's aim: ${focus}`);
  assert.ok((await band.locator('[data-seg]').count()) >= 1, 'the band carries no segments');
  // SADE keeps the calm line — no band, no focus cell
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-substrip-band]').count(), 0, 'SADE rendered the band');
  assert.ok((await page.locator('[data-substrip]').count()) >= 1, 'SADE lost its line');
  assert.equal(await page.locator('[data-substrip-focus]').count(), 0, 'SADE rendered a focus cell');
  await backToBoard();
});

await spec('the report opens under its row and spotlights its owner (R1 + H-2)', async () => {
  await openDetail('Uygulama sürüyor'); // step 1 done with a report path → the row is a real toggle
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  const row = page.locator('[data-step-idx="1"]');
  const toggleBtn = row.locator('button[data-step-toggle="1"]');
  assert.ok((await toggleBtn.count()) === 1, 'the done row is not a toggle button');
  assert.equal(await toggleBtn.first().getAttribute('aria-expanded'), 'false', 'the report starts open');
  await toggleBtn.click();
  await page.waitForTimeout(350);
  assert.equal(await toggleBtn.first().getAttribute('aria-expanded'), 'true', 'the toggle did not open');
  // the report body sits UNDER its own row, headed 'Rapor · Adım 1' + the role + the clock
  const rep = page.locator('[data-step-report="1"]');
  assert.ok((await rep.count()) === 1, 'no report body under the row');
  assert.ok((await rep.getByText('Rapor · Adım 1').count()) >= 1, 'the report header lost its title');
  // H-2: the opened row is the owner (raised surface); the spine is dimmed; closing restores calm
  assert.ok((await row.locator('.steprow.owner').count()) === 1, 'the open row is not the owner');
  assert.ok((await page.locator('ul.steps.dimmed').count()) === 1, 'the spine does not dim while a report holds the gaze');
  await toggleBtn.click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-step-report]').count(), 0, 'the report did not close');
  assert.equal(await page.locator('ul.steps.dimmed').count(), 0, 'the spine stayed dimmed after closing');
  assert.equal(await page.locator('.steprow.owner').count(), 0, 'a row kept the owner surface');
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(200);
  await backToBoard();
});

await spec('switching reports closes the sibling and arrives at the new one\'s top (WO-0031f)', async () => {
  await openDetail('Rapor turu'); // ten done steps, each row a report toggle
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  const scroll = () => page.evaluate(() => document.querySelector('.flow-scroll')?.scrollTop ?? -1);
  // scroller-RELATIVE top (the viewport adds appbar+strip above the scroller); a late row can clamp
  // short of the very top when too little content follows it — "reading position" = fully in view.
  const topOf = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    const container = document.querySelector('.flow-scroll');
    return el && container ? el.getBoundingClientRect().top - container.getBoundingClientRect().top : -1;
  }, sel);
  // open step 1's report near the top
  await page.locator('button[data-step-toggle="1"]').click();
  await page.waitForTimeout(700); // the smooth scroll settles
  assert.equal(await page.locator('[data-step-report="1"]').count(), 1, 'report 1 did not open');
  // switch to step 8 (deep in the list): 1 closes, 8 opens — and the view GLIDES to report 8's top
  const before = await scroll();
  await page.locator('button[data-step-toggle="8"]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-step-report="1"]').count(), 0, 'report 1 stayed open after the switch');
  assert.equal(await page.locator('[data-step-report="8"]').count(), 1, 'report 8 did not open');
  const after = await scroll();
  assert.ok(after > before, `the switch did not scroll down (${before} → ${after})`);
  const top = await topOf('[data-step-report="8"]');
  assert.ok(top >= 0 && top < 300, `report 8's top is not in reading position (${top})`);
  // the ROW heading rides along — the report never starts without its owning line in view. (A LATE
  // row clamps short of the very top: too little content follows it to scroll further — in-view is
  // the honest contract, the arrival targets the row so an EARLY row lands right under the bar.)
  const rowTop = await topOf('[data-step-idx="8"]');
  assert.ok(rowTop >= -1 && rowTop < 300, `report 8's row heading is not in view (${rowTop})`);
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(200);
  await backToBoard();
});

await spec('strip gates the order.md writers while a drive runs (absent + reason line)', async () => {
  await openDetail('Yeni iş emri örneği');
  // the drive may be fresh (Plan iste) or stopped from an earlier spec (Sürdür) — both start it
  const start = await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first();
  await start.click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count()) >= 1, 'drive not running');
  assert.equal(await page.locator('button[aria-label="İş emrini düzenle"]').count(), 0, 'the pencil renders while a drive runs');
  assert.equal(await page.locator('button[aria-label="Sil"]').count(), 0, 'the trash renders while a drive runs');
  assert.equal(await page.locator('button[data-review-mode]').count(), 0, 'the review badge is still a button while a drive runs');
  assert.ok((await page.getByText('önce oturumu durdur').count()) >= 1, 'no absence reason line');
  await page.screenshot({ path: join(SHOTS, 'strip-gated@980.png') });
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(800); // wind-down + detail reload
  assert.ok((await page.locator('button[aria-label="İş emrini düzenle"]').count()) >= 1, 'the pencil did not return after the stop');
  await backToBoard();
});

await spec('a running session with zero entries says so; the line leaves with the first entry (F7)', async () => {
  await stopAllDrives(); // the one-drive-at-a-time rule — stage this on a FRESH work order
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Boş akış denemesi');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400); // create → the detail arrives
  await page.getByRole('button', { name: 'Plan iste' }).first().click();
  await page.waitForTimeout(500);
  // running, nothing written yet — SADE's phase line carries the honest copy
  assert.ok((await page.getByText('Oturum açıldı — çıktı bekleniyor').count()) >= 1, 'no running-empty line');
  // the first transcript entry replaces it
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'assistant_text', text: 'İlk çıktı satırı geldi.' }));
  await page.waitForTimeout(400);
  assert.equal(await page.getByText('Oturum açıldı — çıktı bekleniyor').count(), 0, 'the line stayed after the first entry');
  await stopAllDrives();
  // cleanup: the throwaway work order leaves the way it came
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('Evet, sil').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Boş akış' }).count(), 0, 'the throwaway F7 WO survived');
});

await spec('Düzenle is a dialog; the title edit persists and the screen stays intact', async () => {
  await openDetail('Plan bekliyor');
  // spec 14's approval may have left an auto-chained step drive running in the background — a live
  // drive correctly gates the writers, so rest the chain before asserting editability.
  await stopAllDrives();
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="İş emrini düzenle"]').first().click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('[role="dialog"]').count()) >= 1, 'the edit dialog did not open');
  assert.ok((await page.locator('h1').count()) >= 1, 'the screen behind lost its title');
  // WO-0031f review (operator): ONE Esc closes the DIALOG only — it must not also leave the detail
  // (the capture-phase guard sees the dialog before Radix unmounts it; the old bubble guard raced)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'Esc did not close the dialog');
  assert.ok((await page.locator('h1').count()) >= 1, 'Esc closed the dialog AND left the detail');
  assert.equal(await page.locator('[data-wo-id]').count(), 0, 'Esc threw the operator back to the board');
  // reopen and continue the edit flow
  await page.locator('button[aria-label="İş emrini düzenle"]').first().click();
  await page.waitForTimeout(300);
  const dialogInput = page.locator('[role="dialog"] input#wo-edit-title');
  await dialogInput.fill('Plan bekliyor — düzenlendi');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(700); // updateWorkOrder → reloadDetail
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the edit dialog did not close');
  assert.ok((await page.getByText('Plan bekliyor — düzenlendi').count()) >= 1, 'the edited title did not land');
  // restore the title so later openDetail('Plan bekliyor') lookups still resolve
  await page.locator('button[aria-label="İş emrini düzenle"]').first().click();
  await page.waitForTimeout(250);
  await page.locator('[role="dialog"] input#wo-edit-title').fill('Plan bekliyor');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(600);
  await backToBoard();
});

await spec('Sil is a dialog and cascades (the throwaway WO from the create spec)', async () => {
  await backToBoard(); // defensive: the previous spec may have died mid-detail
  await openDetail('Tek adımda oluşturulan iş emri');
  await stopAllDrives();
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="Sil"]').first().click();
  await page.waitForTimeout(300);
  assert.ok((await page.getByText('Geri alınamaz').count()) >= 1, 'no consequence line in the delete dialog');
  assert.ok((await page.getByText('Evet, sil', { exact: true }).count()) >= 1, 'no confirm button');
  await page.getByText('Evet, sil').click();
  await page.waitForTimeout(800); // cascade + board refresh
  assert.ok((await page.locator('[data-wo-id]').count()) >= 1, 'not back on the board after delete');
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Tek adımda' }).count(), 0, 'the deleted WO still has a card');
});

await spec('Kayıt: kanıt chips at the top of the drawer + Belgeler + döküm (WO-0031f v6)', async () => {
  await openDetail('Uygulama sürüyor'); // single-repo, implementation: 1 gate satisfied, rest absent
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  // tur-2 D3 stands: the Repolar section stays gone — and the two-tab world has no room for it
  assert.equal(await page.getByText('Repolar', { exact: true }).count(), 0, 'a Repolar surface still exists');
  await page.getByRole('tab', { name: /Kayıt/ }).click();
  await page.waitForTimeout(250);
  // v6: the three Kanıt chips sit at the TOP of the record (a summary, not a section)
  const record = page.locator('#sec-record');
  const first = await record.locator('section').first().textContent();
  assert.ok(first?.includes('Kanıt'), `Kanıt is not the record's first section: ${first}`);
  // D2: the aside carries n/total
  const sum = await page.locator('[data-evidence-sum]').first().getAttribute('data-evidence-sum');
  assert.ok(sum && /^\d+\/\d+$/.test(sum), `no n/total evidence summary: ${sum}`);
  // chips: satisfied ✓, absence sentences in plain words (never a bare 'eksik')
  assert.ok((await page.getByText('✓ plan onayı', { exact: true }).count()) >= 1, 'no satisfied plan-approval chip');
  assert.ok((await page.getByText('henüz PR yok', { exact: true }).count()) >= 1, 'no track position chip');
  assert.ok((await page.getByText('doğrulayıcı raporu yok', { exact: true }).count()) >= 1, 'no verification absence sentence');
  assert.equal(await page.getByText('eksik', { exact: true }).count(), 0, 'a reasonless eksik leaked');
  // v6 order: Kanıt → Belgeler → Oturum dökümü (+ Kaynaklar last, on presence) — the stack's own
  // section headers only (MarkdownDoc renders the doc's own h2s nested deeper)
  const titles = await record.locator('aside > section > h2').allTextContents();
  const ids = ['Kanıt', 'Belgeler', 'Oturum dökümü'];
  for (let i = 0; i < ids.length; i++) {
    assert.ok(titles[i]?.includes(ids[i]), `record section ${i} is not ${ids[i]}: ${titles.join(' | ')}`);
  }
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(200);
  await backToBoard();
});

await spec('Kapat is a dialog with NO ⏎ path; the closure results card seals once', async () => {
  await backToBoard(); // defensive: the previous spec may have died mid-detail
  await openDetail('Uygulama sürüyor'); // one step done + proceed → allStepsDone, closable
  await stopAllDrives();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'İş emrini kapat', exact: true }).first().click();
  await page.waitForTimeout(300);
  const note = page.locator('[role="dialog"] input#wo-close-note');
  assert.ok((await note.count()) >= 1, 'the close dialog has no note input');
  await note.fill('e2e kapanış notu');
  // Enter in the note input must NOT submit (kapat ⏎'süz) — the dialog stays open
  await note.press('Enter');
  await page.waitForTimeout(400);
  assert.ok((await page.locator('[role="dialog"]').count()) >= 1, 'Enter in the note input closed the dialog');
  await page.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
  await page.waitForTimeout(900); // closeWorkOrder → closure sha → stage closed → results card
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the close dialog stayed open after a successful close');
  assert.ok((await page.locator('.glow-done').count()) >= 1, 'no green glow after closing');
  assert.ok((await page.locator('[data-closure-card]').count()) >= 1, 'no results card on the closed WO');
  assert.ok((await page.locator('[data-seal]').count()) >= 1, 'no seal on the results card');
  assert.ok((await page.getByText('Kapandı', { exact: true }).count()) >= 1, 'no Kapandı readout');
  assert.ok((await page.getByText('1/1 adım').count()) >= 1, 'no 1/1 adım stat');
  // H-1: money never celebrates — the stats line carries no animation of its own
  const statsAnim = await page.evaluate(() => {
    const card = document.querySelector('[data-closure-card]');
    const stats = card?.querySelector('p.font-mono') ?? null;
    return stats ? getComputedStyle(stats).animationName : 'missing';
  });
  assert.equal(statsAnim, 'none', `the closure stats animate: ${statsAnim}`);
  await page.screenshot({ path: join(SHOTS, 'closure-results@980.png') });
  // reopening an already-closed WO is CALM — the seal renders without the animation class
  await backToBoard();
  await openDetail('Uygulama sürüyor');
  assert.ok((await page.locator('[data-seal]').count()) >= 1, 'no seal on reopen');
  assert.equal(await page.locator('[data-seal].sealpop').count(), 0, 'the seal re-animated on reopen');
  // WO-0031f K1 (operator review amendment): the closed strip's pencil stays IN PLACE, LOCKED — no
  // standing line (the closed state is already named beside it); inert review badge; Sil STAYS
  const closedPencil = page.getByRole('button', { name: 'İş emrini düzenle', exact: true });
  assert.ok((await closedPencil.count()) >= 1, 'the pencil vanished from the closed strip');
  const pencilClass = (await closedPencil.first().getAttribute('class')) ?? '';
  assert.ok(pencilClass.includes('pointer-events-none'), `the closed pencil is not locked: ${pencilClass}`);
  assert.ok((await page.getByText('Kapalı iş emri değişmez', { exact: true }).count()) === 0, 'the immutability line still renders');
  assert.ok((await page.locator('span[data-review-mode]').count()) >= 1, 'the review badge is not the inert span form');
  assert.ok((await page.getByRole('button', { name: 'Sil', exact: true }).count()) >= 1, 'Sil vanished from the closed strip');
  // D3: the merged track speaks as a Kanıt chip ('✓ Depoda' — single repo, no suffix)
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  assert.ok((await page.getByText('✓ Depoda', { exact: true }).count()) >= 1, 'no merged-track chip');
  await page.getByRole('button', { name: 'SADE' }).first().click();
  await page.waitForTimeout(200);
  await backToBoard();
});

await spec('only-closed board: the Bütün işler tamam platform, the toggle, and the calm arrival (WO-0031f)', async () => {
  // switch to the 'arşiv' workspace (its only WO is closed) via the appbar switcher
  await page.locator('header button', { hasText: 'e2e' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /arşiv/ }).first().click();
  await page.waitForTimeout(600);
  assert.ok((await page.getByText('Bütün işler tamam').count()) >= 1, 'no platform line');
  assert.ok((await page.locator('[data-board-all-done]').count()) >= 1, 'no platform container');
  // pre-merge (operator tour of PR #37): a closed card never claims ▸ Kapatılabilir and its reason
  // is the done line — the real archive showed both on closed cards
  assert.equal(await page.getByText('Kapatılabilir').count(), 0, 'a closed card claims Kapatılabilir');
  assert.ok((await page.getByText('Tamamlandı', { exact: true }).count()) >= 1, 'closed card reason is not the done line');
  // T1: the closed list sits behind the toggle — 1 closed ≤5, so it starts OPEN and the card shows
  const toggle = page.locator('[data-closed-toggle]');
  assert.equal(await toggle.count(), 1, 'not exactly one closed toggle');
  assert.equal(await toggle.first().getAttribute('aria-expanded'), 'true', 'the ≤5 toggle does not start open');
  assert.ok((await toggle.getByText('1 kapalı iş').count()) >= 1, 'the toggle label carries no count');
  assert.equal(await page.locator('[data-wo-id]').count(), 1, 'the closed card is not out in the open');
  assert.equal(await page.locator('details > summary').count(), 0, 'a details drawer survived');
  // H-1: arriving at all-done BY MOUNT is calm — no pulse (the pulse is a state transition only)
  assert.equal(await page.locator('.pulse-once').count(), 0, 'the all-done platform pulsed on mount');
  await page.screenshot({ path: join(SHOTS, 'board-all-done@980.png') });
  // back to the busy workspace for the remaining specs
  await page.locator('header button', { hasText: 'arşiv' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'e2e', exact: false }).first().click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('[data-wo-id]').count()) >= 3, 'did not switch back to the e2e workspace');
});

// ===== WO-0031e tur-3 specs (audit transcript, tab scroll) + the WO-0031f board package =====
// (order matters: the audit/scroll specs need raf's WO still CLOSABLE — the closable spec ends by
//  closing it, which stages the all-done arrival pulse)

await spec('audit rows expand: the session transcript opens under its row (tur-3)', async () => {
  await page.locator('header button', { hasText: 'e2e' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /raf/ }).first().click();
  await page.waitForTimeout(600);
  await openDetail('Raf işi');
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: /Kayıt/ }).click();
  await page.waitForTimeout(300);
  // D3: every ledger row carries its role lamp beside the rolechip (architect/implementer/verifier)
  const lamps = await page.locator('[data-audit-table] .rlamp').count();
  const rolechips = await page.locator('[data-audit-table] .rounded-full').count();
  assert.ok(lamps >= 1 && lamps === rolechips, `role lamps (${lamps}) do not match rolechips (${rolechips})`);
  await page.locator('[data-audit-toggle]').first().click();
  await page.waitForTimeout(300);
  const box = page.locator('[data-audit-transcript]');
  assert.equal(await box.count(), 1, 'no transcript box under the row');
  const text = (await box.textContent()) ?? '';
  assert.ok(text.includes('Raf: döküm satırı 1'), 'the assistant line is missing');
  assert.ok(text.includes('Komut çalıştır — npm test'), 'the tool_use line did not render through labels');
  assert.ok(text.includes('→ Raf: döküm satırı 3'), 'the tool_result line is missing');
  await page.screenshot({ path: join(SHOTS, 'audit-transcript@980.png') });
  // toggle again — the box hides
  await page.locator('[data-audit-toggle]').first().click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-audit-transcript]').count(), 0, 'the transcript box did not hide');
  await backToBoard();
});

await spec('tab switch scrolls the opened panel into view (tur-3, re-anchored to the two surfaces)', async () => {
  // still on the raf workspace; the long Objective guarantees the Kayıt panel overflows 980×620
  await openDetail('Raf işi');
  await page.getByRole('button', { name: 'DETAY' }).first().click();
  await page.waitForTimeout(400);
  const read = () => page.evaluate(() => {
    const panel = document.getElementById('sec-record');
    const container = panel ? panel.closest('.overflow-y-auto') : null;
    return {
      top: container ? container.scrollTop : -1,
      recordTop: panel ? panel.getBoundingClientRect().top : -1,
      scrollable: container ? container.scrollHeight - container.clientHeight : -1,
    };
  });
  await page.getByRole('tab', { name: /Kayıt/ }).click();
  await page.waitForTimeout(300);
  let state = await read();
  assert.ok(state.scrollable > 40, `the record panel has no room to scroll (${state.scrollable})`);
  assert.ok(state.top > 0, `selecting Kayıt did not scroll (scrollTop ${state.top})`);
  assert.ok(state.recordTop < 240, `sec-record is not in view (${state.recordTop})`);
  // WO-0031f review: the Akış|Kayıt bar STAYS PINNED while the content scrolls under it
  const barTop = await page.evaluate(() => {
    const bar = document.querySelector('[role="tablist"]');
    const container = document.querySelector('.flow-scroll');
    return bar && container ? bar.getBoundingClientRect().top - container.getBoundingClientRect().top : -1;
  });
  assert.ok(barTop >= -1 && barTop < 60, `the tab bar scrolled away (${barTop})`);
  const afterRecord = state.top;
  // back to Akış — the first surface; the scroll moves UP
  await page.getByRole('tab', { name: /Akış/ }).click();
  await page.waitForTimeout(300);
  state = await read();
  assert.ok(state.top < afterRecord, `switching back to Akış did not scroll up (${state.top} vs ${afterRecord})`);
  await backToBoard();
});

await spec('closable platform → live close → the all-done arrival pulses once + the peron invitation (WO-0031f)', async () => {
  // the raf workspace (its only WO is closable, not closed) — the previous spec left us on its board
  if ((await page.getByText('1 iş kapatılmayı bekliyor').count()) === 0) {
    await page.locator('header button').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /raf/ }).first().click();
    await page.waitForTimeout(600);
  }
  assert.ok((await page.getByText('1 iş kapatılmayı bekliyor').count()) >= 1, 'no awaiting-close line');
  assert.ok((await page.locator('[data-board-awaiting-close]').count()) >= 1, 'no awaiting-close platform container');
  // the platform keeps EXACTLY one CTA — the operator's explicit call (no invitation here; the
  // appbar's own Yeni iş emri is chrome, not the platform's)
  assert.equal(await page.getByRole('button', { name: 'Kapanışa git', exact: true }).count(), 1, 'not exactly one CTA');
  assert.equal(
    await page.locator('[data-board-awaiting-close]').getByRole('button', { name: /Yeni iş emri/ }).count(),
    0,
    'the awaiting platform grew a second CTA',
  );
  assert.equal(await page.locator('[data-wo-id]').count(), 1, 'the closable card is not out in the open');
  assert.ok((await page.getByText('Kapatılabilir').count()) >= 1, 'no ▸ Kapatılabilir on the card');
  await page.screenshot({ path: join(SHOTS, 'board-awaiting-close@980.png') });
  // the CTA opens the first closable detail — the Kapat card is the payoff
  await page.getByRole('button', { name: 'Kapanışa git', exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.getByText('Tüm adımlar tamam').count()) >= 1, 'the CTA did not open the closable detail');
  assert.ok((await page.getByRole('button', { name: 'İş emrini kapat', exact: true }).count()) >= 1, 'no Kapat card');
  // tur-3 item 2: the strip progress hairline fills GREEN (--color-proceed #4cc38a)
  const fill = await page.evaluate(() => {
    const el = document.querySelector('.hairline-progress > div');
    return el ? getComputedStyle(el).backgroundColor : 'missing';
  });
  assert.equal(fill, 'rgb(76, 195, 138)', `hairline fill is ${fill}, not --color-proceed`);
  // the live close — the board flips awaiting → all-done, and the arrival pulses ONCE (H-1)
  await page.getByRole('button', { name: 'İş emrini kapat', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
  await page.waitForTimeout(900);
  assert.ok((await page.locator('.glow-done').count()) >= 1, 'no green glow after the close');
  await backToBoard();
  await page.waitForTimeout(600);
  assert.ok((await page.getByText('Bütün işler tamam').count()) >= 1, 'no all-done platform after the last close');
  assert.ok((await page.locator('[data-board-all-done]').count()) >= 1, 'no all-done container after the last close');
  assert.ok((await page.locator('.pulse-once').count()) >= 1, 'the all-done arrival did not pulse');
  // T2: the finished platform carries the inline invitation — it opens the create modal
  await page.getByRole('button', { name: /Yeni iş emri/ }).first().click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('[role="dialog"]').count()) >= 1, 'the invitation CTA did not open the create modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // T1: the closed card sits behind the toggle (1 ≤5 → open) with its quiet treatment
  const toggle = page.locator('[data-closed-toggle]');
  assert.equal(await toggle.count(), 1, 'no closed toggle on the all-done board');
  assert.equal(await toggle.first().getAttribute('aria-expanded'), 'true', 'the ≤5 toggle does not start open');
  assert.ok((await toggle.getByText('1 kapalı iş').count()) >= 1, 'the toggle label carries no count');
  await page.screenshot({ path: join(SHOTS, 'board-all-done-live@980.png') });
  // the reopened archive carries the terminal lock (the line died with the operator's amendment —
  // the K1 strip form is asserted in the closure spec)
  await openDetail('Raf işi');
  const rafPencil = page.getByRole('button', { name: 'İş emrini düzenle', exact: true });
  assert.ok((await rafPencil.count()) >= 1, 'the pencil vanished from the reopened archive');
  assert.ok(((await rafPencil.first().getAttribute('class')) ?? '').includes('pointer-events-none'), 'the archive pencil is not locked');
  await backToBoard();
  // leave the workspace tidy for the empty-DB spec (it launches its own app)
});

// ===== WO-0032 specs (workspace deletion) — the deletion is permanent in the shared db, so these
// run LAST among the first-app specs: after them only 'çöp' is gone, which nothing else references.

await spec('WS sil: edit modal → Sil → counted consequence → Evet, sil → fallback board (WO-0032)', async () => {
  // switch to the 'çöp' workspace — its two WOs are the deletion payload. The previous spec leaves
  // the app on the raf board, so open the switcher by position (the first header button), not label.
  await page.locator('header button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'çöp', exact: true }).first().click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-wo-id]').count(), 2, 'the çöp board does not show exactly its two WOs');
  // the row gear opens the edit modal; the quiet Sil entry swaps it for the confirm dialog
  await page.locator('header button', { hasText: 'çöp' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('div.w-72 > div').filter({ hasText: 'çöp' }).first().locator('button[aria-label="Workspace ayarları"]').click();
  await page.waitForTimeout(300);
  assert.ok((await page.getByRole('button', { name: 'Çalışma alanını sil', exact: true }).count()) >= 1, 'no Sil entry in the edit modal');
  await page.getByRole('button', { name: 'Çalışma alanını sil', exact: true }).click();
  await page.waitForTimeout(300);
  // the settings modal closed and the confirm took its place: one dialog, no form, the counted line
  assert.equal(await page.locator('[role="dialog"]').count(), 1, 'the confirm did not swap in as the one dialog');
  assert.equal(await page.locator('[role="dialog"] input').count(), 0, 'the settings form is still behind the confirm');
  const line = await page.locator('[role="dialog"]').textContent();
  assert.ok(line?.includes('2 iş emri'), `the consequence line carries no count: ${line}`);
  assert.ok(line?.includes('Geri alınamaz'), 'no irreversible line in the confirm');
  await page.screenshot({ path: join(SHOTS, 'ws-delete-confirm@980.png') });
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click();
  await page.waitForTimeout(1000); // cascade + both list refreshes
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the confirm dialog stayed open');
  assert.ok((await page.locator('[data-wo-id]').count()) >= 3, 'no fallback board after the workspace delete');
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Çöp işi' }).count(), 0, 'a deleted-workspace WO still has a card');
  // the switcher no longer offers çöp
  await page.locator('header button', { hasText: 'e2e' }).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('div.w-72 > div').filter({ hasText: 'çöp' }).count(), 0, 'the switcher still offers çöp');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

await spec('WS sil: a live drive hides the Sil entry and states the reason (WO-0032)', async () => {
  // a running architect drive on the e2e workspace — the same recorded rows the store guard reads
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: 'Plan iste' }).first().click();
  await page.waitForTimeout(800); // started → session row 'running' → the board refresh lands
  // open the e2e row's settings: the Sil entry is absent, the reason line stands in (ADR-0001)
  await page.locator('header button').first().click();
  await page.waitForTimeout(300);
  await page.locator('div.w-72 > div').filter({ hasText: 'e2e' }).first().locator('button[aria-label="Workspace ayarları"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[role="dialog"]').getByRole('button', { name: 'Çalışma alanını sil' }).count(), 0, 'the Sil entry rendered under a live drive');
  assert.ok((await page.locator('[role="dialog"]').getByText('önce oturumu durdur').count()) >= 1, 'no gate reason in the edit modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await stopAllDrives();
  await backToBoard();
});

await spec('empty DB: the real appbar + the invitation hero; workspace create → zero-WO hero', async () => {
  // a SECOND app on a fresh DB path (the store never auto-seeds) — the first-run surface, end to end
  const emptyRoot = mkdtempSync(join(tmpdir(), 'docket-e2e-empty-'));
  const emptyApp = await electron.launch({
    args: [join(ROOT, 'dist-electron', 'main.js')],
    env: { ...process.env, DOCKET_DB_PATH: join(emptyRoot, 'empty.db'), DOCKET_E2E: '1', NODE_ENV: 'production' },
  });
  try {
    const emptyPage = await emptyApp.firstWindow();
    // TD-038.5: the second app gets its own console collector — its renderer errors used to pass
    // the zero-errors spec silently.
    const emptyConsoleErrors = [];
    emptyPage.on('console', (msg) => {
      if (msg.type() === 'error') emptyConsoleErrors.push(msg.text());
    });
    emptyPage.on('pageerror', (err) => emptyConsoleErrors.push(String(err)));
    await emptyPage.waitForLoadState('domcontentloaded');
    await emptyPage.waitForTimeout(700);
    assert.ok((await emptyPage.getByText('Docket', { exact: true }).count()) >= 1, 'no brand on an empty DB');
    assert.ok((await emptyPage.locator('button[aria-label="Ayarlar"]').count()) >= 1, 'no normal Settings gear on an empty DB');
    assert.ok((await emptyPage.getByText('Haydi ilk iş emrini açalım').count()) >= 1, 'no invitation line');
    assert.ok((await emptyPage.getByRole('button', { name: 'Yeni çalışma alanı' }).count()) === 1, 'not exactly one CTA');
    await emptyPage.screenshot({ path: join(SHOTS, 'empty-db-hero@980.png') });
    // the CTA opens the workspace-create dialog; create one over a temp dir (typed, no native picker)
    await emptyPage.getByRole('button', { name: 'Yeni çalışma alanı' }).click();
    await emptyPage.waitForTimeout(350);
    const wsRepo = join(emptyRoot, 'repo');
    mkdirSync(join(wsRepo, 'docs', 'work-orders'), { recursive: true });
    await emptyPage.locator('[role="dialog"] input').first().fill('boş');
    const repoInput = emptyPage.locator('[role="dialog"] input[placeholder="yerel repo yolu"]');
    await repoInput.fill(wsRepo);
    await emptyPage.getByRole('button', { name: 'Ekle', exact: true }).click();
    await emptyPage.waitForTimeout(250);
    await emptyPage.getByRole('button', { name: 'Oluştur', exact: true }).click();
    await emptyPage.waitForTimeout(800);
    // the zero-WO board is the SAME hero with the work-order CTA — no buckets, no drawer, no dashed boxes
    assert.ok((await emptyPage.getByText('Haydi ilk iş emrini açalım').count()) >= 1, 'no zero-WO hero');
    assert.ok((await emptyPage.getByRole('button', { name: /Yeni iş emri/ }).count()) >= 1, 'no zero-WO CTA');
    assert.equal(await emptyPage.getByText('Sıra sende', { exact: true }).count(), 0, 'a bucket header rendered at zero WOs');
    assert.equal(await emptyPage.locator('[data-closed-toggle]').count(), 0, 'a closed toggle rendered at zero WOs');
    await emptyPage.screenshot({ path: join(SHOTS, 'zero-wo-hero@980.png') });
    assert.deepEqual(emptyConsoleErrors, [], `empty-DB console errors: ${emptyConsoleErrors.join(' | ')}`);
  } finally {
    await emptyApp.close();
  }
});

await spec('zero renderer console errors', async () => {
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
});

await app.close();
console.log(failures.length ? `\n${failures.length} failing: ${failures.join(', ')}` : '\nall UI specs green');
process.exit(failures.length ? 1 : 0);
