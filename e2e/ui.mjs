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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
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
    console.log(`  ✗ ${name}\n    ${String(e).split('\n').slice(0, 3).join('\n    ')}`);
  }
};

const app = await electron.launch({
  args: [join(ROOT, 'dist-electron', 'main.js')],
  env: { ...process.env, DOCKET_DB_PATH: DB, DOCKET_E2E: '1', NODE_ENV: 'production' },
});
const page = await app.firstWindow();
// the console collectors attach BEFORE the theme pin's reload (listeners survive it — the boot
// the specs exercise must not skip the zero-errors spec; review round 2026-08-24)
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));
// WO-0040: pin the emulated color scheme DARK — Sistem is the default and would otherwise follow
// the host OS, making every color-pinned assert (e.g. the rgb(76, 195, 138) hairline fill) and
// every screenshot host-dependent. Load-bearing like seed.ts's locale='tr' (TD-041's twin).
// The userData is the operator's REAL one (no E2E isolation): a crashed prior run may have left
// an explicit mirror, which beats the pin — stamp 'dark' and reboot once (found live 2026-08-24:
// a leftover 'light' flipped the suite's whole palette). The harness tail removes the key again.
await page.emulateMedia({ colorScheme: 'dark' });
await page.evaluate(() => localStorage.setItem('docket.theme', 'dark'));
await page.reload();
await page.waitForTimeout(700);

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
// until the chain rests, so a leftover drive never crosses into the next spec's stage. WO-0088:
// N drives MAY run at once — the loop presses Durdur until nothing is left.
const stopAllDrives = async () => {
  for (let i = 0; i < 4; i++) {
    const btn = page.getByRole('button', { name: 'Durdur', exact: true });
    if ((await btn.count()) === 0) return;
    await btn.first().click();
    await page.waitForTimeout(700);
  }
};
// WO-0059 rev 4: the ws Düzenle dialog — the per-workspace knobs' home since the settings modal
// became global-only (Modeller · Genel). MAX_WS=4 hides most seeds in the dropdown, so this rides
// 'Tümünü gör' and clicks the ⚙ on the CURRENT workspace's row (its name reads off the switcher).
const openWsEdit = async () => {
  const current = ((await page.locator('header button').first().textContent()) ?? '').replace(/[▾▎]/g, '').trim();
  await page.locator('header button').first().click();
  await page.waitForTimeout(400);
  const seeAll = page.getByRole('button', { name: /Tümünü gör/ });
  if ((await seeAll.count()) > 0) {
    await seeAll.first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('div').filter({ hasText: current }).last().locator('button[aria-label="Çalışma alanı ayarları"]').last().click();
  await page.waitForTimeout(500);
};

await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(700); // board load effect

console.log('\nWO-0031c console specs (re-anchored to the WO-0037/0038 DOSYA screen)');

await spec('window opens at the compact default (980×620, content)', async () => {
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  assert.equal(size[0], 980);
  assert.equal(size[1], 620);
});

// WO-0100: the app's own face, guarded — the tray is OFF under DOCKET_E2E (it cannot exist in CI),
// the name is Docket (app.setName; userData pinned, so this run's state did not move), and the
// Windows AppUserModelID constant equals package.json build.appId (the one-identity parity).
await spec('WO-0100 chrome guard: no tray under E2E, name Docket, APP_ID = build.appId', async () => {
  const chrome = await page.evaluate(() => window.docket.e2e?.chrome());
  assert.ok(chrome, 'the e2e chrome channel is missing');
  assert.equal(chrome.tray, false, 'a tray was created under DOCKET_E2E');
  assert.equal(chrome.name, 'Docket');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(chrome.appId, pkg.build?.appId, 'APP_ID drifted from package.json build.appId');
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

await spec('plan approval: rows + the DECISION BAND (İtiraz/Onayla) + heading Düzenle; objection is an inline layer (esc peels it)', async () => {
  await openDetail('Plan bekliyor');
  // WO-0038: the proposal is compact ROWS (PlanSection). WO-0039: no per-row status word (the old
  // 'hazır'×N said nothing) and the decision trio lives WITH the rows — İtiraz/Onayla in the band
  // under them, Düzenle in the section heading; the rail is dead.
  const rows = page.locator('[data-plan-cards] li');
  const rowCount = await rows.count();
  assert.equal(rowCount, 1, `expected 1 plan row, got ${rowCount}`);
  const rowText = (await rows.first().textContent()) ?? '';
  assert.ok(rowText.includes('Uygulayıcı'), `the row carries no role chip: ${rowText}`);
  assert.ok(!rowText.includes('hazır'), `the dead hazır meta survived: ${rowText}`);
  const band = page.locator('[data-plan-decision]');
  assert.equal(await band.getByRole('button', { name: 'İtiraz et', exact: true }).count(), 1, 'no band İtiraz et');
  assert.equal(await band.getByRole('button', { name: 'Onayla', exact: true }).count(), 1, 'no band Onayla');
  assert.equal(
    await page.locator('[data-plan-cards]').getByRole('button', { name: 'Düzenle', exact: true }).count(),
    1,
    'no Düzenle in the section heading',
  );
  // 2026-08-23 fourth pass: the standing consequence line DIED — buttons left, no hint unless a
  // gate reason (an empty aim) demands one.
  assert.equal(await page.getByText('Onayla — adımlar sırayla koşar.').count(), 0, 'the dead consequence line survived');
  assert.ok((await page.locator('.glow-signal').count()) >= 1, 'no amber glow at the decision moment');
  await page.getByRole('button', { name: 'İtiraz et' }).first().click();
  await page.waitForTimeout(250);
  assert.ok((await page.getByText('İtirazın ne?').count()) >= 1, 'objection layer did not open');
  // 2026-08-23 fifth pass: while the objection layer is open the decision row stands down (the
  // layer's own Gönder/Vazgeç own the moment — ⏎ can never read as Onayla from behind it).
  assert.equal(await page.locator('[data-plan-decision]').count(), 0, 'the decision row showed over the objection layer');
  await page.keyboard.type('adımlar eksik');
  await page.keyboard.press('Enter'); // ⏎ = Gönder — the objection goes to the architect
  await page.waitForTimeout(600);
  assert.equal(await page.getByText('İtirazın ne?').count(), 0, 'Enter did not send the objection');
  const live = await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count();
  assert.ok(live >= 1, 'the architect did not start after the objection');
  await stopAllDrives();
  await backToBoard();
  // esc still peels the layer (checked on a fresh open that is cancelled instead of sent)
  await openDetail('Plan bekliyor');
  await page.getByRole('button', { name: 'İtiraz et' }).first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); // peels the layer, NOT the screen
  await page.waitForTimeout(250);
  assert.equal(await page.getByText('İtirazın ne?').count(), 0, 'esc did not close the objection layer');
  assert.ok((await page.locator('h1').count()) >= 1, 'esc closed the whole screen instead of the layer');
  await backToBoard();
});

await spec('WO-0039 stabilization: a degenerate re-submission cannot clobber the parsed plan; the gate denial reads as the submission line', async () => {
  await openDetail('Plan bekliyor');
  const rows = page.locator('[data-plan-cards] li');
  assert.equal(await rows.count(), 1, 'the staged WO does not carry a 1-step plan');
  // The overwrite incident's shape (2026-08-23): a RESUME over a WO whose plan is already on disk
  // re-fires ExitPlanMode with a one-sentence "plan" (no steps fence). The objection layer is the
  // resume path that starts a drive here.
  await page.getByRole('button', { name: 'İtiraz et' }).first().click();
  await page.keyboard.type('tekrar bak');
  await page.keyboard.press('Enter'); // ⏎ = Gönder — the objection resumes the architect
  await page.waitForTimeout(600);
  // the gate's denial echo arrives as an orphan tool_result (its call rendered as plan_ready,
  // never a tool_use row) — the source of the operator's "→ sonuç — eşleşen çağrı yok" row
  await page.evaluate(() =>
    window.docket.e2e?.emit({ kind: 'tool_result', callId: 'exitplan-1', summary: 'Plan submitted. STOP: end your turn now with no further tool calls.', isError: false }),
  );
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'plan_ready', planText: 'bekliyorum' }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(900); // the pipeline records; onEnd reloads the detail
  // 1) THE STORE GUARD: savePendingPlan refused the fence-less text — disk keeps the REAL plan,
  //    so the proposal rows survive what used to be a clobber (the incident's one-sentence plan.md).
  assert.equal(await rows.count(), 1, 'the degenerate re-submission clobbered the parsed plan');
  const sectionText = (await page.locator('[data-plan-cards]').textContent()) ?? '';
  assert.ok(!sectionText.includes('bekliyorum'), 'the degenerate text reached the plan surface');
  // the refusal is in the append-only audit (the port is the timeline's surface today)
  const evs = await page.evaluate(async () => {
    const wos = await window.docket.source.getWorkOrders();
    const wo = wos.find((w) => w.title.includes('Plan bekliyor'));
    return wo ? await window.docket.source.getWorkOrderEvents(wo.id) : [];
  });
  assert.ok(evs.some((e) => e.kind === 'plan_save_refused'), 'the refusal is not in the audit trail');
  // 2) The gate denial is the session's PUNCTUATION in the archived card — "Mimar planını sundu",
  //    never an orphan result row.
  await page.locator('[data-session-toggle]').last().click();
  await page.waitForTimeout(400);
  const cardText = (await page.locator('[data-session-card]').last().textContent()) ?? '';
  assert.ok(cardText.includes('Mimar planını sundu'), 'the gate denial did not render the submission line');
  assert.ok(!cardText.includes('eşleşen çağrı yok'), 'the gate denial rendered as an orphan result row');
  // 2026-08-24 (operator: "bittiğinde oturum durduruldu, başlatıldı yazıları yok"): the completed
  // session's transcript opens and closes with its own lifecycle lines.
  assert.ok(cardText.includes('oturum açıldı'), 'the card carries no session-started line');
  assert.ok(cardText.includes('oturum bitti'), 'the card carries no session-ended line');
  await backToBoard();
});

await spec('fake runner: Plan iste runs, the live pane header owns the one Durdur (no filler line), stop reverts', async () => {
  await openDetail('Yeni iş emri örneği');
  // WO-0039 → 2026-08-23 ruling: the bare plan stage is ONLY the button — no card, no line (the
  // header band's phase line already states it); exactly one Plan iste on the screen.
  assert.equal(await page.getByText('Henüz plan yok.').count(), 0, 'the dead empty-state line survived');
  assert.equal(await page.getByText('Mimar plan için hazır').count(), 0, 'the dead invitation line survived');
  assert.equal(await page.getByRole('button', { name: 'Plan iste', exact: true }).count(), 1, 'Plan iste is duplicated');
  await page.getByRole('button', { name: 'Plan iste' }).first().click();
  await page.waitForTimeout(500);
  const live = await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count();
  assert.ok(live >= 1, 'no running turn line');
  assert.ok((await page.locator('.glow-run').count()) >= 1, 'no running glow');
  // WO-0039: the rail is dead — Durdur lives in the LIVE PANE's header (DriveControls), and while
  // running it carries ONLY the stop (no filler line, v4 rule unchanged).
  const stopButtons = await page.getByRole('button', { name: 'Durdur', exact: true }).count();
  assert.equal(stopButtons, 1, `expected exactly one Durdur (the pane header's), got ${stopButtons}`);
  const controlsText = await page.locator('[data-drive-controls]').textContent();
  assert.equal((controlsText ?? '').trim(), 'Durdur', `the controls carry more than the stop while running: ${controlsText}`);
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(700); // wind-down + onEnd detail reload
  // v4: the stopped state offers Sürdür (the interrupted session resumes), not a fresh Plan iste
  assert.ok((await page.getByRole('button', { name: /Sürdür/ }).count()) >= 1, 'no Sürdür after the wind-down');
  assert.ok((await page.getByText('Durduruldu. Rapor kısmi kalır.').count()) >= 1, 'no stopped message in the pane header');
  // WO-0039 stabilization (2026-08-23): an intentional interrupt is NEVER a failure — the
  // interrupted event folds to 'stopped', so no fail card, no crash line, no error glow.
  assert.equal(await page.getByText('Oturum çöktü').count(), 0, 'the fail card showed for an intentional Durdur');
  assert.equal(await page.getByText('Akış koptu').count(), 0, 'the crash line showed for an intentional Durdur');
  assert.equal(await page.locator('.glow-error').count(), 0, 'the error glow showed for an intentional Durdur');
  // 2026-08-24 (operator, "state orada yanlış — hepsi senkron olmalı"): the phase line follows the
  // ROWS — a stopped proposal says so, it no longer claims the architect is "düşünüyor".
  await page.waitForTimeout(600); // onEnd reload
  assert.ok((await page.getByText('Plan önerisi durduruldu').count()) >= 1, 'the phase line still says the architect is thinking');
  // 2026-08-23 (operator: "oturum dökümündeki güncel değil"): the stop REACHES the ledger — the
  // session's own fact line rides the persisted transcript (the ⏸/■ operator notes stay live-only).
  const durdurAudit = page.locator('section#sec-audit');
  await durdurAudit.locator('[data-session-toggle]').first().click(); // the settled card arrives closed
  await page.waitForTimeout(300);
  assert.ok((await durdurAudit.getByText('oturum durduruldu').count()) >= 1, 'the stop did not reach the ledger card');
  // the BOARD card carries the same fact — "Oturum durduruldu", not "Plan onayı bekleniyor" (there
  // is no plan to approve) — and no $0,00 claim over an unobserved cost.
  await backToBoard();
  await page.waitForTimeout(400);
  const card = page.locator('[data-wo-id]', { hasText: 'Yeni iş emri örneği' }).first();
  const cardText = (await card.textContent()) ?? '';
  assert.ok(cardText.includes('Oturum durduruldu'), `the board card misstates the stop: ${cardText}`);
  assert.ok(!cardText.includes('Plan onayı bekleniyor'), 'the board claims a plan awaits approval');
  assert.ok(!cardText.includes('$0,00'), `the board claims an unobserved $0,00: ${cardText}`);
});

await spec('WO-0039 stabilization → WO-0044: re-entry keeps the ledger PURE HISTORY — the resumed live leg carries no card; the drive runs in the background', async () => {
  await openDetail('Yeni iş emri örneği');
  // the label is honest since round 3: "Sürdür" when a persisted architect session exists (this WO
  // carries one from the previous spec's stopped drive), "Plan iste" when none does
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(600); // the drive starts; the session row records behind it
  // The operator's repro (2026-08-23): leave and come back — the reload loads the RUNNING row, and
  // the ledger used to render it BESIDE the pointer (two "Plan" cards for one live session).
  // WO-0044 (pure history): the resumed leg CONTINUES the same provider session, so that row IS
  // the running session's row — no card, and (it being this WO's only row) NO LEDGER SECTION at
  // all while the leg runs; the row joins as history when the drive ends. The pointer card and
  // its "Canlı oturum" line stay dead whatever the timing.
  await backToBoard();
  await openDetail('Yeni iş emri örneği');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('section#sec-audit').count(), 0, 'the live resumed leg rendered a ledger (pure history means absent, not framed-empty)');
  assert.equal(await page.locator('[data-session-live-pointer]').count(), 0, 'the live pointer card survived WO-0044');
  assert.equal(await page.getByText('Canlı oturum').count(), 0, 'a Canlı oturum jump line survived WO-0044');
  // the background drive survived the navigation — the pane is still live (one Durdur, the pane header's)
  assert.equal(await page.getByRole('button', { name: 'Durdur', exact: true }).count(), 1, 'the drive did not survive the re-entry');
  await stopAllDrives();
  // Round 3 (operator: "devam et butonu gidiyor"): the Sürdür OFFER derives from the app-level
  // fold — it must survive ANOTHER leave-and-come-back, not die with the controller's memory.
  // WO-0044's other half: the ENDED leg rejoins the ledger — the section is back with its row.
  await backToBoard();
  await openDetail('Yeni iş emri örneği');
  await page.waitForTimeout(400);
  assert.ok((await page.locator('section#sec-audit').count()) >= 1, 'the ended leg did not rejoin the ledger');
  assert.ok((await page.locator('section#sec-audit [data-session-card]').count()) >= 1, 'the ended leg has no card');
  assert.ok((await page.getByRole('button', { name: /Sürdür/ }).count()) >= 1, 'the Sürdür offer died on re-entry');
  assert.ok((await page.getByText('Durduruldu. Rapor kısmi kalır.').count()) >= 1, 'the stopped message died on re-entry');
  await page.getByRole('button', { name: /Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button', { name: 'Durdur', exact: true }).count(), 1, 'the resume did not restart the drive');
  await stopAllDrives();
  await backToBoard();
});

await spec('stopped_asking: ask card + announced Sıra sende + the ask hint rides the cards (WO-0039)', async () => {
  await openDetail('İzin bekliyor');
  const live = await page.locator('[aria-live="polite"]').getByText('Sıra sende').count();
  assert.ok(live >= 1, 'no aria-live Sıra sende line');
  assert.ok((await page.getByRole('button', { name: 'İzin ver', exact: true }).count()) >= 1, 'no ask card');
  assert.ok((await page.getByText('Oturum durdu — maliyet işlemez.').count()) >= 1, 'no ask hint line');
  assert.ok((await page.locator('.glow-signal').count()) >= 1, 'no amber glow while asking');
  // WO-0031d: the window title carries the waiting counter ((n) izin bekliyor)
  const title = await page.title();
  assert.match(title, /^\(\d+\) izin bekliyor$/, `title counter missing: ${title}`);
});

await spec('DOSYA at 980: ONE scroll — no tabs at any width; the live instrument rides above the spine (WO-0038 → WO-0044 tur 2)', async () => {
  // 'İzin bekliyor' — its step is ACTIVE with a persisted transcript, so the TOP instrument
  // actually holds the compact chat with content.
  await backToBoard(); // defensive: the stopped_asking spec leaves the detail open
  await openDetail('İzin bekliyor');
  assert.equal(await page.locator('[role="tablist"]').count(), 0, 'a tab bar survived at 980');
  assert.equal(await page.locator('[role="tab"]').count(), 0, 'a tab survived at 980');
  // WO-0044 pins: the implementation phase line carries ONLY the count (the stage badge says the
  // word), and the driven row's meta opens with its state word — "Aktif", which stays true for an
  // interrupted step (this fixture IS one: an 'active' step with no live drive).
  assert.ok((await page.getByText('0/1 adım').count()) >= 1, 'the phase line does not read 0/1 adım');
  assert.equal(await page.getByText('Uygulama · 0/1 adım').count(), 0, 'the phase line still says the stage word twice');
  const activeRow = (await page.locator('[data-step-idx="1"]').first().textContent()) ?? '';
  assert.ok(activeRow.includes('Aktif'), `the driven row lost its state word: ${activeRow}`);
  // WO-0044 tur 2: the instrument sits ABOVE the spine (band-adjacent), ONE header row (activity
  // verb + döküm chip); the compact chat sits behind the chip, closed by default.
  assert.equal(await page.locator('[data-step-live="1"]').count(), 1, 'no live instrument for the active step');
  const stepPane = page.locator('[data-step-live="1"]');
  assert.equal(await stepPane.locator('[data-chat]').count(), 0, 'the step chat opened itself (WO-0044: closed by default)');
  const chip = stepPane.locator('[data-pane-log-toggle]');
  assert.ok((await chip.count()) >= 1, 'no döküm chip on the step instrument (WO-0044)');
  await chip.first().click();
  await page.waitForTimeout(300);
  const chat = page.locator('[data-step-live] [data-chat]');
  assert.ok((await chat.count()) >= 1, 'no chat column behind the instrument\'s döküm chip');
  const chatText = (await chat.first().textContent()) ?? '';
  assert.ok(chatText.includes('E2E: about to write a file.'), 'the persisted transcript did not seed the compact chat');
  // the record rides the SAME scroll (Belgeler + Oturum dökümü sections below the spine)
  assert.ok((await page.locator('section#sec-docs').count()) >= 1, 'no Belgeler section in the one scroll');
  assert.ok((await page.locator('section#sec-audit').count()) >= 1, 'no Oturum dökümü section in the one scroll');
  await page.screenshot({ path: join(SHOTS, 'detail@980.png') });
  await backToBoard();
});

await spec('DOSYA at 1240: the same single column — no tabs, no rack (WO-0038)', async () => {
  await setSize(1240, 620);
  await openDetail('İzin bekliyor');
  assert.equal(await page.locator('[role="tablist"]').count(), 0, 'a tab bar survived at 1240');
  assert.equal(await page.locator('main .grid').count(), 0, 'the ≥1080 rack column survived');
  // WO-0044 tur 2: the chip grammar survives the width; the chat is one click away, same as 980.
  const chip = page.locator('[data-step-live="1"] [data-pane-log-toggle]');
  assert.ok((await chip.count()) >= 1, 'no döküm chip on the step instrument at 1240 (WO-0044)');
  await chip.first().click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('[data-step-live] [data-chat]').count()) >= 1, 'the instrument chat did not open behind the chip at 1240');
  await page.screenshot({ path: join(SHOTS, 'detail-wide@1240.png') });
  await setSize(980, 620);
  await backToBoard();
});

await spec('the SADE/DETAY control is gone everywhere (WO-0038: one view, no mode decision)', async () => {
  assert.equal(await page.getByRole('button', { name: 'SADE', exact: true }).count(), 0, 'a SADE button lives on the board');
  assert.equal(await page.getByRole('button', { name: 'DETAY', exact: true }).count(), 0, 'a DETAY button lives on the board');
  await openDetail('İzin bekliyor');
  assert.equal(await page.getByRole('button', { name: 'SADE', exact: true }).count(), 0, 'a SADE button lives on the detail');
  assert.equal(await page.getByRole('button', { name: 'DETAY', exact: true }).count(), 0, 'a DETAY button lives on the detail');
  await backToBoard();
});

await spec('closed WO: green glow, closure card, NO rail, and the session CARDS are the ledger (v4 §4 → WO-0038)', async () => {
  // WO-0031f T1: the closed cards sit behind the toggle — 1 closed ≤5, so it starts OPEN
  assert.ok((await page.locator('[data-closed-toggle]').count()) >= 1, 'no closed-list toggle on the mixed board');
  await openDetail('Kapandı');
  assert.ok((await page.locator('.glow-done').count()) >= 1, 'no green glow on a closed WO');
  assert.ok((await page.getByText('Kapandı', { exact: true }).count()) >= 1, 'no closure card');
  // tur-2 A1: the header band's announced turn says Kapandı, never a false "Sıra sende"
  assert.ok((await page.locator('[aria-live="polite"]').getByText('Kapandı').count()) >= 1, 'the announced turn does not say Kapandı');
  assert.equal(await page.locator('[aria-live="polite"]').getByText('Sıra sende').count(), 0, 'closed WO claims Sıra sende');
  // tur-2 A3: the closure sha is the short form (7 chars; the full sha rides the title attribute)
  // (the seeded repo has no commits — the store's honest 'uncommitted' marker rides the same short slot)
  const shaText = await page.locator('[data-closure-card] button').first().textContent();
  assert.ok(shaText && shaText.trim().length <= 7, `sha is not the short form: ${shaText}`);
  assert.equal(await page.locator('[data-rail]').count(), 0, 'a rail survived somewhere');
  assert.equal(await page.locator('[data-drive-controls]').count(), 0, 'a closed WO rendered drive controls');
  assert.equal(await page.locator('[data-plan-decision]').count(), 0, 'a closed WO rendered a decision band');
  // WO-0038: the ledger is session CARDS — one per session, named, with its own cost; the audit
  // table and its Toplam row died (the cards carry the numbers; the section aside carries the count)
  const cards = page.locator('[data-session-card]');
  const cardCount = await cards.count();
  assert.equal(cardCount, 4, `expected 4 session cards, got ${cardCount}`);
  // WO-0044: the card's head line is the KİM — ROL readout (the old bare-name span is gone).
  assert.ok((await cards.filter({ hasText: 'Bağımsız — Uygulayıcı' }).count()) >= 1, 'the unscoped session is not named Bağımsız — Uygulayıcı');
  assert.equal(await page.getByText('Adım 0', { exact: false }).count(), 0, 'an "Adım 0" card leaked into the ledger');
  assert.equal(await page.getByText('Toplam', { exact: true }).count(), 0, 'the dead table\'s Toplam row survived');
  for (const cost of ['$1,84', '$2,40', '$2,03']) {
    assert.ok((await cards.filter({ hasText: cost }).count()) >= 1, `no card carries its own ${cost}`);
  }
  // 2026-08-23 (operator): the count aside is dead — the cards are the count.
  // WO-0031e tur-3 stands: every session of this closed WO has an EMPTY transcript — opening a
  // card renders NO chat (the toggle is honest). 2026-08-23 (döküm kaybı): the card still OPENS
  // and says so in one quiet line — the agent's record is the body, and a never-persisted one is
  // named, not silently blank.
  const firstToggle = page.locator('[data-session-toggle]').first();
  await firstToggle.click();
  await page.waitForTimeout(300);
  assert.equal(await firstToggle.getAttribute('aria-expanded'), 'true', 'the card did not open');
  assert.equal(await cards.first().locator('[data-chat]').count(), 0, 'an empty transcript rendered a chat');
  assert.ok((await cards.first().getByText('Döküm kaydı yok.').count()) >= 1, 'an empty card opens without its honest line');
  await firstToggle.click();
  await page.waitForTimeout(200);
  assert.equal(await firstToggle.getAttribute('aria-expanded'), 'false', 'the card did not close');
  await backToBoard();
});

// ===== WO-0031c c2 specs (rules, editing, notifications) =====

await spec('risky ask: riskli yazım tag + İzin ver resolves + the timeline records the decision', async () => {
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
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
  assert.ok((await page.getByText('Oturum durdu — maliyet işlemez.').count()) >= 1, 'no ask hint line');
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

// ===== WO-0077 — the structured ask (AskUserQuestion renders as the question) =====
// Each spec creates a THROWAWAY work order (no rule → the safe ask_every default, so the emitted
// ask surfaces instead of auto-resolving), drives it through the structured card on the risky-ask
// spec's emit channel, and deletes it — the shared seeded WOs keep their rules and states.

const emitAsk = (requestId, multiSelect) => page.evaluate(([rid, multi]) => window.docket.e2e?.emit({
  kind: 'permission_request',
  requestId: rid,
  tool: 'AskUserQuestion',
  input: {
    questions: [{
      question: 'Which persistence layer should the new service use?',
      header: 'Storage',
      options: [
        { label: 'SQLite (Recommended)', description: 'Embedded, zero-ops, fits a single machine' },
        { label: 'Postgres', description: 'Full server database, ops burden' },
        { label: 'JSON files', description: 'Flat files on disk, no query layer' },
      ],
      multiSelect: multi,
    }],
  },
}), [requestId, multiSelect]);

const openThrowaway = async (title) => {
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill(title);
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(800); // create NAVIGATES to the new WO's detail (App.tsx setSelectedId)
  await page.getByRole('button', { name: 'Plan iste', exact: true }).click();
  await page.waitForTimeout(500);
};

const deleteThrowaway = async (title) => {
  await page.getByRole('button', { name: 'Sil', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-wo-id]', { hasText: title }).count(), 0, 'the throwaway work order did not delete');
  await backToBoard();
};

await spec('structured ask: radio options + önerilen badge + Cevapla folds the picked label; the drive continues', async () => {
  const title = 'WO-0077 soru turu A';
  await openThrowaway(title);
  await emitAsk('r-e2e-askq', false);
  await page.waitForTimeout(400);
  assert.ok((await page.getByText('Which persistence layer should the new service use?').count()) >= 1, 'no structured question head');
  assert.equal(await page.getByRole('radio').count(), 3, 'the options did not render as radios');
  assert.ok((await page.getByText('önerilen', { exact: true }).count()) >= 1, 'no recommended badge');
  // the suffix is parsed OFF for display — the label reads SQLite, never the raw "SQLite (Recommended)"
  // (exact match would still hit: the badge shares the row's label span)
  assert.ok((await page.getByText(/^SQLite/).count()) >= 1, 'the display label lost its suffix');
  assert.equal(await page.getByText('SQLite (Recommended)').count(), 0, 'the raw suffix rendered');
  assert.equal(await page.getByRole('button', { name: 'Cevapla', exact: true }).count(), 0, 'Cevapla exists with no answer given');
  await page.getByRole('radio', { name: /SQLite/ }).check();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Cevapla', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('radio').count(), 0, 'the structured card did not resolve');
  // the drive CONTINUES — no restart, the pane's turn state flips back to running
  assert.ok((await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count()) >= 1, 'the drive did not resume after the answer');
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(600);
  const evs = await page.evaluate(async (t) => {
    const wos = await window.docket.source.getWorkOrders();
    const wo = wos.find((w) => w.title === t);
    return window.docket.source.getWorkOrderEvents(wo.id);
  }, title);
  assert.ok(
    evs.some((e) => e.kind === 'permission_decision' && (e.detail ?? '').includes('Storage: SQLite (Recommended)')),
    `the folded answer did not reach the record: ${JSON.stringify(evs.filter((e) => e.kind === 'permission_decision'))}`,
  );
  await deleteThrowaway(title);
});

await spec('structured ask: multiSelect joins, Diğer wins, Boş geç dismisses (the other measured arms)', async () => {
  const title = 'WO-0077 soru turu B';
  await openThrowaway(title);
  // multiSelect: checkboxes; two picks fold as ONE ", "-joined string
  await emitAsk('r-e2e-askq-multi', true);
  await page.waitForTimeout(400);
  assert.equal(await page.getByRole('checkbox').count(), 3, 'the options did not render as checkboxes');
  await page.getByRole('checkbox', { name: /SQLite/ }).check();
  await page.getByRole('checkbox', { name: /Postgres/ }).check();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Cevapla', exact: true }).click();
  await page.waitForTimeout(500);
  // Diğer: the free text IS the answer — typing it retires the selections (exclusive, v1)
  await emitAsk('r-e2e-askq-other', false);
  await page.waitForTimeout(400);
  await page.getByRole('radio', { name: /SQLite/ }).check();
  await page.getByLabel('Diğer', { exact: true }).fill('Plain markdown files');
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('radio', { name: /SQLite/ }).isChecked(), false, 'the free text did not retire the selection');
  await page.getByRole('button', { name: 'Cevapla', exact: true }).click();
  await page.waitForTimeout(500);
  // dismissed: Boş geç sends the bare allow and the card resolves
  await emitAsk('r-e2e-askq-skip', false);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Boş geç', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('radio').count(), 0, 'the dismissed card did not resolve');
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(600);
  const details = await page.evaluate(async (t) => {
    const wos = await window.docket.source.getWorkOrders();
    const wo = wos.find((w) => w.title === t);
    const evs = await window.docket.source.getWorkOrderEvents(wo.id);
    return evs.filter((e) => e.kind === 'permission_decision').map((e) => e.detail ?? '');
  }, title);
  assert.ok(details.some((d) => d.includes('Storage: SQLite (Recommended), Postgres')), `the multi join did not land: ${JSON.stringify(details)}`);
  assert.ok(details.some((d) => d.includes('Storage: Plain markdown files')), `the Diğer free text did not land: ${JSON.stringify(details)}`);
  assert.ok(details.some((d) => d.includes('Which persistence layer should the new service use?')), `the dismissed arm did not land: ${JSON.stringify(details)}`);
  await deleteThrowaway(title);
});

await spec('board live: answering an ask flips the card to Çalışıyor mid-drive; no flip-back at end', async () => {
  const title = 'Yeni iş emri örneği';
  const bucket = (name) => page.locator('section').filter({ has: page.locator('h2', { hasText: name }) });
  await openDetail(title);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  // a risky ask parks the drive (row stopped_asking → the card waits in "Sıra sende")
  await page.evaluate(() => window.docket.e2e?.emit({
    kind: 'permission_request',
    requestId: 'r-e2e-board-live',
    tool: 'Write',
    input: { file_path: '.github/workflows/board-live.yml', content: 'x' },
  }));
  await page.waitForTimeout(400);
  await backToBoard();
  await page.waitForTimeout(400);
  assert.ok((await bucket('Sıra sende').locator(`[data-wo-id]`, { hasText: title }).count()) >= 1, 'card not waiting before the answer');
  // answer it — the fold (and the onAskResolved row refresh) must move the card WITHOUT the drive ending
  await openDetail(title);
  await page.getByRole('button', { name: 'İzin ver', exact: true }).first().click();
  await page.waitForTimeout(500);
  await backToBoard();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'board-live-after-answer@980.png') });
  assert.ok((await bucket('Çalışıyor').locator(`[data-wo-id]`, { hasText: title }).count()) >= 1, 'card did not flip to Çalışıyor mid-drive');
  assert.equal((await bucket('Sıra sende').locator(`[data-wo-id]`, { hasText: title }).count()), 0, 'card still waits after the answer');
  // end the turn — the card settles to the waiting bucket directly, never bouncing through Seni bekliyor
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(600);
  assert.ok((await bucket('Sıra sende').locator(`[data-wo-id]`, { hasText: title }).count()) >= 1, 'card did not settle back to Sıra sende');
});

await spec('rule lift from the ask card: badge flips, timeline logs, confirm toast', async () => {
  await openDetail('Yeni iş emri örneği');
  // the strip badge shows the default (risky_excluded) before the lift
  assert.ok((await page.locator('[data-permission-rule="risky_excluded"]').count()) >= 1, 'no default rule badge');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
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

// WO-0038 (operator-approved staging model, 2026-08-22): the editor chrome and the staged plan are
// SEPARATE — drafts stage in editSteps and survive Bitti (Vazgeç is the only discard); Onayla does
// not render while the editor is open, and an empty aim holds the gate OUTSIDE the editor too.
await spec('plan editing: role PICKER + honest staging — heading Vazgeç·Bitti; the decision pair stays locked-visible', async () => {
  await openDetail('Plan bekliyor');
  // WO-0039 seventh pass (2026-08-23): Düzenle's heading slot becomes Bitti + Vazgeç while
  // editing; the decision pair (Onayla + İtiraz et) stays VISIBLE above — locked in place (the
  // kit's attribute-free `locked`), never hidden.
  const section = page.locator('[data-plan-cards]');
  const band = page.locator('[data-plan-decision]');
  await section.getByRole('button', { name: 'Düzenle' }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.getByRole('button', { name: '+ Adım ekle' }).count()) >= 1, 'the editor did not open');
  assert.equal(await section.getByRole('button', { name: 'Bitti', exact: true }).count(), 1, 'no Bitti in the heading slot');
  assert.equal(await section.getByRole('button', { name: 'Vazgeç', exact: true }).count(), 1, 'no Vazgeç in the heading slot');
  assert.equal(await band.getByRole('button', { name: 'Onayla', exact: true }).count(), 1, 'Onayla vanished while editing (locked-visible expected)');
  assert.equal(await band.getByRole('button', { name: 'İtiraz et' }).count(), 1, 'İtiraz et vanished while editing');
  // locked is INERT: the mechanism is pointer-events-none + a detached handler (kit Button), so a
  // real pointer can never reach it — Playwright's hit-test agrees. Force-dispatch the click (the
  // harshest synthetic path) and assert the editor survived: approving nothing, closing nothing.
  const lockedBtn = band.getByRole('button', { name: 'Onayla', exact: true });
  assert.ok(((await lockedBtn.getAttribute('class')) ?? '').includes('pointer-events-none'), 'Onayla is not rendered in the locked form while editing');
  await lockedBtn.click({ force: true });
  await page.waitForTimeout(400);
  assert.ok((await page.getByRole('button', { name: '+ Adım ekle' }).count()) >= 1, 'the locked Onayla approved or dismissed the editor');
  // the role chip opens a PICKER (Radix radio menu) — step 1: implementer → verifier
  const trigger = page.locator('[data-plan-cards] button[aria-label^="Rol seç"]').first();
  await trigger.click();
  await page.waitForTimeout(300);
  assert.ok((await page.getByRole('menu', { name: 'Rol seç' }).count()) >= 1, 'the role menu did not open');
  await page.getByRole('menuitemradio', { name: /Doğrulayıcı/ }).click();
  await page.waitForTimeout(250);
  assert.ok(((await trigger.getAttribute('aria-label')) ?? '').includes('Doğrulayıcı'), 'the picker did not move the role');
  // edit step 1's aim
  await page.locator('[data-plan-cards] input[aria-label="adım 1"]').fill('düzenlenmiş adım');
  // '+ Adım ekle' lands a FOCUSED empty row (border-error — the WO-0036 field rule)
  await page.getByRole('button', { name: '+ Adım ekle' }).click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    'adım 2',
    'the fresh row did not take the focus',
  );
  const emptyInput = page.locator('[data-plan-cards] input[aria-label="adım 2"]');
  assert.ok(((await emptyInput.getAttribute('class')) ?? '').includes('border-error'), 'the empty aim wears no error border');
  assert.ok((await page.getByText('Bir adımın metni boş (2. satır)').count()) >= 1, 'the band does not name the empty row');
  // Bitti with the empty stage: the gate holds OUTSIDE the editor — no Onayla, the reason stays
  await section.getByRole('button', { name: 'Bitti', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await band.getByRole('button', { name: 'Onayla', exact: true }).count(), 0, 'Onayla returned over an empty aim');
  assert.ok((await page.getByText('Bir adımın metni boş (2. satır)').count()) >= 1, 'the empty-aim reason died with the editor');
  // staging: reopen (the drafts are intact), fill the aim, Bitti — the decision band returns with
  // the STAGED hint naming the edit count (WO-0039: "düzenlenmiş plan (2 değişiklik)")
  await section.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await page.waitForTimeout(250);
  await emptyInput.fill('eklenen adım');
  // 2026-08-23 drag-and-drop (the ▲▼ pair died): grip-drag step 1 below step 2 — the drop
  // renumbers, the drafts ride the reorder. The lift needs a small move + beat after the press
  // (the sensor's activation window) before the travel; the drop needs its beat to settle.
  {
    const grip = await page.locator('button[aria-label="Adımı sürükle"]').nth(0).boundingBox();
    const row2 = await page.locator('[data-plan-cards] input[aria-label="adım 2"]').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 6, grip.y + 8, { steps: 3 });
    await page.waitForTimeout(120);
    await page.mouse.move(row2.x + 20, row2.y + row2.height / 2, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(
      await page.locator('[data-plan-cards] input[aria-label="adım 1"]').inputValue(),
      'eklenen adım',
      'the drag did not reorder (the added step should now be first)',
    );
  }
  // 2026-08-23 ("Bitti = kaydet"): finishing the editor PERSISTS a valid stage to the pending
  // plan.md — the old memory-only stage died with navigation. The regression the operator hit:
  // edit → Bitti → board → back → OLD plan.
  await section.getByRole('button', { name: 'Bitti', exact: true }).click();
  await page.waitForTimeout(600); // the save round-trips (write plan.md + reloadDetail)
  assert.equal(await band.getByRole('button', { name: 'İtiraz et' }).count(), 1, 'the decision band did not return after Bitti');
  assert.equal(await band.getByRole('button', { name: 'Onayla', exact: true }).count(), 1, 'Onayla stayed absent with a full stage');
  // 2026-08-23 fourth pass: no standing hint on a healthy stage.
  const bandText = (await band.textContent()) ?? '';
  assert.ok(!bandText.includes('sırayla koşar'), `a consequence line survived: ${bandText}`);
  const stagedText = (await page.locator('[data-plan-cards]').textContent()) ?? '';
  assert.ok(stagedText.includes('düzenlenmiş adım'), 'the staged aim did not survive Bitti');
  assert.ok(stagedText.includes('eklenen adım'), 'the added step did not survive Bitti');
  // THE REGRESSION: leave the screen and come back — the saved edit must still be the proposal.
  await backToBoard();
  await openDetail('Plan bekliyor');
  await page.waitForTimeout(500);
  const persisted = (await page.locator('[data-plan-cards]').textContent()) ?? '';
  assert.ok(persisted.includes('düzenlenmiş adım') && persisted.includes('eklenen adım'), 'Bitti did not persist the edit across navigation');
  // Vazgeç discards UNSAVED edits only: reopen (re-seeded from the SAVED proposal) → Vazgeç keeps it.
  const section2 = page.locator('[data-plan-cards]');
  await section2.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-plan-cards] input[aria-label="adım 1"]').inputValue(), 'eklenen adım', 'reopening did not seed from the saved proposal (the reorder included)');
  // "Önerine dön" (2026-08-23 — replaces the in-session Sıfırla): restore the AGENT's original
  // proposal (the seed's 1-step plan), discarding saved AND unsaved operator edits — confirm-gated.
  await section2.getByRole('button', { name: 'Önerine dön' }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.getByText('Ajanın önerdiği adımlara dönülür').count()) >= 1, 'the restore confirm dialog did not open');
  await page.getByRole('button', { name: 'Evet, dön' }).click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[data-plan-cards] li').count(), 1, 'restore did not return to the 1-step original');
  const restoredText = (await page.locator('[data-plan-cards]').textContent()) ?? '';
  assert.ok(!restoredText.includes('düzenlenmiş adım') && !restoredText.includes('eklenen adım'), 'restore kept operator edits');
  await backToBoard();
});

await spec('plan editing: the staged approval lands as a düzenlenmiş onay (edited:2)', async () => {
  await openDetail('Plan bekliyor');
  const section = page.locator('[data-plan-cards]');
  const band = page.locator('[data-plan-decision]');
  await section.getByRole('button', { name: 'Düzenle' }).click();
  await page.waitForTimeout(300);
  await page.locator('[data-plan-cards] button[aria-label^="Rol seç"]').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitemradio', { name: /Doğrulayıcı/ }).click();
  await page.waitForTimeout(250);
  await page.locator('[data-plan-cards] input[aria-label="adım 1"]').fill('düzenlenmiş adım');
  await page.getByRole('button', { name: '+ Adım ekle' }).click();
  await page.waitForTimeout(200);
  await page.locator('[data-plan-cards] input[aria-label="adım 2"]').fill('eklenen adım');
  // Esc closes the chrome keeping the stage IN MEMORY (Bitti now SAVES, which would collapse the
  // count) — Onayla then applies the unsaved stage and logs the edited approval.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await band.getByRole('button', { name: 'Onayla', exact: true }).click();
  await page.waitForTimeout(900); // approvePlan → reloadDetail (+ the gates cadence auto-drive)
  assert.ok((await page.getByText('Uygulama', { exact: true }).count()) >= 1, 'the stage badge did not advance past approval');
  // WO-0031f Y-2 killed the Çizelge surface, so the edited approval is asserted in the stored
  // event stream (detail 'edited:N' — what the dead timeline rendered from)
  const approved = await page.evaluate(async () => {
    const wos = await window.docket.source.getWorkOrders();
    const wo = wos.find((w) => w.title === 'Plan bekliyor');
    const evs = await window.docket.source.getWorkOrderEvents(wo.id);
    return evs.find((e) => e.kind === 'plan_approved')?.detail ?? '';
  });
  assert.ok(approved.startsWith('edited:'), `the edited approval did not land in the event stream: ${approved}`);
  // gates cadence: approval chained the drives ("Onayla — adımlar sırayla koşar") — stop the whole
  // chain (step + the auto-review it triggers) before leaving.
  await stopAllDrives();
  await backToBoard();
});

await spec('create + plan in one step: Oluştur ve plan iste starts the architect on arrival', async () => {
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  assert.ok((await page.getByText('İzin kuralı — ajan sizden ne zaman izin istesin').count()) >= 1, 'no rule field in create modal');
  assert.ok((await page.getByRole('button', { name: 'Denetim: kapıda', exact: true }).count()) >= 1, 'review options not renamed (WO-0044: Denetim: kapıda)');
  await page.locator('[role="dialog"] input').first().fill('Tek adımda oluşturulan iş emri');
  await page.getByRole('button', { name: 'Oluştur ve plan iste' }).click();
  await page.waitForTimeout(2000);
  const live = await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count();
  assert.ok(live >= 1, 'the architect did not auto-start after create+plan');
  // stop the drive and clean up: delete the throwaway WO
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(600);
  await backToBoard();
  // 2026-08-23 (operator, live run: "geri dönüp tekrar girince otomatik ajanı çalıştırıyor"):
  // "Oluştur ve plan iste" is ONE-SHOT — re-entering the same work order must NOT start the
  // architect again.
  await openDetail('Tek adımda oluşturulan iş emri');
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count(), 0, 'the re-entry auto-started the architect');
  assert.equal(await page.getByRole('button', { name: 'Durdur', exact: true }).count(), 0, 'a drive runs after the re-entry');
  await backToBoard();
});

// WO-0036: the create dialog joins the WsSettingsModal form contract — an empty title is refused
// UNDER the field it failed on (announced, focused), nothing is created, and the refusal dies the
// moment the user types.
await spec('create dialog: empty title refused under the field; focus follows; nothing created (WO-0036)', async () => {
  await setSize(980, 620);
  const before = await page.locator('[data-wo-id]').count();
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  const dlg = page.locator('[role="dialog"]');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(250);
  assert.ok((await dlg.getByText('Başlık gerekli.').count()) >= 1, 'no title error under the Başlık field');
  assert.ok((await dlg.locator('[role="alert"]').count()) >= 1, 'the error line does not announce');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'a failed submit did not focus the title');
  assert.equal(await page.locator('[data-wo-id]').count(), before, 'an empty-title submit created a work order');
  await page.screenshot({ path: join(SHOTS, 'wo-create-title-error@980.png') });
  await dlg.locator('input').first().fill('x');
  await page.waitForTimeout(150);
  assert.equal(await dlg.getByText('Başlık gerekli.').count(), 0, 'the error line stayed after typing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the create dialog did not close');
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

// WO-0038: the substrip died with the dual view — its two survivors moved into the HEADER BAND
// (DetailStrip): the turn stays ANNOUNCED (visually hidden aria-live — audit B5 lives on) and the
// step segments became the 2px progress hairline at the band's bottom.
await spec('header band: the turn stays announced (sr-only aria-live) + the step hairline; the substrip is gone', async () => {
  await setSize(980, 620);
  await openDetail('İzin bekliyor'); // 1 step, active (not done)
  const turn = page.locator('header [aria-live="polite"]');
  assert.ok((await turn.count()) >= 1, 'the announced turn line left the band');
  const cls = (await turn.first().getAttribute('class')) ?? '';
  assert.ok(cls.includes('sr-only'), `the turn line is not visually hidden: ${cls}`);
  assert.ok(((await turn.first().textContent()) ?? '').includes('Sıra sende'), 'the announced turn is wrong');
  assert.ok((await page.locator('.hairline-progress').count()) >= 1, 'no step hairline under the band');
  // the substrip surfaces themselves (band, focus cell, segment cells) are dead at every width
  assert.equal(await page.locator('[data-substrip]').count(), 0, 'a substrip hook survived');
  assert.equal(await page.locator('[data-seg]').count(), 0, 'a segment cell survived');
  assert.equal(await page.getByText('adım 0/1').count(), 0, 'the adım N/T readout survived');
  await backToBoard();
});

await spec('the report opens under its row and spotlights its owner (R1 + H-2)', async () => {
  await openDetail('Uygulama sürüyor'); // step 1 done with a report path → the row is a real toggle
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
  await backToBoard();
});

await spec('switching reports closes the sibling and arrives at the new one\'s top (WO-0031f)', async () => {
  await openDetail('Rapor turu'); // ten done steps, each row a report toggle
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
  await backToBoard();
});

await spec('strip gates the order.md writers while a drive runs (guarded in place + tooltip, WO-0037)', async () => {
  await openDetail('Yeni iş emri örneği');
  // the drive may be fresh (Plan iste) or stopped from an earlier spec (Sürdür) — both start it
  const start = await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first();
  await start.click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('[aria-live="polite"]').getByText('Çalışıyor', { exact: true }).count()) >= 1, 'drive not running');
  // ADR-0001 2026-08-22 addendum: the writers render IN PLACE, dimmed, handler-less — the cause
  // ("Çalışıyor") is already announced on the surface (the header band), so no standing reason line.
  const pencil = page.locator('button[aria-label="İş emrini düzenle"]');
  const trash = page.locator('button[aria-label="Sil"]');
  assert.ok((await pencil.count()) >= 1, 'the pencil is absent while a drive runs (guarded idiom expected)');
  assert.ok((await trash.count()) >= 1, 'the trash is absent while a drive runs (guarded idiom expected)');
  assert.equal(await page.getByText('önce oturumu durdur').count(), 0, 'the standing reason line survived');
  assert.equal(await page.locator('button[data-review-mode]').count(), 0, 'the review badge is still a button while a drive runs');
  // the guarded pencil does nothing on click — and its tooltip names the unblocking move (hover
  // AFTER the click: the mouse is already over the button, so park it elsewhere first or the
  // pointerenter never re-fires and the tooltip stays shut)
  await pencil.first().click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the guarded pencil opened the edit dialog');
  await page.locator('h1').first().hover();
  await page.waitForTimeout(150);
  await pencil.first().hover();
  // TD-048's remedy: WAIT for the tooltip instead of a timed window — the kit's 350ms delay is a
  // floor a loaded host can exceed, and one dropped assert here cascades into three
  await page.getByText('Oturum çalışırken düzen kapalı').first().waitFor({ state: 'visible', timeout: 5_000 });
  assert.ok((await page.getByText('Oturum çalışırken düzen kapalı').count()) >= 1, 'the gate tooltip did not open');
  await page.screenshot({ path: join(SHOTS, 'strip-gated@980.png') });
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(800); // wind-down + detail reload
  assert.ok((await pencil.count()) >= 1, 'the pencil did not survive the stop');
  await pencil.first().click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('[role="dialog"]').count()) >= 1, 'the pencil did not open the edit dialog after the stop');
  await page.keyboard.press('Escape'); // close the edit dialog
  await page.waitForTimeout(300);
  await backToBoard();
});

await spec('the empty-run window: the header carries the state, the dead "no session" line never flashes (F7, 2026-08-23 form)', async () => {
  await stopAllDrives(); // the one-drive-at-a-time rule — stage this on a FRESH work order
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Boş akış denemesi');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400); // create → the detail arrives
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  // running, nothing written yet — the HEADER's activity line is the honest state (the old
  // second line died 2026-08-23: "Düşünüyor···" already says it; a duplicate flashed then jumped)
  const header = page.locator('#live-pane').first();
  const headerText0 = (await header.textContent()) ?? '';
  assert.ok(headerText0.includes('Düşünüyor'), `the empty-run header carries no activity: ${headerText0}`);
  // F7's original sin stays dead: "Çalışan oturum yok." must NOT show while the drive runs
  assert.equal(await page.getByText('Çalışan oturum yok.').count(), 0, 'the no-session line flashed during the boot window');
  // WO-0044 AC 2, second half: a FIRST plan run renders NO ledger at all — the empty group is
  // absent (ADR-0012), the run's history joins when it ends.
  assert.equal(await page.locator('section#sec-audit').count(), 0, 'a first plan run rendered a ledger');
  // the first transcript entry does not disturb the honest state
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'assistant_text', text: 'İlk çıktı satırı geldi.' }));
  await page.waitForTimeout(400);
  assert.equal(await page.getByText('Çalışan oturum yok.').count(), 0, 'the no-session line showed with a live stream');
  await stopAllDrives();
  // cleanup: the throwaway work order leaves the way it came
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('Evet, sil').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Boş akış' }).count(), 0, 'the throwaway F7 WO survived');
});

await spec('live transcript renders as chat: turn bars, tool BLOCKS, code; bottom-pin + the jump chip (WO-0037)', async () => {
  await stopAllDrives(); // one drive at a time — stage this on a FRESH work order
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Sohbet denemesi');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400); // create → the detail arrives
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  const emit = (ev) => page.evaluate((e) => window.docket.e2e?.emit(e), ev);
  await emit({ kind: 'assistant_text', text: 'Planı şöyle kuruyorum:\n\n```ts\nconst turn = deriveTurnState(state);\nif (turn.running) {\n  return { kind: "working" };\n}\n```\n' });
  await emit({ kind: 'tool_use', callId: 'c1', tool: 'Bash', input: { command: 'npm test' } });
  await emit({ kind: 'tool_result', callId: 'c1', summary: '504 geçti · 0 kaldı', isError: false });
  await page.waitForTimeout(400);
  // 2026-08-23 ruling: NOTHING opens itself — the SADE body is the header's activity line; the
  // full Ray column opens on the pane header's döküm chip, one click, and nothing else.
  assert.equal(await page.locator('[data-chat]').count(), 0, 'the transcript column opened itself (the 2026-08-23 ruling)');
  await page.locator('[data-pane-log-toggle]').first().click();
  await page.waitForTimeout(300);
  const chat = page.locator('[data-chat]').first();
  assert.ok((await page.locator('[data-chat]').count()) >= 1, 'no chat column behind the döküm chip');
  assert.ok((await page.locator('[data-chat-entry="assistant"]').count()) >= 1, 'no assistant turn');
  const chatText = (await chat.textContent()) ?? '';
  assert.ok(chatText.includes('Planı şöyle kuruyorum:'), 'the assistant markdown did not render');
  // WO-0039/C grid anatomy: the label and the detail are separate cells (one x for the dash) —
  // assert the PAIR, not a joined string the spans never produce.
  assert.ok(chatText.includes('Komut çalıştır') && chatText.includes('npm test'), 'the tool header names no command');
  // a tool call is a BLOCK: its header is a labelled toggle; the output opens STRICTLY on click
  // (operator 2026-08-23 — history closed, live edge closed)
  const toolBtn = chat.locator('[data-chat-entry="tool_use"] button');
  assert.equal(await toolBtn.count(), 1, 'no tool block header');
  assert.equal(await toolBtn.getAttribute('aria-label'), 'Komut çıktısı — aç/kapat', 'the tool header carries no aria');
  assert.equal(await chat.locator('[data-chat-entry="tool_result"]').count(), 0, 'the tool output opened itself');
  await toolBtn.click();
  await page.waitForTimeout(300);
  const result = chat.locator('[data-chat-entry="tool_result"]');
  assert.equal(await result.count(), 1, 'the clicked tool block did not open its result');
  assert.ok(((await result.textContent()) ?? '').includes('→ 504 geçti · 0 kaldı'), 'the tool output line is missing');
  // the IDE code face: language readout + copy button (CodeBlock)
  assert.ok((await page.locator('[data-code-lang="TS"]').count()) >= 1, 'the code block carries no language header');
  assert.ok((await page.getByRole('button', { name: 'Kodu kopyala' }).count()) >= 1, 'no copy button on the code block');
  // bottom-pin: fill past the column's cap and it rides along; scroll up and it lets go
  const atBottom = () => page.locator('[data-chat]').first().evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  // 2026-08-25 (operator repro): a tool block whose long output OVERFLOWS the column, read from
  // the top (chip up), then collapsed back under the cap — the transcript fits again, so the ▾
  // chip must retire. It used to float over a fully-visible column: the collapse shrinks
  // scrollHeight without touching scrollTop — no clamp, no scroll event, stale chip state. The
  // ResizeObserver on the content column is the fix's witness.
  await emit({ kind: 'tool_use', callId: 'c2', tool: 'Read', input: { file_path: 'src/büyük-dosya.ts' } });
  await emit({ kind: 'tool_result', callId: 'c2', summary: 'SATIR '.repeat(600), isError: false });
  await page.waitForTimeout(300);
  const readBtn = chat.locator('[data-chat-entry="tool_use"]', { hasText: 'büyük-dosya' }).locator('button');
  await readBtn.click(); // open the long output → the column overflows
  await page.waitForTimeout(300);
  await chat.evaluate((el) => { el.scrollTop = 0; }); // read from the top — the chip shows
  await page.waitForTimeout(200);
  assert.ok((await page.locator('[data-chat-jump]').count()) >= 1, 'no jump chip while the long block is open and the reader is up');
  await readBtn.click(); // collapse → the short transcript fits again
  await page.waitForTimeout(300);
  assert.ok(await atBottom(), 'the collapsed transcript is not fully visible');
  assert.equal(await page.locator('[data-chat-jump]').count(), 0, 'the jump chip stayed over a fully-visible column');
  await page.screenshot({ path: join(SHOTS, 'chat-collapse-retired@980.png') });
  for (let i = 0; i < 10; i++) {
    await emit({ kind: 'assistant_text', text: `Doldurma satırı ${i} — `.padEnd(220, 'x') });
  }
  await page.waitForTimeout(400);
  assert.ok(await atBottom(), 'the column did not pin to the bottom while riding along');
  await page.locator('[data-chat]').first().evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  await emit({ kind: 'assistant_text', text: 'Yeni satır — yukarı kaydırılmışken geldi.' });
  await page.waitForTimeout(300);
  assert.ok(await page.locator('[data-chat]').first().evaluate((el) => el.scrollTop < 48), 'an append dragged the reader back to the bottom');
  assert.ok((await page.locator('[data-chat-jump]').count()) >= 1, 'no jump chip while scrolled up');
  await page.locator('[data-chat-jump]').first().click();
  await page.waitForTimeout(200);
  assert.ok(await atBottom(), 'the jump chip did not restore the bottom');
  await page.screenshot({ path: join(SHOTS, 'chat-live@980.png') });
  await stopAllDrives();
  // cleanup: the throwaway work order leaves the way it came
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('Evet, sil').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Sohbet denemesi' }).count(), 0, 'the throwaway chat WO survived');
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

// WO-0036: the edit dialog joins the same contract — Kaydet is never locked for validity (the click
// itself lands), the refusal sits under the field with focus, and a CLEARED description saves empty
// (the old non-empty guard silently swallowed the clear).
await spec('edit dialog: Kaydet stays live on an empty title; a cleared description saves (WO-0036)', async () => {
  await openDetail('Plan bekliyor');
  await stopAllDrives();
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="İş emrini düzenle"]').first().click();
  await page.waitForTimeout(300);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('input#wo-edit-title').fill('');
  await dlg.getByRole('button', { name: 'Kaydet', exact: true }).click(); // pointer-events live — the click lands
  await page.waitForTimeout(250);
  assert.ok((await dlg.getByText('Başlık gerekli.').count()) >= 1, 'no title error under the field');
  assert.ok((await dlg.locator('[role="alert"]').count()) >= 1, 'the error line does not announce');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'a refused save did not focus the title');
  assert.equal(await dlg.count(), 1, 'the dialog closed on a refused save');
  await page.screenshot({ path: join(SHOTS, 'wo-edit-title-error@980.png') });
  // the cleared description now SAVES (an empty Objective is a valid surgical edit) — prove it, restore
  await dlg.locator('input#wo-edit-title').fill('Plan bekliyor');
  await dlg.locator('textarea#wo-edit-desc').fill('');
  await dlg.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(700); // updateWorkOrder → reloadDetail
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the edit dialog did not close');
  await page.locator('button[aria-label="İş emrini düzenle"]').first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[role="dialog"] textarea#wo-edit-desc').inputValue(), '', 'the cleared description did not save');
  await page.locator('[role="dialog"] textarea#wo-edit-desc').fill('E2E: plan proposed, awaiting approval.');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(700);
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

await spec('DOSYA record: Belgeler rows + Oturum dökümü cards — evidence is contextual, no standing Kanıt (WO-0038)', async () => {
  await openDetail('Uygulama sürüyor'); // single-repo, implementation: 1/1 done + proceed → closable
  // the standing Kanıt showcase died — evidence lives ONLY in the close decision's own card
  assert.equal(await page.getByText('Kanıt', { exact: true }).count(), 0, 'a standing Kanıt section survived');
  // tur-2 D3 stands: the Depolar section stays gone (WO-0033 renamed the word; the claim survives)
  assert.equal(await page.getByText('Depolar', { exact: true }).count(), 0, 'a Depolar surface still exists');
  // the evidence checklist renders INSIDE the allStepsDone close card (the moment it matters):
  // satisfied ✓, absence sentences in plain words (never a bare 'eksik')
  assert.ok((await page.getByText('Tüm adımlar tamam').count()) >= 1, 'no allStepsDone close card');
  assert.ok((await page.getByText('✓ plan onayı', { exact: true }).count()) >= 1, 'no satisfied plan-approval chip in the close card');
  assert.ok((await page.getByText('henüz PR yok', { exact: true }).count()) >= 1, 'no track position chip in the close card');
  // WO-0074 (WO-0069): NO verifier leg was ever recorded → the honest chip is the UNKNOWN form
  // ('doğrulanamadı — bakılamadı'), never the absence sentence (nothing is missing; nothing was
  // observed either) and never the resolve-miss line (no report exists to miss).
  assert.ok((await page.getByText('doğrulanamadı — bakılamadı', { exact: true }).count()) >= 1, 'no unknown-verification chip in the close card');
  assert.equal(await page.getByText('eksik', { exact: true }).count(), 0, 'a reasonless eksik leaked');
  // WO-0038 order: Belgeler → (Kaynaklar on presence) → Oturum dökümü — the one scroll's sections
  const ids = await page.evaluate(() => [...document.querySelectorAll('.flow-scroll section[id]')].map((s) => s.id));
  // WO-0074: WO-0068 added the Değişiklikler record section (working trees + the operator's
  // console) between Belgeler and Oturum dökümü — on this seed it speaks deterministically (the
  // non-git repo's degraded look IS content, the section's own gate).
  assert.deepEqual(ids, ['sec-docs', 'sec-changes', 'sec-audit'], `the record sections are wrong: ${ids.join(',')}`);
  // Belgeler: ONE COLLAPSED ROW per doc — human word + dim filename pointer + the section count
  const docs = page.locator('section#sec-docs');
  const orderRow = docs.locator('button').filter({ hasText: 'order.md' });
  const planRow = docs.locator('button').filter({ hasText: 'plan.md' });
  assert.equal(await orderRow.count(), 1, 'no İş emri doc row');
  assert.equal(await planRow.count(), 1, 'no Plan doc row');
  assert.ok(((await orderRow.textContent()) ?? '').includes('İş emri'), 'the order row lost its human name');
  assert.ok(((await planRow.textContent()) ?? '').includes('Plan'), 'the plan row lost its human name');
  assert.ok((await orderRow.getByText(/\d+ bölüm/).count()) >= 1, 'the order row carries no section count');
  // 2026-08-24 (operator: "0 lar gözükmesin"): a fence-only plan has no ## sections — the count
  // draws only when there is one to count.
  assert.equal((await planRow.getByText('0 bölüm').count()), 0, 'a zero section count rendered');
  assert.equal(await docs.locator('.repbody').count(), 0, 'a doc renders open by default');
  await orderRow.click();
  await page.waitForTimeout(300);
  assert.equal(await orderRow.getAttribute('aria-expanded'), 'true', 'the doc row did not expand');
  const repbody = docs.locator('.repbody');
  assert.ok((await repbody.count()) >= 1, 'no .repbody after expanding');
  assert.ok(((await repbody.first().textContent()) ?? '').includes('Objective'), 'the expanded row is not the order.md markdown');
  // Oturum dökümü: the session CARDS — one per session, each with its ARTIFACT HEADLINE (özet).
  // 2026-08-23 (operator): the count ASIDE is dead — the cards are the count.
  const audit = page.locator('section#sec-audit');
  assert.equal(await audit.getByText('2 oturum').count(), 0, 'the dead count aside survived');
  const cards = audit.locator('[data-session-card]');
  const cardCount = await cards.count();
  assert.equal(cardCount, 2, `expected 2 session cards, got ${cardCount}`);
  assert.ok((await audit.getByText('Özet — E2E: did the work').count()) >= 1, 'the step card carries no agent-closing özet');
  assert.ok((await audit.getByText('Özet — Mimar: proceed — adım onaylandı').count()) >= 1, 'the review card carries no verdict özet');
  await backToBoard();
});

await spec('Kapat is a dialog with NO ⏎ path; the closure results card seals once', async () => {
  await backToBoard(); // defensive: the previous spec may have died mid-detail
  await openDetail('Tamamlanmış iş'); // WO-0074: the two-leg fixture — the honest close COMPLETES (glow, Kapandı)
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
  assert.ok((await page.getByText('2/2 adım').count()) >= 1, 'no 2/2 adım stat');
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
  await openDetail('Tamamlanmış iş'); // WO-0074: the reopen re-anchors to the fixture that closed
  assert.ok((await page.locator('[data-seal]').count()) >= 1, 'no seal on reopen');
  assert.equal(await page.locator('[data-seal].sealpop').count(), 0, 'the seal re-animated on reopen');
  // WO-0031f K1 (operator review amendment): the closed strip's pencil stays IN PLACE — no standing
  // line (the closed state is already named beside it); inert review badge; Sil STAYS. WO-0037: the
  // lock is the GUARDED form (dim, handler-less, pointer events KEPT so the tooltip can open), not
  // the kit `locked` pointer-events-none form.
  const closedPencil = page.getByRole('button', { name: 'İş emrini düzenle', exact: true });
  assert.ok((await closedPencil.count()) >= 1, 'the pencil vanished from the closed strip');
  const pencilClass = (await closedPencil.first().getAttribute('class')) ?? '';
  assert.ok(pencilClass.includes('opacity-45'), `the closed pencil is not dimmed: ${pencilClass}`);
  assert.ok(!pencilClass.includes('pointer-events-none'), `the closed pencil swallows its tooltip (pointer events off): ${pencilClass}`);
  assert.ok((await page.getByText('Kapalı iş emri değişmez', { exact: true }).count()) === 0, 'the immutability line still renders');
  assert.ok((await page.locator('span[data-review-mode]').count()) >= 1, 'the review badge is not the inert span form');
  assert.ok((await page.getByRole('button', { name: 'Sil', exact: true }).count()) >= 1, 'Sil vanished from the closed strip');
  // WO-0038: evidence is CONTEXTUAL — the close card that carried the checklist died with the
  // decision, so a sealed archive shows no standing chip row; the record speaks as session cards
  assert.equal(await page.locator('[data-evidence-chips]').count(), 0, 'the closed archive kept a standing chip row');
  assert.ok((await page.locator('[data-session-card]').count()) >= 2, 'the sealed record lost its session cards');
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

// ===== WO-0031e tur-3 → WO-0038 (the session-card ledger) + the WO-0031f board package =====
// (order matters: the session-card spec needs raf's WO still OPEN — the closable spec ends by
//  closing it, which stages the all-done arrival pulse)

await spec('session cards expand: the archived chat under its header; tool blocks start collapsed (WO-0038)', async () => {
  await page.locator('header button', { hasText: 'e2e' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /raf/ }).first().click();
  await page.waitForTimeout(600);
  await openDetail('Raf işi');
  const card = page.locator('[data-session-card]');
  const cardCount = await card.count();
  assert.equal(cardCount, 1, `expected 1 session card, got ${cardCount}`);
  const cardText = (await card.first().textContent()) ?? '';
  // WO-0044 tur 2: the head line is KİM — ROL (the step's aim rides its own line below it), and
  // the card carries its role EDGE (.rcard-implementer) — the old role lamp chip is gone.
  assert.ok(cardText.includes('Adım 1 — Uygulayıcı'), `the card is not named for its step: ${cardText}`);
  assert.ok(cardText.includes('Özet — Raf: döküm satırı 1'), 'the artifact headline (özet) is missing');
  assert.ok(((await card.first().getAttribute('class')) ?? '').includes('rcard-implementer'), 'the card carries no role edge');
  // history sits CLOSED: the archived chat hides behind the ONE toggle (header + özet, a single
  // button — the aç/kapa IS the old SADE/DETAY distinction, now living on the card)
  assert.equal(await card.locator('[data-chat]').count(), 0, 'the archived chat renders before opening');
  const toggle = card.locator('[data-session-toggle]');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the card starts collapsed');
  await toggle.click();
  await page.waitForTimeout(300);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'the card did not open');
  const chat = card.locator('[data-chat]');
  assert.equal(await chat.count(), 1, 'no chat inside the opened card');
  const chatText = (await chat.textContent()) ?? '';
  assert.ok(chatText.includes('Raf: döküm satırı 1'), 'the assistant line is missing');
  // archived tool blocks start COLLAPSED (terminal-on-demand) — expand the call to see its output
  assert.equal(await chat.locator('[data-chat-entry="tool_result"]').count(), 0, 'the tool result renders before expanding');
  await chat.locator('[data-chat-entry="tool_use"] button').click();
  await page.waitForTimeout(250);
  const result = chat.locator('[data-chat-entry="tool_result"]');
  assert.equal(await result.count(), 1, 'the tool block did not expand');
  assert.ok(((await result.textContent()) ?? '').includes('→ Raf: döküm satırı 3'), 'the tool output line is missing');
  await page.screenshot({ path: join(SHOTS, 'sessions@980.png') });
  // toggle again — the chat hides
  await toggle.click();
  await page.waitForTimeout(250);
  assert.equal(await card.locator('[data-chat]').count(), 0, 'the chat did not hide on toggle');
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
  // the reopened archive carries the guarded lock (WO-0037: dim + handler-less, pointer events kept —
  // the K1 strip form is asserted in the closure spec)
  await openDetail('Raf işi');
  const rafPencil = page.getByRole('button', { name: 'İş emrini düzenle', exact: true });
  assert.ok((await rafPencil.count()) >= 1, 'the pencil vanished from the reopened archive');
  const rafPencilClass = (await rafPencil.first().getAttribute('class')) ?? '';
  assert.ok(rafPencilClass.includes('opacity-45'), 'the archive pencil is not dimmed');
  await backToBoard();
  // leave the workspace tidy for the empty-DB spec (it launches its own app)
});

// ===== WO-0032 specs (workspace deletion) — the deletion is permanent in the shared db, so these
// run LAST among the first-app specs: after them only 'çöp' is gone, which nothing else references.

await spec('WS sil: Sil stacks over the edit modal; Vazgeç returns with edits; Evet, sil → fallback board (WO-0032)', async () => {
  // switch to the 'çöp' workspace — its two WOs are the deletion payload. The previous spec leaves
  // the app on the raf board, so open the switcher by position (the first header button), not label.
  await page.locator('header button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'çöp', exact: true }).first().click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-wo-id]').count(), 2, 'the çöp board does not show exactly its two WOs');
  // the row gear opens the edit modal; an unsaved edit rides through the Vazgeç roundtrip
  await page.locator('header button', { hasText: 'çöp' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('div.w-72 > div').filter({ hasText: 'çöp' }).first().locator('button[aria-label="Çalışma alanı ayarları"]').click();
  await page.waitForTimeout(300);
  assert.ok((await page.getByRole('button', { name: 'Çalışma alanını sil', exact: true }).count()) >= 1, 'no Sil entry in the edit modal');
  await page.locator('[role="dialog"] input').first().fill('çöp düzenlendi');
  await page.getByRole('button', { name: 'Çalışma alanını sil', exact: true }).click();
  await page.waitForTimeout(300);
  // the confirm stacks OVER the intact settings modal (the WO dialogs' pattern) — both present,
  // the counted consequence line in the topmost dialog
  assert.equal(await page.locator('[role="dialog"]').count(), 2, 'the confirm did not stack over the settings modal');
  // the z-ladder regression guard: confirm z-70 OVER settings z-50, so its overlay (z-60) actually
  // dims/blurs the parent — before the fix the parent painted above the overlay and stayed crisp
  const zis = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].map((d) => getComputedStyle(d).zIndex),
  );
  assert.deepEqual(zis, ['50', '70'], `the stacked z-ladder is wrong: ${zis.join('/')}`);
  // narrower + same center, never offset (the macOS alert-over-sheet read)
  const [parentBox, confirmBox] = await Promise.all([
    page.locator('[role="dialog"]').first().boundingBox(),
    page.locator('[role="dialog"]').last().boundingBox(),
  ]);
  assert.ok(parentBox && confirmBox, 'a stacked dialog has no bounding box');
  assert.ok(confirmBox.width < parentBox.width, `the confirm is not narrower (${confirmBox.width} vs ${parentBox.width})`);
  const centers = [parentBox.x + parentBox.width / 2, confirmBox.x + confirmBox.width / 2];
  assert.ok(Math.abs(centers[0] - centers[1]) <= 1, `the confirm is not centered over the parent (${centers[0]} vs ${centers[1]})`);
  const line = await page.locator('[role="dialog"]').last().textContent();
  assert.ok(line?.includes('2 iş emri'), `the consequence line carries no count: ${line}`);
  assert.ok(line?.includes('Geri alınamaz'), 'no irreversible line in the confirm');
  await page.screenshot({ path: join(SHOTS, 'ws-delete-confirm@980.png') });
  // Vazgeç returns to the settings modal — still open, the unsaved edit intact (operator finding)
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[role="dialog"]').count(), 1, 'Vazgeç closed the settings modal too');
  assert.equal(await page.locator('[role="dialog"] input').first().inputValue(), 'çöp düzenlendi', 'Vazgeç lost the unsaved edit');
  // round two: confirm for real
  await page.getByRole('button', { name: 'Çalışma alanını sil', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click();
  await page.waitForTimeout(1000); // cascade + both list refreshes
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'dialogs remained after a successful delete');
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
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(800); // started → session row 'running' → the board refresh lands
  // open the e2e row's settings: the Sil entry is absent, the reason line stands in (ADR-0001)
  await page.locator('header button').first().click();
  await page.waitForTimeout(300);
  await page.locator('div.w-72 > div').filter({ hasText: 'e2e' }).first().locator('button[aria-label="Çalışma alanı ayarları"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[role="dialog"]').getByRole('button', { name: 'Çalışma alanını sil' }).count(), 0, 'the Sil entry rendered under a live drive');
  assert.ok((await page.locator('[role="dialog"]').getByText('önce oturumu durdur').count()) >= 1, 'no gate reason in the edit modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await stopAllDrives();
  await backToBoard();
});

// ===== WO-0033 specs (depo bağlantıları) — run on the 'e2e' workspace AFTER the deletion specs:
// the ledger spec adds a second repo and removes it before ending, so the shared db stays net-zero.

await spec('WS depo: Defter rows — full path, guards, path edit, name collision (WO-0033)', async () => {
  // the switcher's e2e row gear opens the edit modal (the pattern the WO-0032 specs use)
  await page.locator('header button').first().click();
  await page.waitForTimeout(300);
  await page.locator('div.w-72 > div').filter({ hasText: 'e2e' }).first().locator('button[aria-label="Çalışma alanı ayarları"]').click();
  await page.waitForTimeout(500); // connections + definition + open-WO map load
  const dlg = page.locator('[role="dialog"]');
  // AC 1: the single seeded repo is a two-line row — basename + the FULL mono path in `title`
  assert.ok((await dlg.getByText('repo', { exact: true }).count()) >= 1, 'no basename row for the seeded repo');
  const pathLine = dlg.locator('div[title^="/"]');
  assert.ok((await pathLine.count()) >= 1, 'no full-path line on the ledger row');
  assert.ok(((await pathLine.first().getAttribute('title')) ?? '').endsWith('/repo'), 'the row title is not the connection path');
  // AC 4 (a)+(c) surfaces: the single repo is the decision store AND the last one — the ✕ renders
  // LOCKED in place (ADR-0001 2026-08-21 addendum), the reason rides its hover tooltip, and the
  // dead button removes nothing
  assert.equal(await dlg.getByRole('button', { name: 'Depoyu kaldır' }).count(), 1, 'the guarded row lost its ✕');
  await dlg.getByRole('button', { name: 'Depoyu kaldır' }).hover();
  await page.waitForTimeout(500);
  assert.ok((await page.getByRole('tooltip').getByText('Karar deposu').count()) >= 1, 'no guard tooltip on hover');
  await dlg.getByRole('button', { name: 'Depoyu kaldır' }).click();
  await page.waitForTimeout(400);
  assert.equal(await dlg.locator('div[title^="/"]').count(), 1, 'the locked ✕ removed something');
  assert.ok((await dlg.getByText('● karar deposu').count()) >= 1, 'no decision-store marker');
  // the `+` reveal: the entry row appears on press; the immediate add lands a second, unguarded row
  const openAdd = () => dlg.getByRole('button', { name: 'Depo ekle' }).click();
  const draft = dlg.locator('input[placeholder="yerel depo yolu"]');
  await openAdd();
  await page.waitForTimeout(250);
  await draft.fill('/tmp/e2e-ikinci-depo');
  await dlg.getByRole('button', { name: 'Ekle', exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok((await dlg.getByText('e2e-ikinci-depo', { exact: true }).count()) >= 1, 'the immediate add did not land a row');
  assert.equal(await dlg.getByRole('button', { name: 'Depoyu kaldır' }).count(), 2, 'the second row has no live ✕');
  assert.equal(await dlg.locator('input[placeholder="yerel depo yolu"]').count(), 0, 'the edit-mode add row did not collapse');
  // AC 7 (operator review r3 form): the decision store is picked with an EXPLICIT ○ button beside
  // ✎ — the row itself is not a click target. The ● label opens on the SAVED store ('repo'); a
  // press moves it, a press back keeps the db net-zero (Kaydet never fires in this spec).
  // Row order is the workspace_repo PK scan order (repo_id lexicographic — 'e2e-ikinci-depo'
  // sorts before 'repo'), so rows are targeted BY PATH TITLE, never by index.
  const rowByPath = (p) => dlg.locator(`div:has(div[title="${p}"])`).last();
  const rootPath = await dlg.locator('div[title^="/"][title$="/repo"]').first().getAttribute('title');
  assert.ok(rootPath, 'no seeded repo row to anchor the DS assert');
  assert.ok((await rowByPath(rootPath).getByText('karar deposu').count()) >= 1, 'the ● label does not open on the saved store');
  assert.equal(await dlg.getByRole('button', { name: 'Karar deposu yap' }).count(), 1, 'not exactly one DS button with two repos');
  await rowByPath('/tmp/e2e-ikinci-depo').getByRole('button', { name: 'Karar deposu yap' }).click();
  await page.waitForTimeout(250);
  assert.ok((await rowByPath('/tmp/e2e-ikinci-depo').getByText('karar deposu').count()) >= 1, 'the DS button did not move the label');
  await rowByPath(rootPath).getByRole('button', { name: 'Karar deposu yap' }).click();
  await page.waitForTimeout(250);
  assert.ok((await rowByPath(rootPath).getByText('karar deposu').count()) >= 1, 'the pick did not return to the saved store');
  // AC 9 in the UI: a same-basename add refuses with its line under the add row
  await openAdd();
  await page.waitForTimeout(250);
  await draft.fill('/tmp/other/repo');
  await dlg.getByRole('button', { name: 'Ekle', exact: true }).click();
  await page.waitForTimeout(400);
  assert.ok((await dlg.getByText('Bu adda depo zaten var.').count()) >= 1, 'no collision line');
  assert.equal(await dlg.locator('div[title^="/"]').count(), 2, 'the collision changed the row count');
  await page.screenshot({ path: join(SHOTS, 'ws-repos-ledger@980.png') });
  // path edit: same basename moves; a different basename refuses inline and ESC reverts.
  // WO-0059 rev 4: the editor input announces its row (the path line's title div unmounts while
  // editing — a row-scoped anchor would self-delete; the aria-label is the stable anchor).
  const rowEditor = (name) => dlg.locator(`input[aria-label="Depo yolunu düzenle: ${name}"]`);
  await rowByPath('/tmp/e2e-ikinci-depo').getByRole('button', { name: 'Depo yolunu düzenle' }).click();
  await page.waitForTimeout(250);
  const editor = rowEditor('e2e-ikinci-depo');
  assert.ok((await editor.count()) === 1, 'the ✎ did not open a path editor');
  assert.equal(await editor.inputValue(), '/tmp/e2e-ikinci-depo', 'the editor seeded the wrong row');
  await editor.fill('/tmp/yeni/yol/e2e-ikinci-depo');
  await editor.press('Enter');
  await page.waitForTimeout(500);
  assert.ok((await dlg.locator('div[title="/tmp/yeni/yol/e2e-ikinci-depo"]').count()) >= 1, 'the path edit did not commit');
  await rowByPath('/tmp/yeni/yol/e2e-ikinci-depo').getByRole('button', { name: 'Depo yolunu düzenle' }).click();
  await page.waitForTimeout(250);
  const editor2 = rowEditor('e2e-ikinci-depo');
  await editor2.fill('/tmp/farkli-ad');
  await editor2.press('Enter');
  await page.waitForTimeout(400);
  assert.ok((await dlg.getByText('Ad değişemez', { exact: false }).count()) >= 1, 'no basename refusal line');
  assert.equal((await editor2.count()), 1, 'a failed commit closed the editor (the typed text would be lost)');
  await editor2.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await editor2.count(), 0, 'ESC did not revert the editor');
  assert.equal(await page.locator('[role="dialog"]').count(), 1, 'ESC closed the whole dialog instead of the editor');
  assert.ok((await dlg.locator('div[title="/tmp/yeni/yol/e2e-ikinci-depo"]').count()) >= 1, 'ESC changed the committed path');
  // confirmless removal brings the ledger back to one row (net zero for the suite); the guard
  // tooltip returns with the single row's locked ✕
  await rowByPath('/tmp/yeni/yol/e2e-ikinci-depo').getByRole('button', { name: 'Depoyu kaldır' }).click();
  await page.waitForTimeout(600);
  assert.equal(await dlg.locator('div[title^="/"]').count(), 1, 'the removal did not land');
  await dlg.getByRole('button', { name: 'Depoyu kaldır' }).hover();
  await page.waitForTimeout(500);
  assert.ok((await page.getByRole('tooltip').getByText('Karar deposu').count()) >= 1, 'the guard tooltip did not return');
  // the add row is still open (the failed collision kept it) — one Escape collapses it, the next
  // closes the dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // WO-0035: the spec used to leave the Defter modal open (two Escapes were not always enough once
  // the row/editor focus moved) — the leftover dialog aria-hides the appbar for later specs. Close
  // for real and prove it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the Defter spec left its dialog open');
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
    // the zero-errors spec silently. Attaches BEFORE the theme pin's reload (the boot must not
    // skip it; review round 2026-08-24).
    const emptyConsoleErrors = [];
    emptyPage.on('console', (msg) => {
      if (msg.type() === 'error') emptyConsoleErrors.push(msg.text());
    });
    emptyPage.on('pageerror', (err) => emptyConsoleErrors.push(String(err)));
    // WO-0040 — same determinism pin as the main app (emulated dark + mirror stamp + one reboot)
    await emptyPage.emulateMedia({ colorScheme: 'dark' });
    await emptyPage.evaluate(() => localStorage.setItem('docket.theme', 'dark'));
    await emptyPage.reload();
    await emptyPage.waitForTimeout(700);
    await emptyPage.waitForLoadState('domcontentloaded');
    await emptyPage.waitForTimeout(700);
    assert.ok((await emptyPage.getByText('Docket', { exact: true }).count()) >= 1, 'no brand on an empty DB');
    assert.ok((await emptyPage.locator('button[aria-label="Ayarlar"]').count()) >= 1, 'no normal Settings gear on an empty DB');
    assert.ok((await emptyPage.getByText('Haydi ilk çalışma alanını oluşturalım').count()) >= 1, 'no workspace invitation line on an empty DB');
    assert.equal(await emptyPage.getByText('Haydi ilk iş emrini açalım').count(), 0, 'the zero-WO line leaked onto the empty-DB hero (WO-0032 operator finding)');
    assert.ok((await emptyPage.getByRole('button', { name: 'Yeni çalışma alanı' }).count()) === 1, 'not exactly one CTA');
    await emptyPage.screenshot({ path: join(SHOTS, 'empty-db-hero@980.png') });
    // the CTA opens the workspace-create dialog; create one over a temp dir (typed, no native picker)
    await emptyPage.getByRole('button', { name: 'Yeni çalışma alanı' }).click();
    await emptyPage.waitForTimeout(350);
    const wsRepo = join(emptyRoot, 'repo');
    mkdirSync(join(wsRepo, 'docs', 'work-orders'), { recursive: true });
    const dlg = emptyPage.locator('[role="dialog"]');
    // WO-0033: an empty submit is refused UNDER the field it failed on, and focus follows (AC 6)
    await emptyPage.getByRole('button', { name: 'Oluştur', exact: true }).click();
    await emptyPage.waitForTimeout(250);
    assert.ok((await dlg.getByText('Ad gerekli.').count()) >= 1, 'no name error under the Ad field');
    assert.ok((await dlg.locator('[role="alert"]').count()) >= 1, 'the error line does not announce');
    assert.equal(
      await emptyPage.evaluate(() => document.activeElement?.tagName),
      'INPUT',
      'a failed submit did not focus the first invalid field',
    );
    await dlg.locator('input').first().fill('boş');
    // an invalid typed path keeps its line under the add row — no row, no toast (§0's ruling).
    // The add row sits behind the `+` reveal (WO-0033 operator review); create keeps it open.
    const repoInput = dlg.locator('input[placeholder="yerel depo yolu"]');
    await dlg.getByRole('button', { name: 'Depo ekle' }).click();
    await emptyPage.waitForTimeout(250);
    await repoInput.fill('apps/web');
    await dlg.getByRole('button', { name: 'Ekle', exact: true }).click();
    await emptyPage.waitForTimeout(250);
    assert.ok((await dlg.getByText('Tam yol değil — / ile başlamalı.').count()) >= 1, 'no invalid-path line under the add row');
    assert.equal(await dlg.locator('div[title^="/"]').count(), 0, 'an invalid path became a row');
    // a valid row lands; a ✎ that breaks the path keeps the editor + its line (nothing typed is lost)
    await repoInput.fill(wsRepo);
    await dlg.getByRole('button', { name: 'Ekle', exact: true }).click();
    await emptyPage.waitForTimeout(250);
    assert.ok((await dlg.locator(`div[title="${wsRepo}"]`).count()) >= 1, 'the valid row did not land');
    await dlg.getByRole('button', { name: 'Depo yolunu düzenle' }).click();
    await emptyPage.waitForTimeout(250);
    const editor = dlg.locator('input[aria-label="Depo yolunu düzenle: repo"]');
    await editor.fill('apps/web');
    await editor.press('Enter');
    await emptyPage.waitForTimeout(300);
    assert.ok((await dlg.getByText('Tam yol değil — / ile başlamalı.').count()) >= 1, 'no row-level invalid line');
    assert.equal(await editor.count(), 1, 'a failed create-mode commit closed the editor');
    await emptyPage.screenshot({ path: join(SHOTS, 'ws-create-errors@980.png') });
    await editor.press('Escape');
    await emptyPage.waitForTimeout(250);
    // removal empties the ledger (create keeps the entry row open — it IS the empty state then);
    // Oluştur with a valid draft ABSORBS it before validation (AC 6)
    await dlg.getByRole('button', { name: 'Depoyu kaldır' }).first().click();
    await emptyPage.waitForTimeout(250);
    assert.equal(await dlg.locator('div[title^="/"]').count(), 0, 'the removal left a row');
    assert.equal(await dlg.locator('input[placeholder="yerel depo yolu"]').count(), 1, 'create collapsed the entry row');
    // the entry row carries its own Vazgeç ✕ (operator review r6): it collapses the row, the `+`
    // reveal returns, and reopening keeps working
    await dlg.getByRole('button', { name: 'Vazgeç', exact: true }).click();
    await emptyPage.waitForTimeout(250);
    assert.equal(await dlg.locator('input[placeholder="yerel depo yolu"]').count(), 0, 'Vazgeç did not collapse the entry row');
    assert.ok((await dlg.getByRole('button', { name: 'Depo ekle' }).count()) >= 1, 'the + reveal did not return');
    await dlg.getByRole('button', { name: 'Depo ekle' }).click();
    await emptyPage.waitForTimeout(250);
    await repoInput.fill(wsRepo);
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

// ===== WO-0035 — locale specs =====
// The suite DB is seeded locale='tr' (e2e/seed.ts) — the 37 specs above stay Turkish. These three
// own the toggle, detection, and DB-beats-detection proof, and end back in tr.

await spec('language toggle flips the UI instantly (tr → en → tr, WO-0035)', async () => {
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(350);
  const dlg = page.locator('[role="dialog"]');
  // WO-0059 rev 4: dil + tema Genel bölmesinde — menüden oraya geç
  await dlg.locator('[data-settings-item]', { hasText: 'Genel' }).click();
  await page.waitForTimeout(250);
  await dlg.getByRole('button', { name: 'English' }).click();
  await page.waitForTimeout(400);
  // the modal re-localizes itself, the html lang follows, and — without any restart — the board
  // speaks EN: bucket headers, the tr-TR cost comma flipped to the en-US point, duration units.
  // (Board texts are substring matches: the bucket header reads "Your turn N" and the card meta
  // composites the cost — exact would never hit them.)
  assert.ok((await dlg.getByText('Language', { exact: true }).count()) >= 1, 'the modal header did not flip');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('lang')), 'en', 'html lang did not follow');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  assert.ok((await page.getByText('Your turn').count()) >= 1, 'no EN up-bucket header');
  assert.ok((await page.getByText('$6.27').count()) >= 1, 'the cost decimal did not flip to en-US');
  assert.ok((await page.getByText('8m 0s').count()) >= 1, 'the duration units did not localize');
  await page.screenshot({ path: join(SHOTS, 'board-en@980.png') });
  // and back to tr — the gear itself now speaks EN
  await page.locator('button[aria-label="Settings"]').click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"]').locator('[data-settings-item]', { hasText: 'General' }).click();
  await page.waitForTimeout(250);
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Türkçe' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('lang')), 'tr', 'html lang did not return');
  assert.ok((await page.getByText('Sıra sende').count()) >= 1, 'the tr bucket header did not return');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
});

const locRoot = mkdtempSync(join(tmpdir(), 'docket-e2e-loc-'));
const locDb = join(locRoot, 'loc.db');
const launchLoc = (dbPath) => electron.launch({
  args: [join(ROOT, 'dist-electron', 'main.js'), '--lang=tr'],
  env: { ...process.env, DOCKET_DB_PATH: dbPath, DOCKET_E2E: '1', NODE_ENV: 'production' },
});

await spec('a fresh install with a tr system language boots tr (detection, WO-0035)', async () => {
  // --lang=tr makes navigator.language tr; nothing is stored → the detected locale stands
  const a = await launchLoc(locDb);
  try {
    const pa = await a.firstWindow();
    // WO-0040 — same determinism pin as the main app (emulated dark + mirror stamp + one reboot)
    await pa.emulateMedia({ colorScheme: 'dark' });
    await pa.evaluate(() => localStorage.setItem('docket.theme', 'dark'));
    await pa.reload();
    await pa.waitForTimeout(700);
    await pa.waitForLoadState('domcontentloaded');
    await pa.waitForTimeout(700);
    assert.equal(await pa.evaluate(() => navigator.language.startsWith('tr')), true, 'the --lang switch did not reach the renderer');
    assert.ok((await pa.getByText('Haydi ilk çalışma alanını oluşturalım').count()) >= 1, 'detection did not boot tr');
    assert.equal(await pa.evaluate(() => document.documentElement.getAttribute('lang')), 'tr', 'html lang is not tr');
    // pick English explicitly, then WIPE the localStorage mirror before closing — the next boot
    // must prove the DB row, not the mirror
    await pa.locator('button[aria-label="Ayarlar"]').click();
    await pa.waitForTimeout(350);
    // WO-0059 rev 4: dil Genel bölmesinde — menüden oraya geç
    await pa.locator('[role="dialog"] [data-settings-item]', { hasText: 'Genel' }).click();
    await pa.waitForTimeout(250);
    await pa.locator('[role="dialog"]').getByRole('button', { name: 'English' }).click();
    await pa.waitForTimeout(400);
    await pa.evaluate(() => localStorage.clear());
  } finally {
    await a.close();
  }
});

await spec('a stored DB choice beats detection — and the empty-DB hero speaks it (WO-0035)', async () => {
  // same DB, fresh boot with an empty mirror and a tr system language: EN boots anyway — the row won
  const b = await launchLoc(locDb);
  try {
    const pb = await b.firstWindow();
    const locConsoleErrors = [];
    pb.on('console', (msg) => {
      if (msg.type() === 'error') locConsoleErrors.push(msg.text());
    });
    pb.on('pageerror', (err) => locConsoleErrors.push(String(err)));
    // WO-0040 — same determinism pin as the main app (emulated dark + mirror stamp + one reboot;
    // the collectors above attach first so the rebooted boot stays covered)
    await pb.emulateMedia({ colorScheme: 'dark' });
    await pb.evaluate(() => localStorage.setItem('docket.theme', 'dark'));
    await pb.reload();
    await pb.waitForTimeout(700);
    await pb.waitForLoadState('domcontentloaded');
    await pb.waitForTimeout(700);
    assert.ok((await pb.getByText("Let's create your first workspace").count()) >= 1, 'the stored en row did not win over tr detection');
    assert.equal(await pb.evaluate(() => document.documentElement.getAttribute('lang')), 'en', 'html lang is not en');
    // the empty-DB hero in EN: one line, exactly one CTA, no tr leak
    assert.equal(await pb.getByText('Haydi ilk çalışma alanını oluşturalım').count(), 0, 'a tr line leaked onto the EN hero');
    assert.ok((await pb.getByRole('button', { name: 'New workspace', exact: true }).count()) === 1, 'not exactly one EN CTA');
    await pb.screenshot({ path: join(SHOTS, 'empty-db-hero-en@980.png') });
    assert.deepEqual(locConsoleErrors, [], `locale-app console errors: ${locConsoleErrors.join(' | ')}`);
  } finally {
    await b.close();
  }
});

await spec('Tema: Açık/Karanlık pin, Sistem follows the OS live (WO-0040)', async () => {
  // the boot pin stamped the mirror 'dark' (an explicit Karanlık) AND emulated a dark OS — both
  // channels agree on dark; the live Sistem proof comes at the spec's end
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'the pinned dark face did not apply');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    'rgb(0, 0, 0)',
    'the dark palette (layered black) did not apply',
  );
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(350);
  const dlg = page.locator('[role="dialog"]');
  // WO-0059 rev 4: tema Genel bölmesinde — menüden oraya geç
  await dlg.locator('[data-settings-item]', { hasText: 'Genel' }).click();
  await page.waitForTimeout(250);
  // Açık pins light: the attribute, the computed ground and the mirror
  await dlg.getByRole('button', { name: 'Açık', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light', 'Açık did not pin light');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    'rgb(255, 255, 255)',
    'the light palette (pure white) did not apply',
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('docket.theme')), 'light', 'the explicit pick did not reach the mirror');
  await page.screenshot({ path: join(SHOTS, 'settings-light@980.png') }); // the operator reviews the light face
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, 'board-light@980.png') });
  // Karanlık pins dark explicitly
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(350);
  const dlg2 = page.locator('[role="dialog"]');
  await dlg2.locator('[data-settings-item]', { hasText: 'Genel' }).click();
  await page.waitForTimeout(250);
  await dlg2.getByRole('button', { name: 'Karanlık', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'Karanlık did not pin dark');
  assert.equal(await page.evaluate(() => localStorage.getItem('docket.theme')), 'dark', 'the dark pick did not reach the mirror');
  // Sistem + a LIVE OS flip re-resolves with no click (the matchMedia listener)
  await dlg.getByRole('button', { name: 'Sistem', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => localStorage.getItem('docket.theme')), 'system', 'the system pick did not reach the mirror');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light', 'Sistem did not follow the live OS flip');
  // restore dark for whatever follows, close the dialog
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'Sistem did not follow the OS flip back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
});


// ===== WO-0045 — operator tempo: the Akış chip, the steer queue, the manuel card =====
// The scripted fake acknowledges steer() with a steer_queued event; DELIVERY is this driver's
// scripted steer_delivered emit carrying the noteId the pending row's retract button exposes.
const w45Emit = (ev) => page.evaluate((e) => window.docket.e2e.emit(e), ev);
const w45Done = (result) =>
  w45Emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 100, tokensOut: 30, usd: 0.01 }, result });

await spec('WO-0045 Akış çipi: iki yönlü toggle + order.md + flow_mode_changed audit (temiz WO)', async () => {
  // 'Plan bekliyor': a PENDING plan (no approved steps → nothing auto-starts on open), never closed
  // by the suite's closure specs — the calm strip both chips render as buttons on.
  const card = page.locator('[data-wo-id]', { hasText: 'Plan bekliyor' }).first();
  const woId = await card.getAttribute('data-wo-id');
  await openDetail('Plan bekliyor');
  const chip = page.locator('button[data-flow-mode]').first();
  assert.equal(await chip.getAttribute('data-flow-mode'), 'auto', 'the chip did not default to otomatik');
  assert.ok((await chip.textContent())?.includes('Akış: otomatik'), 'chip word missing');
  assert.ok((await page.locator('button[data-review-mode]').count()) > 0, 'the Denetim chip is not beside it');
  await chip.click();
  await page.waitForTimeout(600); // updateWorkOrder + reloadDetail
  assert.equal(await page.locator('button[data-flow-mode]').first().getAttribute('data-flow-mode'), 'manual', 'the toggle did not reach the view');
  let docs = await page.evaluate((id) => window.docket.source.getWorkOrderDocs(id), woId);
  assert.ok(docs.order.includes('flow_mode: manual'), 'order.md did not carry flow_mode');
  let evs = await page.evaluate((id) => window.docket.source.getWorkOrderEvents(id), woId);
  assert.ok(evs.some((e) => e.kind === 'flow_mode_changed' && e.detail === 'manual'), 'no flow_mode_changed audit');
  // and back — leaves the shared WO exactly as the seed had it
  await page.locator('button[data-flow-mode]').first().click();
  await page.waitForTimeout(600);
  docs = await page.evaluate((id) => window.docket.source.getWorkOrderDocs(id), woId);
  assert.ok(!docs.order.includes('flow_mode'), 'the flip back did not clean the front-matter');
  evs = await page.evaluate((id) => window.docket.source.getWorkOrderEvents(id), woId);
  assert.ok(evs.some((e) => e.kind === 'flow_mode_changed' && e.detail === 'auto'), 'no flow_mode_changed(auto) audit');
  await backToBoard();
});

await spec('WO-0045 Akış: otomatik açılışta adım kendiliğinden koşar; KOŞARKEN manuele çevrilir; sınırda kart devralır', async () => {
  await backToBoard(); // spec A's failure path leaves the detail open — reach the board first
  await openDetail('Akış turu');
  await page.waitForTimeout(700);
  // AUTO (the seed default): the first pending step starts itself — today's behavior, untouched (AC7)
  assert.ok((await page.locator('[data-steer-input]').count()) > 0, 'auto mode did not auto-start step 1');
  assert.equal(await page.locator('button[data-flow-mode]').first().getAttribute('data-flow-mode'), 'auto');
  // Ruling 1: the chip is clickable WHILE the drive runs — the mode is read at the next boundary
  assert.equal(await page.locator('span[data-flow-mode]').count(), 0, 'the Akış chip locked mid-drive (it must not)');
  await page.locator('button[data-flow-mode]').first().click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('button[data-flow-mode]').first().getAttribute('data-flow-mode'), 'manual', 'mid-drive toggle failed');
  // the boundary: step 1 completes — in manual NOTHING follows by itself; the review card appears
  await w45Done('# Rapor\n\nbirinci adım tamam.');
  await page.waitForTimeout(900); // onEnd reload + the next derivation
  await page.waitForTimeout(400);
  const card2 = page.locator('[data-manuel-card]').first();
  assert.ok((await card2.textContent())?.includes('Denetim 1'), `the review card did not appear: ${await card2.textContent()}`);
  assert.equal(await page.locator('[data-steer-input]').count(), 0, 'the review leg started itself');
  await page.getByRole('button', { name: 'Başlat', exact: true }).click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('[data-steer-input]').count()) > 0, 'the review Başlat did not start');
  await w45Done('İnceleme tamam.\nVERDICT: proceed');
  await page.waitForTimeout(900);
  const card3 = page.locator('[data-manuel-card]').first();
  assert.ok((await card3.textContent())?.includes('sıradaki: Adım 2'), `a proceed verdict did not yield the next-step card: ${await card3.textContent()}`);
});

await spec('WO-0045 steer: not gönder → çip sayacı + sırada listesi; teslim → OPERATÖR satırı, sayaç düşer', async () => {
  await page.getByRole('button', { name: 'Başlat', exact: true }).click();
  await page.waitForTimeout(700);
  await page.locator('[data-steer-input]').fill('test notu: ikinci adımı yavaş sür');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  assert.ok((await page.locator('[data-steer-pending="1"]').count()) > 0, 'the pending list did not show the queued note');
  assert.equal(await page.locator('button[data-flow-mode]').first().getAttribute('data-flow-pending'), '1', 'the chip count badge missing');
  assert.equal(await page.locator('[data-chat-entry="operator"]').count(), 0, 'the note appeared mid-turn (must be count-only until the boundary)');
  const noteId = await page.locator('[data-steer-retract]').first().getAttribute('data-steer-retract');
  assert.ok(noteId, 'the pending row exposes no retract handle');
  await w45Emit({ kind: 'steer_delivered', noteId, text: 'test notu: ikinci adımı yavaş sür' });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-steer-pending]').count(), 0, 'the delivered note did not leave the queue');
  await page.locator('[data-pane-log-toggle]').first().click();
  await page.waitForTimeout(500);
  const opLine = page.locator('[data-chat-entry="operator"]').first();
  assert.ok((await opLine.textContent())?.includes('test notu'), 'the operator line missing from the transcript');
  await w45Done('# Rapor\n\nikinci adım tamam.');
  await page.waitForTimeout(900);
  const card = page.locator('[data-manuel-card]').first();
  assert.ok((await card.textContent())?.includes('Denetim 2'), 'step 2 done did not yield its review card');
});

await spec('WO-0045 Durdur bekleyen notla: liste kalır; durmuşta geri çek → satır silinir; Sürdür → not teslim', async () => {
  await page.getByRole('button', { name: 'Başlat', exact: true }).click();
  await page.waitForTimeout(700);
  for (const t of ['birinci düzeltme', 'ikinci düzeltme']) {
    await page.locator('[data-steer-input]').fill(t);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
  }
  assert.ok((await page.locator('[data-steer-pending="2"]').count()) > 0, 'two queued notes did not land');
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(900); // the calm wind-down
  assert.equal(await page.locator('[data-steer-input]').count(), 0, 'the composer stayed after Durdur');
  assert.ok((await page.locator('[data-steer-pending="2"]').count()) > 0, 'the queue did not survive the stop (AC4)');
  // stopped-state retract: the data-port mirror route (the drive is gone)
  await page.locator('[data-steer-retract]').last().click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('[data-steer-pending="1"]').count()) > 0, 'the stopped retract did not remove the row');
  // Sürdür: the first queued note rides the PROMPT (deliveringNote → the fake's synthetic receipt).
  // The pane remounted across the stop → its transcript re-closed: open it, then read the carried line.
  await page.getByRole('button', { name: /Sürdür/ }).first().click();
  await page.waitForTimeout(900);
  const logChip = page.locator('[data-pane-log-toggle]').first();
  if ((await page.locator('[data-chat-entry="operator"]').count()) === 0) await logChip.click();
  await page.waitForTimeout(500);
  const paneText = await page.locator('#live-pane').first().innerText();
  assert.ok(paneText.includes('birinci düzeltme'), `Sürdür did not deliver the carried note: ${paneText.slice(0, 160)}`);
  assert.ok((await page.locator('[data-steer-pending="1"]').count()) > 0, 'the re-queued second note is missing');
  const noteId2 = await page.locator('[data-steer-retract]').first().getAttribute('data-steer-retract');
  await w45Emit({ kind: 'steer_delivered', noteId: noteId2, text: 'ikinci düzeltme' });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-steer-pending]').count(), 0, 'the re-queued note did not deliver');
  await w45Done('İnceleme tamam.\nVERDICT: proceed');
  await page.waitForTimeout(900);
  await stopAllDrives();
  await backToBoard();
});

// ===== WO-0046 — canlı dürüstlük: the context readout, the live token parity, the staleness line =====
// The readout/staleness ride the SAME event path the real adapter feeds: the fake's emit → the
// pipeline fold → the pane. An old `at` stamp on a scripted entry moves the liveness anchor back,
// so the staleness line is testable without waiting out the 3-minute threshold.
await spec('WO-0046 bağlam okuması: rapor yoksa yok; gelince % + token; sürüş bitince kalkar; canlı maliyet in→out taşır', async () => {
  await openDetail('Doluluk turu');
  await page.waitForTimeout(900); // the auto-started step 1 drive + its `started`
  assert.equal(await page.locator('[data-context-readout]').count(), 0, 'a readout rendered before the first report (absent, not zero)');
  await w45Emit({
    kind: 'context_usage',
    usedTokens: 124000,
    maxTokens: 200000,
    percentage: 62,
    cost: { tokensIn: 68000, tokensOut: 2100, usd: 0.41 },
    at: new Date().toISOString(),
  });
  await page.waitForTimeout(500);
  const readout = (await page.locator('[data-context-readout]').first().textContent()) ?? '';
  assert.ok(readout.includes('%62'), `percentage missing from the readout: ${readout}`);
  assert.ok(readout.includes('124k/200k'), `used/max tokens missing from the readout: ${readout}`);
  // AC2 — the live costline speaks the card's formatCost vocabulary (token parity), sourced from
  // the context event's ride-along cost (the only mid-drive token source; D3). NOTE: formatTokens
  // writes a DOT decimal ("2.1k"), and the activity line renders CSS-uppercased — assert the
  // rendered shapes, not the label-bundle strings.
  const headText = await page.locator('#live-pane').first().innerText();
  assert.ok(headText.includes('$0,41 · 68k→2.1k'), `the live costline lacks the in→out token form: ${headText.slice(0, 200)}`);
  await w45Done('# Rapor\n\nbirinci adım tamam.');
  await page.waitForTimeout(1200); // onEnd reload + the auto-started step 2 (flow stays auto)
  assert.equal(await page.locator('[data-context-readout]').count(), 0, 'the readout survived the drive end');
});

await spec('WO-0046 sessizlik: eski damgalı girdi → satır çıkar; taze girdi → temizlenir; Durdur → donmuş kelime, satır asla', async () => {
  await page.waitForTimeout(600); // settle on the auto-started step 2 drive from the prior spec
  assert.ok((await page.locator('[data-steer-input]').count()) > 0, 'step 2 did not auto-start — the staleness specs need a live drive');
  const pane = page.locator('#live-pane').first();
  await w45Emit({ kind: 'tool_use', callId: 'w46s1', tool: 'Read', input: { file_path: '/x' }, at: new Date(Date.now() - 10 * 60_000).toISOString() });
  await page.waitForTimeout(1600); // the one-second ticker re-evaluates the line
  const staleText = await pane.innerText();
  assert.ok(staleText.includes("DK'DIR YENİ ÇIKTI YOK"), `the staleness line missing: ${staleText.slice(0, 200)}`);
  await w45Emit({ kind: 'tool_result', callId: 'w46s1', summary: 'ok', isError: false, at: new Date().toISOString() });
  await page.waitForTimeout(1600);
  const clearedText = await pane.innerText();
  assert.ok(!clearedText.includes('ÇIKTI YOK'), 'the line did not clear on the next entry');
  assert.ok(clearedText.includes('DÜŞÜNÜYOR'), `the activity fallback did not return after the clear: ${clearedText.slice(0, 200)}`);
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(900); // the calm wind-down
  const stoppedText = await pane.innerText();
  assert.ok(!stoppedText.includes('ÇIKTI YOK'), 'the staleness line survived Durdur (frozen words only)');
  assert.ok(stoppedText.includes('DURDURULDU'), 'the frozen state word missing after Durdur');
  await stopAllDrives();
  await backToBoard();
});

// ===== TD-053 (WO-0046 checkpoint): approval must start the first step WITHOUT a re-entry =====
// The operator's live repro (2026-08-26): a WO opened before its plan existed left runIdx
// undefined forever (the initializer ran against empty steps); approving while staying on the
// detail rendered NO instrument and the step sat unstarted until a re-entry remounted it.
await spec('TD-053: plandan önce açılan dosyada onay → adım yeniden giriş olmadan kendiliğinden başlar', async () => {
  await openDetail('TD-053 turu'); // written stage: the detail mounts with NO steps
  await page.getByRole('button', { name: 'Plan iste' }).click();
  await page.waitForTimeout(700); // the fake plan drive opens
  await w45Emit({
    kind: 'plan_ready',
    planText: '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"tek adım","scope":"all"}]\n```\n',
  });
  // The plan session must CLOSE for the proposal to become the saved pending plan (the pipeline's
  // plan_ready capture + the onEnd reload) — the approval surface is the SAVED plan's band.
  await w45Done('Plan önerildi.');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Onayla/ }).click();
  await page.waitForTimeout(1000); // approvePlan + reloadDetail + the runIdx fill + StepPane mount + auto-drive
  assert.ok((await page.locator('[data-steer-input]').count()) > 0, 'the approved first step did not self-start without a re-entry (TD-053)');
  await w45Done('# Rapor\n\ntek adım tamam.');
  await page.waitForTimeout(900);
  await stopAllDrives();
  await backToBoard();
});

// ===== WO-0047 — bütçe kapısı: the warn line, the refusal (kept), the raise + the re-run =====
// Order matters: the KEEP spec runs first — the RAISE lifts the whole workspace's cap, and the
// keep-path needs the gate still closed. The refusal path is the REAL pipeline (the scripted
// runner replaces only the SDK; budgetBlockFor reads the seeded rows) — no scripted events needed
// for the refusal itself.
const switchWs = async (from, to) => {
  await page.locator('header button', { hasText: from }).first().click();
  await page.waitForTimeout(300);
  // the switcher shows the first MAX_WS only — 'uyarı'/'kapı' sit behind "Tümünü gör", which
  // opens the full-list modal (its rows are plain buttons carrying the label)
  const seeAll = page.getByRole('button', { name: /Tümünü gör/ });
  if ((await seeAll.count()) > 0) await seeAll.first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: new RegExp(to) }).first().click();
  await page.waitForTimeout(600);
};

await spec('WO-0047 uyarı: kart + bant bilinen-harcama satırını taşır; warn asla kapatmaz', async () => {
  await switchWs('e2e', 'uyarı');
  const line = await page.locator('[data-wo-id] [data-budget-line]').first().textContent();
  assert.ok(line && line.includes('$4,20'), `the warn line carries no figure: ${line}`);
  assert.ok(line && line.includes('bilinen harcama'), `the known-spend basis missing: ${line}`);
  await openDetail('Uyarı işi');
  await page.waitForTimeout(900); // the auto-started step 1 — warn NEVER blocks
  assert.ok((await page.locator('[data-steer-input]').count()) > 0, 'the warn level blocked the drive (it must not)');
  const band = await page.locator('[data-budget-line]').first().textContent();
  assert.ok(band && band.includes('$4,20'), `the band warn line missing: ${band}`);
  await stopAllDrives();
  await backToBoard();
});

await spec('WO-0047 kapı A: ret kartı, canlı pencere YOK; Kapı kalsın → kart gitti, ayakta satır kaldı', async () => {
  await switchWs('uyarı', 'kapı');
  const stop = await page.locator('[data-wo-id] [data-budget-line]').first().textContent();
  assert.ok(stop && stop.includes('limit doldu'), `the board stop line missing: ${stop}`);
  await openDetail('Kapı işi A');
  await page.waitForTimeout(900); // the auto-start attempt → refused pre-spawn
  assert.equal(await page.locator('[data-budget-refusal-card]').count(), 1, 'no refusal card');
  assert.equal(await page.locator('#live-pane').count(), 0, 'a pane rendered for a refused drive (AC2 no-spawn)');
  assert.equal(await page.locator('[data-steer-input]').count(), 0, 'a drive spawned past the cap');
  await page.screenshot({ path: join(SHOTS, 'budget-refusal-card@980.png') });
  await page.getByRole('button', { name: 'Kapı kalsın' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-budget-refusal-card]').count(), 0, 'the card survived keep');
  const kept = await page.locator('[data-budget-line]').first().textContent();
  assert.ok(kept && kept.includes('limit doldu'), 'the standing stop line died with the card');
  await backToBoard();
});

await spec('WO-0047 kapı B: yükselt → kalıcı ayar + reddedilen sürüş yeniden koşar + ayarlar okuması yeni limiti söyler', async () => {
  await openDetail('Kapı işi B');
  await page.waitForTimeout(900); // refused on entry
  const card = page.locator('[data-budget-refusal-card]').first();
  assert.equal(await card.count(), 1, 'no refusal card on B');
  const prefill = await card.locator('[data-budget-raise-input]').inputValue();
  assert.equal(prefill, '15.1', `the prefill is not max(observed+10, cap): ${prefill}`);
  await page.getByRole('button', { name: /Limiti yükselt ve sür/ }).click();
  await page.waitForTimeout(1200); // setBudget + refreshBudget + restart → the fake runner's started
  assert.ok((await page.locator('[data-steer-input]').count()) > 0, 'the refused drive did not re-run after the raise');
  assert.equal(await page.locator('[data-budget-refusal-card]').count(), 0, 'the card survived the raise');
  await w45Done('# Rapor\n\nkapı sonrası adım tamam.');
  await page.waitForTimeout(900);
  await stopAllDrives();
  // WO-0059 rev 4: the budget group MOVED to the ws Düzenle dialog — the month readout (it names
  // the NEW cap: observed + limit, the warn line gone) lives there now.
  await openWsEdit();
  const readout = await page.locator('[data-budget-month-readout]').first().textContent();
  assert.ok(readout && readout.includes('$15,10'), `the month readout carries no new cap: ${readout}`);
  await page.screenshot({ path: join(SHOTS, 'budget-settings@980.png') });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
  await backToBoard();
});

// ===== WO-0049 — yol haritası: dolu yüzey, şerit, spawn, ekle diyalogları, yapı kökü, geçersiz =====
// The 'yol' workspace shares the seeded store: every OTHER workspace's roadmap surface reads
// invalid (front_matter_mismatch — the file names ITS workspace), which spec 6 pins. Order
// matters: the surface facts (spec 1) run before the mutating specs (3: a spawned WO flips f1-t2;
// 4: a new task + faz; 5: the root round-trip). The group leaves the app on 'e2e' + Pano.
const roadmapLine = seedOut.trim().split('\n').find((l) => l.startsWith('ROADMAP='));
if (!roadmapLine) throw new Error('seed failed: no ROADMAP= line');
const ROADMAP_IDS = JSON.parse(roadmapLine.slice('ROADMAP='.length));
const openRoadmap = async () => {
  await page.getByRole('button', { name: 'Yol Haritası' }).first().click();
  await page.waitForTimeout(600); // the read-once-per-entry refresh
};

await spec('WO-0049 dolu yüzey: başlık metası, şerit, katlanmış geçmiş, sıradaki, WO çipi, bloke satırı', async () => {
  await switchWs('kapı', 'yol'); // WO-0047's last spec leaves the app on 'kapı'
  await openRoadmap();
  const screen = await page.locator('[data-roadmap-screen]').innerText();
  assert.ok(screen.includes('2/5 faz tamam · 2 açık iş emri · $7,32'), `head meta wrong: ${screen.slice(0, 200)}`);
  assert.equal(await page.locator('button[data-faz-seg]').count(), 5, 'the strip does not carry 5 segments');
  const fold = await page.locator('[data-donefold]').innerText();
  assert.ok(fold.includes('2 tamamlanan faz'), `fold label: ${fold}`);
  assert.ok(fold.includes('f0 · f3'), `fold ids: ${fold}`);
  assert.ok(fold.includes('3 WO · $5,20'), `fold meta: ${fold}`);
  assert.equal(await page.locator('div[data-faz-id="f0"]').count(), 0, 'a done faz rendered outside the collapsed fold');
  await page.locator('[data-donefold]').click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('div[data-faz-id="f0"]').count()) === 1, 'the fold did not expand to its cards');
  const siradaki = await page.locator('[data-task-row][data-task-id="f1-t2"]').textContent();
  assert.ok(siradaki.includes('sıradaki'), `the marker is not on the first spawnable row: ${siradaki}`);
  const chip = await page.locator('[data-task-row][data-task-id="f1-t3"] [data-task-wo]').innerText();
  assert.equal(chip, ROADMAP_IDS.foto, `the open chip: ${chip}`);
  assert.ok(screen.includes('E2E bloke notu'), 'the Bloke line does not carry the seeded notes verbatim');
  assert.equal(await page.locator('div[data-faz-id="f2"] [data-task-spawn]').count(), 0, 'a blocked row carries spawn');
  await page.screenshot({ path: join(SHOTS, 'roadmap-full@980.png') });
});

await spec('WO-0049 şerit: segment tıkla → faza kaydır', async () => {
  await page.locator('button[data-faz-seg][data-faz-id="f4"]').click();
  await page.waitForTimeout(800); // the smooth scroll
  // The short seed world cannot bring the LAST card to the viewport top (nothing scrolls past the
  // document's end) — the honest pin: the window MOVED and the whole card is in view.
  const scrollY = await page.evaluate(() => window.scrollY);
  assert.ok(scrollY > 100, `the strip did not scroll: scrollY=${scrollY}`);
  const box = await page.locator('div[data-faz-id="f4"]').boundingBox();
  assert.ok(box, 'no FAZ 4 card');
  assert.ok(box.y >= 0 && box.y + box.height <= 620, `FAZ 4 not fully in view: y=${box.y} h=${box.height}`);
});

await spec("WO-0049 spawn: ön-dolu oluştur → detay çipi → ESC Yol Haritası'ya döner, satır çipi dolar", async () => {
  await page.locator('[data-task-row][data-task-id="f1-t2"] [data-task-spawn]').click();
  await page.waitForTimeout(400);
  const ctx = await page.locator('[data-task-context]').innerText();
  assert.equal(ctx, 'FAZ 1 · GÖREV 2 · Doğrulama akışı · hedef: api', `context line: ${ctx}`);
  const titleVal = await page.locator('[role="dialog"] input').first().inputValue();
  assert.equal(titleVal, 'Doğrulama akışı', `the title is not seeded: ${titleVal}`);
  assert.equal(await page.locator('[role="dialog"] button', { hasText: 'api' }).first().getAttribute('aria-pressed'), 'true', 'the task repo is not pre-checked');
  assert.equal(await page.locator('[role="dialog"] button', { hasText: 'mobile' }).first().getAttribute('aria-pressed'), 'false', 'the other repo is not left off');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(900); // create (task: lands in order.md) + navigate to the detail
  const chip = await page.locator('[data-detail-task-chip]').innerText();
  assert.equal(chip, 'FAZ 1 · Doğrulama akışı', `detail chip: ${chip}`);
  await page.screenshot({ path: join(SHOTS, 'roadmap-detail-chip@980.png') });
  const bandText = await page.locator('[data-detail-task-chip]').locator('xpath=..').innerText();
  const m = /WO-\d+/.exec(bandText);
  assert.ok(m, 'no WO id beside the chip');
  const createdId = m[0];
  await backToBoard(); // ESC — the detail opened OVER the roadmap; back must land there
  assert.equal(await page.locator('[data-roadmap-screen]').count(), 1, 'ESC did not return to Yol Haritası');
  const rowChip = await page.locator('[data-task-row][data-task-id="f1-t2"] [data-task-wo]').innerText();
  assert.equal(rowChip, createdId, 'the spawned row did not flip to the WO chip');
  await page.screenshot({ path: join(SHOTS, 'roadmap-spawn@980.png') });
  // the orphan WO (kare 07 degrade): Pano → its detail carries the qualifier, never a raw id
  await page.getByRole('button', { name: 'Pano' }).click();
  await page.waitForTimeout(400);
  await openDetail('Yol yetim');
  const degrade = await page.getByText('(görev yol haritasında yok)').count();
  assert.equal(degrade, 1, 'no degrade qualifier on the orphan detail');
  await backToBoard();
  await openRoadmap();
});

await spec('WO-0049 ekle diyalogları: görev (boş başlık + depo reddi, sonra geçerli), faz ekle', async () => {
  await page.locator('button[data-task-add][data-faz-id="f4"]').click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(250);
  const titleErrs = await page.locator('[role="dialog"] [role="alert"]').allInnerTexts();
  assert.ok(titleErrs.some((t) => t.includes('Başlık gerekli')), `no under-field error: ${titleErrs.join('|')}`);
  await page.locator('[role="dialog"] input').first().fill('Push öncesi kontrol');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(250);
  const repoErrs = await page.locator('[role="dialog"] [role="alert"]').allInnerTexts();
  assert.ok(repoErrs.some((t) => t.includes('Bir depo seç')), `the repo error missing: ${repoErrs.join('|')}`);
  await page.locator('[role="dialog"] button', { hasText: 'mobile' }).first().click();
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(800); // re-read + applyFazlarEdits + parse-guarded save + refresh
  assert.equal(await page.locator('[data-task-row][data-task-id="f4-t2"]').count(), 1, 'the new task row did not land');
  await page.locator('[data-faz-add]').click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Raporlama');
  await page.locator('[role="dialog"] button', { hasText: 'FAZ 1' }).first().click(); // the dependency chip
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('div[data-faz-id="f5"]').count(), 1, 'no FAZ 5 card');
  assert.equal(await page.locator('button[data-faz-seg]').count(), 6, 'the strip did not gain the 6th segment');
});

await spec('WO-0049 yapı kökü: .docket → yok yüzeyi; docs → geri (dosyalar taşınmaz)', async () => {
  // WO-0059 rev 4: the root knob lives in the ws Düzenle dialog now (global settings are global-only)
  await openWsEdit();
  const input = page.locator('[data-docs-root-section] input');
  assert.equal(await input.inputValue(), 'docs', 'the effective root does not read docs');
  await input.fill('../x');
  await page.locator('[data-docs-root-section] button', { hasText: 'Kaydet' }).click();
  await page.waitForTimeout(300);
  const errs = await page.locator('[data-docs-root-section] [role="alert"]').allInnerTexts();
  assert.ok(errs.some((t) => t.includes('Güvenli göreli yol')), `no invalid-path error: ${errs.join('|')}`);
  await input.fill('.docket');
  await page.locator('[data-docs-root-section] button', { hasText: 'Kaydet' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(600); // onDocsRootChanged → the surface follows the root
  const screen = await page.locator('[data-roadmap-screen]').innerText();
  assert.equal(await page.getByRole('button', { name: '✦ Üret / İçe aktar' }).count(), 1, 'the absent face lost its ✦ action');
  await page.screenshot({ path: join(SHOTS, 'roadmap-root-absent@980.png') });
  // back to docs: the full surface returns unchanged — the files never moved, only the pointer did
  await openWsEdit();
  await page.locator('[data-docs-root-section] input').fill('docs');
  await page.locator('[data-docs-root-section] button', { hasText: 'Kaydet' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(600);
  const back = await page.locator('[data-roadmap-screen]').innerText();
  assert.ok(back.includes('2/6 faz tamam · 3 açık iş emri · $7,32'), `the surface did not return: ${back.slice(0, 180)}`);
});

await spec('WO-0049 geçersiz dosya: adlı sebep satırı, sessiz boş yok', async () => {
  await switchWs('yol', 'e2e'); // the shared store's roadmap.md names 'yol' — front_matter_mismatch
  await openRoadmap();
  const screen = await page.locator('[data-roadmap-screen]').innerText();
  assert.ok(screen.includes('Yol haritası okunamadı'), `not the invalid surface: ${screen.slice(0, 140)}`);
  assert.ok(screen.includes('workspace uyuşmuyor'), `no named reason: ${screen.slice(0, 220)}`);
  assert.equal(await page.locator('div[data-faz-id]').count(), 0, 'faz cards rendered on an invalid doc');
  await page.screenshot({ path: join(SHOTS, 'roadmap-invalid@980.png') });
  await page.getByRole('button', { name: 'Pano' }).click(); // leave the suite on Pano
});

// ===== WO-0050 — ✦ taslak sürüşü: boş yüzey, üretim, parse-koruma, itiraz + düzenle, bütçe, kalıcılık =====
// The 'taslak' world is CLEAN (no roadmap.md — the generate flow starts from the absent face); the
// 'taslak-kirli' world carries a seeded INVALID draft row (no fence) + its draft session row; the
// 'taslak-kapı' world sits at its cap with its own store. The draft md is byte-built here (the
// seed's buildRoadmapMd twin) — never hand-typed JSON inside a fence the parser must re-read.
const taslakLine = seedOut.trim().split('\n').find((l) => l.startsWith('TASLAK='));
if (!taslakLine) throw new Error('seed failed: no TASLAK= line');
// WO-0051: the DEPO world's id + the external candidate path (outside the structure root).
const depoLine = seedOut.trim().split('\n').find((l) => l.startsWith('TASLAK_DEPO='));
if (!depoLine) throw new Error('seed failed: no TASLAK_DEPO= line');
const DEPO = JSON.parse(depoLine.slice('TASLAK_DEPO='.length));
const DRAFT_MD = (slug, title, fazTitle) =>
  `---\nworkspace: ${slug}\ntitle: ${title}\n---\n\n# ${title}\n\n\`\`\`fazlar\n[\n  {\n    "id": "f0",\n    "title": "${fazTitle}",\n    "aim": "E2E amacı",\n    "blockedBy": [],\n    "tasks": [\n      { "id": "f0-t1", "title": "Taslak görev 1", "repo": "repo-taslak" }\n    ]\n  }\n]\n\`\`\`\n`;
const openDraftDialog = async () => {
  await page.getByRole('button', { name: '✦ Üret / İçe aktar' }).first().click();
  await page.waitForTimeout(350);
};
const startDraft = async (note) => {
  await openDraftDialog();
  await page.locator('#roadmap-draft-note').fill(note);
  await page.getByRole('button', { name: /Taslağı başlat/ }).click();
  await page.waitForTimeout(500); // start → main → the pipeline → the e2e runner's started
};
const draftEmit = (ev) => page.evaluate((e) => window.docket.e2e?.emit(e), ev);
const w50Done = () =>
  draftEmit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1200, tokensOut: 300, usd: 0.12 } });

await spec('WO-0050 geçersiz taslak (dogfood 2026-08-29): dürüst başlık, İtiraz kalktı, Sürdür tek eylem', async () => {
  await switchWs('e2e', 'taslak-kirli');
  await openRoadmap();
  const card = page.locator('[data-roadmap-draft-card]');
  assert.equal(await card.count(), 1, 'the seeded draft row raised no card');
  const text = await card.innerText();
  assert.ok(text.includes('TASLAK TAMAMLANAMADI'), `not the unreadable head: ${text.slice(0, 160)}`); // the readout's CSS uppercases innerText
  assert.ok(text.includes('Taslak okunamadı'), `not the invalid line: ${text.slice(0, 160)}`);
  assert.ok(text.includes('fazlar bloğu yok'), `no named diagnostic: ${text.slice(0, 220)}`);
  assert.equal(await card.getByRole('button', { name: 'Onayla', exact: true }).count(), 0, 'Onayla rendered on an invalid draft');
  assert.equal(await card.getByRole('button', { name: 'Düzenle', exact: true }).count(), 0, 'Düzenle rendered on a fence-less draft');
  assert.equal(await card.getByRole('button', { name: 'İtiraz et' }).count(), 0, 'İtiraz et still offers an objection target that does not exist');
  assert.equal(await card.locator('[data-draft-resume]').count(), 1, 'no Sürdür on the unreadable draft (the session row exists)');
  assert.equal(await card.locator('[data-draft-discard]').count(), 1, 'no Sil beside the Sürdür (the scratch-start path)');
  // Sil CONFIRMS (the operator's round 2): the dialog names what dies; Vazgeç keeps the card
  await card.locator('[data-draft-discard]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('dialog').count(), 1, 'Sil fired without its confirm dialog');
  await page.locator('[data-draft-discard-confirm]').waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: 'Vazgeç' }).last().click(); // the footer's Vazgeç — the X's aria shares the word
  await page.waitForTimeout(300);
  assert.equal(await card.count(), 1, 'Vazgeç discarded the card anyway');
  await page.screenshot({ path: join(SHOTS, 'draft-invalid@980.png') });
  await page.getByRole('button', { name: 'Pano' }).click();
});

await spec('WO-0050 ölü taslak yolculuğu: Sürdür notsuz resume → yeni öneri kartı hazırlar', async () => {
  await switchWs('taslak-kirli', 'taslak-olu');
  await openRoadmap();
  const card = page.locator('[data-roadmap-draft-card]');
  assert.equal(await card.locator('[data-draft-resume]').count(), 1, 'no Sürdür on the dead draft');
  await card.locator('[data-draft-resume]').click();
  await page.waitForTimeout(600);
  const pane = page.locator('[data-roadmap-pane]');
  assert.equal(await pane.count(), 1, 'Sürdür did not raise the draft pane');
  const head = await pane.innerText();
  assert.ok(head.includes('MİMAR — TASLAK'), `identity line: ${head.slice(0, 120)}`);
  // the resumed architect re-proposes: the pending row turns VALID — the card is READY again
  await draftEmit({ kind: 'plan_ready', planText: DRAFT_MD('taslak-olu', 'Ölü Başlık', 'İlk faz') });
  await draftEmit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 300, tokensOut: 80, usd: 0.03 } });
  await page.waitForTimeout(500);
  const t2 = await card.innerText();
  assert.ok(t2.includes('TASLAK HAZIR'), `the resumed proposal did not turn the card ready: ${t2.slice(0, 160)}`);
  assert.equal(await card.getByRole('button', { name: 'Onayla', exact: true }).count(), 1, 'no Onayla on the renewed draft');
  // the spec chain continues on taslak-kirli (the next spec's switchWs FROM assumption)
  await switchWs('taslak-olu', 'taslak-kirli');
  await page.getByRole('button', { name: 'Pano' }).click();
});

await spec('WO-0050 mutlu üretim: boş yüzey ✦ → sürüş → kart iner → Onayla dosyayı yazar, yüzey dolanır', async () => {
  await switchWs('taslak-kirli', 'taslak');
  await openRoadmap();
  const screen = await page.locator('[data-roadmap-screen]').innerText();
  assert.equal(await page.getByRole('button', { name: '✦ Üret / İçe aktar' }).count(), 1, 'not the absent face (no ✦ action)');
  await startDraft('E2E: iki görevli tek fazlı taslak üret.');
  // the live half: the pane in the shared grammar, the WO-less identity, the source readout
  const pane = page.locator('[data-roadmap-pane]');
  assert.equal(await pane.count(), 1, 'no draft pane');
  const head = await pane.innerText();
  assert.ok(head.includes('MİMAR — TASLAK'), `identity line: ${head.slice(0, 120)}`);
  await draftEmit({ kind: 'tool_use', callId: 'w50-1', tool: 'Read', input: { file_path: '/tmp/kaynak.md' } });
  await draftEmit({ kind: 'tool_result', callId: 'w50-1', summary: 'okundu', isError: false });
  await page.waitForTimeout(300);
  await draftEmit({ kind: 'plan_ready', planText: DRAFT_MD('taslak', 'Taslak Başlığı', 'İlk faz') });
  await page.waitForTimeout(700); // onPlanReady → the row read → the card descends
  const card = page.locator('[data-roadmap-draft-card]');
  assert.equal(await card.count(), 1, 'no card after plan_ready');
  const cardText = await card.innerText();
  assert.ok(cardText.includes('1 faz · 1 görev'), `summary figures: ${cardText.slice(0, 200)}`);
  assert.ok(cardText.includes('İlk faz'), `the faz row does not carry the title: ${cardText.slice(0, 300)}`);
  await page.screenshot({ path: join(SHOTS, 'draft-live-card@980.png') });
  await w50Done();
  await page.waitForTimeout(400);
  await card.getByRole('button', { name: 'Onayla', exact: true }).click();
  await page.waitForTimeout(800); // approve → the file write → refreshRoadmap → the ready face
  assert.equal(await page.locator('[data-roadmap-draft-card]').count(), 0, 'the card survived its own approval');
  assert.equal(await page.locator('div[data-faz-id="f0"]').count(), 1, 'the surface did not flip to the ready face');
  const meta = await page.locator('[data-roadmap-head-meta]').innerText();
  assert.ok(meta.includes('0/1 faz tamam'), `head meta after approval: ${meta}`);
  await page.screenshot({ path: join(SHOTS, 'draft-approved@980.png') });
});

await spec('WO-0050 itiraz: kart + İtiraz et → resume notunla döner, yeni öneri satırı günceller', async () => {
  // the ready face's footer ✦ (kare 01's right cluster) starts the round
  await startDraft('E2E: ikinci taslak — itiraz turu.');
  const meta = await page.locator('[data-roadmap-head-meta]').innerText();
  assert.ok(meta.includes('taslak sürüyor'), `the running meta did not replace the counts: ${meta}`);
  await draftEmit({ kind: 'plan_ready', planText: DRAFT_MD('taslak', 'Taslak Başlığı', 'Revize öncesi') });
  await page.waitForTimeout(700);
  const card = page.locator('[data-roadmap-draft-card]');
  assert.ok((await card.innerText()).includes('Revize öncesi'), 'the card did not descend with the round-2 proposal');
  await card.getByRole('button', { name: 'İtiraz et' }).click();
  await page.waitForTimeout(250);
  await card.locator('textarea').fill('bağımlılıkları koru');
  await card.getByRole('button', { name: 'Gönder', exact: true }).click();
  await page.waitForTimeout(600); // the resume re-drives the SAME provider session
  await draftEmit({ kind: 'plan_ready', planText: DRAFT_MD('taslak', 'Taslak Başlığı', 'İtiraz sonrası') });
  await page.waitForTimeout(700);
  assert.ok((await card.innerText()).includes('İtiraz sonrası'), 'the objection round did not rewrite the row');
  await w50Done();
  await page.waitForTimeout(400);
});

await spec('WO-0050 düzenle: yapılandırılmış sahne → başlık düzelir, Bitti satırı yazar', async () => {
  const card = page.locator('[data-roadmap-draft-card]');
  await card.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await page.waitForTimeout(300);
  const edit = page.locator('[data-draft-edit]');
  assert.equal(await edit.count(), 1, 'no edit stage');
  await edit.locator('input').first().fill('Düzenlenmiş faz');
  await page.screenshot({ path: join(SHOTS, 'draft-edit@980.png') });
  await page.getByRole('button', { name: 'Bitti', exact: true }).click();
  await page.waitForTimeout(700); // updateRoadmapDraft → onSaved → the row re-reads
  const text = await page.locator('[data-roadmap-draft-card]').innerText();
  assert.ok(text.includes('Düzenlenmiş faz'), `the edited title did not land: ${text.slice(0, 240)}`);
});

await spec('WO-0050 kalıcılık: reload → kart satırdan döner, pane yok (sürüş renderer ile ölür)', async () => {
  await page.reload();
  await page.waitForTimeout(900);
  await switchWs('e2e', 'taslak'); // the reload resets the renderer state — first workspace first
  await openRoadmap();
  const card = page.locator('[data-roadmap-draft-card]');
  assert.equal(await card.count(), 1, 'the pending row did not re-raise the card after reload');
  assert.ok((await card.innerText()).includes('Düzenlenmiş faz'), 'the row lost the edited md');
  assert.equal(await page.locator('[data-roadmap-pane]').count(), 0, 'a pane resurrected without a live fold');
  await page.screenshot({ path: join(SHOTS, 'draft-after-reload@980.png') });
});

await spec('WO-0050 bütçe: taslak kapıyı görür → ret kartı, pane yok; yükselt → taslak yeniden koşar', async () => {
  await switchWs('taslak', 'taslak-kapi');
  await openRoadmap();
  await startDraft('E2E: kapıdaki taslak.');
  await page.waitForTimeout(600); // refused pre-spawn — no runner, no events to emit
  assert.equal(await page.locator('[data-budget-refusal-card]').count(), 1, 'no refusal card for the draft');
  assert.equal(await page.locator('[data-roadmap-pane]').count(), 0, 'a pane rendered for a refused draft');
  await page.screenshot({ path: join(SHOTS, 'draft-budget-refusal@980.png') });
  await page.getByRole('button', { name: /Limiti yükselt ve sür/ }).click();
  await page.waitForTimeout(900); // setBudget + restart → the draft re-runs (MİMAR — TASLAK returns)
  assert.equal(await page.locator('[data-roadmap-pane]').count(), 1, 'the draft did not re-run after the raise');
  await draftEmit({ kind: 'plan_ready', planText: DRAFT_MD('taslak-kapi', 'Kapı Taslağı', 'Kapı fazı') });
  await page.waitForTimeout(700);
  await w50Done();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-roadmap-draft-card]').count(), 1, 'the raised draft produced no proposal');
  await page.getByRole('button', { name: 'Pano' }).click();
});

// ===== WO-0051 — ✦ belge kaynağı: depo taraması · grup dışla · ek belgeler · serbest keşif · döküm çipi =====
// The 'taslak-depo' world carries a FULL structure root (2 root docs + adr/×2 + notlar/×1 = 5 .md,
// grouped; 3 groups) and an EXTERNAL candidate at the repo root (outside docs/ — the scan never
// sees it). The channel chips and the countline are the dialog's whole affordance; the counts and
// the explore flag ride the drive input to the pane's live line and the card's döküm identity.

await spec('WO-0051 depo taraması: ✦ açılış → depo satırı tek sayı kapalı, keşif ○, sonuç satırı yok', async () => {
  await switchWs('taslak-kapi', 'taslak-depo');
  await openRoadmap();
  await openDraftDialog();
  const storeline = page.locator('[data-draft-storeline]');
  assert.equal(await storeline.count(), 1, 'no store line');
  const text = await storeline.innerText();
  assert.ok(text.includes('docs/ · 5 belge — tümü dahil'), `the rev-3 single-number line: ${text}`);
  assert.equal(await page.locator('[data-draft-docpick]').count(), 0, 'the list rendered while collapsed');
  const explore = page.locator('[data-draft-explore]');
  assert.equal(await explore.getAttribute('aria-pressed'), 'false', 'keşif default ON');
  assert.equal(await page.locator('[data-draft-explore-info]').count(), 0, 'the infoline rendered while OFF');
  await page.screenshot({ path: join(SHOTS, 'draft-depo-open@980.png') });
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).first().click();
});

await spec('WO-0051 grup dışla: adr grubu düşer → 3 / 5; geri al → tümü dahil', async () => {
  await openDraftDialog();
  await page.locator('[data-draft-storeline]').click(); // expand
  await page.waitForTimeout(250);
  const rows = page.locator('[data-draft-docpick] [data-draft-group]');
  assert.equal(await rows.count(), 3, `group rows: ${await rows.count()}`);
  assert.ok((await rows.first().innerText()).includes('docs/'), 'the root group is not first');
  await page.getByRole('button', { name: 'Dışla: docs/adr/' }).click();
  await page.waitForTimeout(200);
  let line = await page.locator('[data-draft-storeline]').innerText();
  assert.ok(line.includes('docs/ · 3 / 5 belge'), `after exclude: ${line}`);
  assert.ok((await page.locator('[data-draft-group="adr"]').getAttribute('data-off')) !== undefined, 'the row did not dim');
  await page.screenshot({ path: join(SHOTS, 'draft-depo-exclude@980.png') });
  await page.getByRole('button', { name: 'Geri al: docs/adr/' }).click();
  await page.waitForTimeout(200);
  line = await page.locator('[data-draft-storeline]').innerText();
  assert.ok(line.includes('docs/ · 5 belge — tümü dahil'), `after restore: ${line}`);
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).first().click();
});

await spec('WO-0051 ek belgeler: sahne pick → adıyla satır; kanal kelimesi yalnız başlıkta; depo sayısı değişmez', async () => {
  await openDraftDialog();
  // stage the native pick's answer (D7): a path OUTSIDE the structure root — the scan's blind spot
  await page.evaluate((p) => window.docket.e2e?.pickFiles([p]), DEPO.external);
  await page.getByRole('button', { name: '+ Belge ekle' }).click();
  await page.waitForTimeout(300);
  const picked = page.locator('[data-draft-picked]');
  assert.equal(await picked.count(), 1, 'no picked section');
  const text = await picked.innerText();
  assert.ok(text.includes('EK BELGELER · 1'), `subhead (CSS-uppercased, said ONCE): ${text}`);
  assert.ok(text.includes('ROADMAP-DIS.md'), `the row speaks by name: ${text}`);
  assert.ok(!text.toLowerCase().includes('dışarıdan'), `the old channel word survived: ${text}`);
  const line = await page.locator('[data-draft-storeline]').innerText();
  assert.ok(line.includes('docs/ · 5 belge — tümü dahil'), `store counts moved: ${line}`);
  await page.screenshot({ path: join(SHOTS, 'draft-depo-external@980.png') });
  await picked.getByRole('button', { name: /Belgeyi çıkar/ }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-draft-picked]').count(), 0, 'the picked row survived its own remove');
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).first().click();
});

await spec('WO-0051 keşif çipi: aç → tek sonuç satırı; kapat → satır ölür', async () => {
  await openDraftDialog();
  const explore = page.locator('[data-draft-explore]');
  await explore.click();
  await page.waitForTimeout(200);
  assert.equal(await explore.getAttribute('aria-pressed'), 'true', 'the chip did not press');
  const info = page.locator('[data-draft-explore-info]');
  assert.equal(await info.count(), 1, 'no consequence line');
  assert.ok((await info.innerText()).includes('token harcar'), `the line does not state the cost: ${await info.innerText()}`);
  await page.screenshot({ path: join(SHOTS, 'draft-depo-explore@980.png') });
  await explore.click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-draft-explore-info]').count(), 0, 'the line survived the toggle-off');
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).first().click();
});

await spec('WO-0051 default-tümü gider: dokunmadan başlat → pane kaynak satırı 5 belge; kart iner', async () => {
  await openDraftDialog();
  await page.locator('#roadmap-draft-note').fill('E2E: depo taramasından taslak.');
  await page.getByRole('button', { name: /Taslağı başlat/ }).click();
  await page.waitForTimeout(500);
  const pane = page.locator('[data-roadmap-pane]');
  assert.equal(await pane.count(), 1, 'no draft pane');
  // textContent (not innerText): the line is CSS-uppercased — assert the raw bundle copy
  const sourceRaw = await page.locator('[data-draft-source]').textContent().catch(() => null);
  const paneHtml = await pane.innerHTML().catch(() => '');
  assert.ok(sourceRaw !== null && sourceRaw.includes('kaynak: 5 belge'), `the pane source line lost the composition (raw=${sourceRaw}, head=${paneHtml.slice(0, 400)})`);
  await draftEmit({ kind: 'tool_use', callId: 'w51-1', tool: 'Read', input: { file_path: 'docs/faz-0-altyapi.md' } });
  await draftEmit({ kind: 'tool_result', callId: 'w51-1', summary: 'okundu', isError: false });
  await page.waitForTimeout(300);
  await draftEmit({ kind: 'plan_ready', planText: DRAFT_MD('taslak-depo', 'Depo Taslağı', 'Depo fazı') });
  await page.waitForTimeout(700);
  const card = page.locator('[data-roadmap-draft-card]');
  assert.equal(await card.count(), 1, 'no card after plan_ready');
  await page.screenshot({ path: join(SHOTS, 'draft-depo-card@980.png') });
});

await spec('WO-0051 döküm çipi (TD-057): kart başı açar → kim satırı + kaynak + arşiv döküm; kapatır', async () => {
  const card = page.locator('[data-roadmap-draft-card]');
  await card.getByRole('button', { name: /Dökümü aç/ }).click();
  await page.waitForTimeout(300);
  const log = page.locator('[data-draft-log]');
  assert.equal(await log.count(), 1, 'the chip opened nothing');
  const logText = await log.innerText();
  assert.ok(logText.includes('MİMAR — TASLAK'), `identity: ${logText.slice(0, 160)}`);
  assert.ok(logText.includes('kaynak: 5 belge'), `the counts did not survive the drive: ${logText.slice(0, 200)}`);
  assert.ok(logText.includes('faz-0-altyapi.md'), `the archived transcript lost the tool line: ${logText.slice(0, 300)}`);
  await page.screenshot({ path: join(SHOTS, 'draft-depo-log@980.png') });
  await card.getByRole('button', { name: /Dökümü kapat/ }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-draft-log]').count(), 0, 'the log survived its own close');
  await w50Done();
  await page.waitForTimeout(400);
});

await spec('WO-0051 döküm çipi eski satırda dürüst düşer: kirli kart açar, kaynak parçası yok', async () => {
  await switchWs('taslak-depo', 'taslak-kirli');
  await openRoadmap();
  const card = page.locator('[data-roadmap-draft-card]');
  assert.equal(await card.count(), 1, 'the seeded kirli row raised no card');
  await card.getByRole('button', { name: /Dökümü aç/ }).click();
  await page.waitForTimeout(300);
  const log = page.locator('[data-draft-log]');
  assert.equal(await log.count(), 1, 'a pre-WO-0051 session row opens nothing');
  const logText = await log.innerText();
  assert.ok(logText.includes('MİMAR — TASLAK'), `identity: ${logText.slice(0, 160)}`);
  assert.ok(logText.includes('çit koymayı unuttum'), `the archived transcript: ${logText.slice(0, 300)}`);
  assert.ok(!logText.includes('kaynak:'), `a summary-less row invented a source line: ${logText.slice(0, 200)}`);
  await card.getByRole('button', { name: /Dökümü kapat/ }).click();
  await page.getByRole('button', { name: 'Pano' }).click();
});

await spec('WO-0051 düz kök (review f6): dosya satırları kaplı + tümü-dahil kuyruğu', async () => {
  await switchWs('taslak-kirli', 'taslak-duz');
  await openRoadmap();
  await openDraftDialog();
  const line = await page.locator('[data-draft-storeline]').innerText();
  assert.ok(line.includes('docs/ · 10 belge — tümü dahil'), `flat store line: ${line}`);
  await page.locator('[data-draft-storeline]').click(); // expand
  await page.waitForTimeout(250);
  const fileRows = page.locator('[data-draft-docpick] [data-draft-file]');
  assert.equal(await fileRows.count(), 8, `the flat cap: ${await fileRows.count()}`);
  assert.equal(await page.locator('[data-draft-group]').count(), 0, 'group rows on a flat root');
  const pick = await page.locator('[data-draft-docpick]').innerText();
  assert.ok(pick.includes('+2 belge — tümü dahil'), `the moreline tail: ${pick.slice(-80)}`);
  await page.screenshot({ path: join(SHOTS, 'draft-duz-flat@980.png') });
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pano' }).click();
});

// ===== WO-0053 — the limit screen (mockup frames 01–04; static past/future stamps, no clock seam) =====
const HOUR = 3600_000;
const futureStamp = () => new Date(Date.now() + HOUR).toISOString();
const pastStamp = () => new Date(Date.now() - 60_000).toISOString();
const limitDeath = (resetAt) => window.docket.e2e?.emit({
  kind: 'error',
  message: 'Usage limit reached',
  code: 'rate_limited',
  limit: { resetAt, window: 'five_hour' },
});

await spec('WO-0053 limit 01: the informative card, the locked Sürdür, the LIVE crossing — then the unlock and the resume', async () => {
  await switchWs('taslak-duz', 'e2e'); // the WO-0051 specs left the board on the draft workspace
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  // a SHORT future stamp — the spec WATCHES the real 1s tick cross it (the widened ticker's own pin)
  await page.evaluate(limitDeath, new Date(Date.now() + 8_000).toISOString());
  await page.waitForTimeout(600);
  // Frame 01 state A (round-2 presentation): the card is INFORMATIVE — window + clock body, no action row
  assert.equal(await page.locator('[data-limit-card]').count(), 1, 'no limit card');
  assert.ok((await page.locator('[data-limit-card]').getByText('KULLANIM LİMİTİ DOLDU').count()) >= 1, 'no card title');
  assert.ok((await page.locator('[data-limit-card]').getByText('5 saatlik pencere').count()) >= 1, 'the raw kind leaked or the window label is missing');
  assert.equal(await page.locator('[data-limit-card]').getByRole('button').count(), 0, 'the card carries a button (round 2: it must not)');
  // the ONE Sürdür stays in its normal home, LOCKED while the limit holds (attribute-free, the kit form)
  const loneResume = page.locator('button', { hasText: 'Sürdür' }).first();
  assert.ok((await loneResume.count()) >= 1, 'the lone Sürdür vanished');
  assert.ok((await loneResume.getAttribute('class') ?? '').includes('pointer-events-none'), 'the lone Sürdür is not locked while the limit holds');
  // the fail card stands down, the budget card never appears, the instrument suppresses (karar 5)
  assert.equal(await page.getByText('Oturum çöktü').count(), 0, 'the fail card rendered beside the limit card');
  assert.equal(await page.locator('[data-budget-refusal-card]').count(), 0, 'a limit death rendered the BUDGET card');
  assert.equal(await page.locator('#live-pane').count(), 0, 'the instrument rendered under the limit card');
  await page.screenshot({ path: join(SHOTS, 'limit-card-wait@980.png') }); // WO-0053 frame 01 state A (the operator's tour artifact)
  // THE CROSSING, live: wait out the short stamp — the card unmounts, the Sürdür unlocks, ⏎ returns
  await page.waitForTimeout(9_000);
  assert.equal(await page.locator('[data-limit-card]').count(), 0, 'the card survived its own crossing');
  assert.ok(!(await loneResume.getAttribute('class') ?? '').includes('pointer-events-none'), 'the Sürdür stayed locked after the crossing');
  assert.ok((await page.locator('button', { hasText: 'Sürdür' }).count()) === 1, 'more than one Sürdür after the crossing');
  await page.screenshot({ path: join(SHOTS, 'limit-card-ready@980.png') }); // frame 01 state B (card gone, the button back)
  await loneResume.click();
  await page.waitForTimeout(700);
  assert.ok((await page.getByText('Çalışıyor', { exact: true }).count()) >= 1, 'the resumed drive is not running');
  assert.equal(await page.locator('[data-limit-card]').count(), 0, 'a card came back after the resume');
  // wind down cleanly for the next spec (a stopped row never re-seeds the limit — the boundary)
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(700);
  await backToBoard();
});

await spec('WO-0053 limit 03 (frame 02 + 04): the warn line on the provider own signal only, then the stamp-less degrade tier', async () => {
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  // no signal → NOTHING (never a locally invented threshold)
  assert.equal(await page.locator('[data-limit-warn]').count(), 0, 'the warn line rendered without a signal');
  const warnStamp = futureStamp();
  await page.evaluate((resetAt) => window.docket.e2e?.emit({
    kind: 'limit_windows',
    windows: [{ window: 'five_hour', utilization: 86, resetAt }],
    status: 'warning',
  }), warnStamp);
  await page.waitForTimeout(400);
  const warn = page.locator('[data-limit-warn]');
  assert.equal(await warn.count(), 1, 'no warn line on the provider signal');
  const warnText = (await warn.textContent()) ?? '';
  assert.ok(warnText.includes('5 saatlik pencere'), `the warn line lost the window label: ${warnText}`);
  assert.ok(warnText.includes('%86'), `the warn line lost the utilization: ${warnText}`);
  // end the drive CLEANLY — the running gate drops the line with the drive, and the clean leg
  // clears any row stamp (the honest end for the family's middle spec)
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-limit-warn]').count(), 0, 'the warn line survived the clean end (the running gate)');
  // Frame 04 (the degradation tier): a stamp-LESS limit death → the FAIL card with the localized
  // title, the retry button — never a card promising a clock it does not have
  await page.getByRole('button', { name: /Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'error', message: 'Usage limit reached', code: 'rate_limited' }));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-limit-card]').count(), 0, 'a stamp-less death rendered the CARD');
  assert.ok((await page.getByText('Sağlayıcı kullanım limiti doldu — sıfırlanma saati bilinmiyor.').count()) >= 1, 'no localized degrade title');
  assert.ok((await page.getByRole('button', { name: 'Yeniden dene', exact: true }).count()) >= 1, 'no retry on the degrade tier');
  await backToBoard();
});

await spec('WO-0053 limit 04 (frame 03): the restart re-derivation — the card comes back from the ROW stamp', async () => {
  await openDetail('Yeni iş emri örneği');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  // a SHORT stamp: this row's leftover must CROSS before the WO-0060 chip block runs at the
  // suite's tail — a +1h leftover would hold the chip red through every later spec (found live).
  await page.evaluate(limitDeath, new Date(Date.now() + 8_000).toISOString());
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-limit-card]').count(), 1, 'the card did not render at the death');
  // navigate away and back — the fold is dead, the ROW carries limit_reset_at, the seed re-derives
  await backToBoard();
  // the BOARD card carries the standing line too (round 2: a limit surface outside the detail)
  const boardCard = page.locator('[data-wo-id]', { hasText: 'Yeni iş emri örneği' }).first();
  assert.ok((await boardCard.getByText(/Kullanım limiti doldu/).count()) >= 1, 'the board card carries no limit line');
  await openDetail('Yeni iş emri örneği');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-limit-card]').count(), 1, 'the card did not re-derive from the row');
  await backToBoard();
});

// ===== WO-0054 — kullanım ekranı: dolu yüz, boş yüz, canlı kota (iki kol), drive-sonu tazeleme =====
// The kullanim world's figures (locale tr): the HEAD basis (session cost_usd over started_at) is
// $17,78 — warn at the $16 line — while the LEDGER's own `at`-windowed total is $18,74: the two
// bases disagree and the head NARRATES it, never reconciles (F1). The architect's multi-model row
// reports lines that do not sum to its usd_delta — the models-split note lives on that state (F2).
const usageLine = seedOut.trim().split('\n').find((l) => l.startsWith('USAGE='));
if (!usageLine) throw new Error('seed failed: no USAGE= line');
const openUsage = async () => {
  // exact: the board's WO cards ('Kullanım uygulaması'…) substring-match otherwise — the
  // Segmented's own label is the whole accessible name
  await page.getByRole('button', { name: 'Kullanım', exact: true }).first().click();
  await page.waitForTimeout(600); // the read-once-per-entry refresh
};
const openBoard = async () => {
  // the surface SURVIVES workspace swaps; a detail also outranks it in the main chain — the
  // board is the only place a WO card is clickable, so the drive specs return here explicitly
  await page.getByRole('button', { name: 'Pano' }).first().click();
  await page.waitForTimeout(400);
};

await spec('WO-0054 dolu yüz: ay başlığı (uyarı + çubuk), sapma satırı, rol/model/cache dökümü, WO+✦ listesi, bağlam okuması, deftersiz niteleyici', async () => {
  await switchWs('e2e', 'kullanim');
  await openUsage();
  const screen = await page.locator('[data-usage-screen]').innerText();
  // the head: the EXISTING budget view — readout + the warn line + a real bar fill; NO re-derivation
  assert.ok(screen.includes('bu ay $17,78 / $20,00'), `head readout: ${screen.slice(0, 300)}`);
  assert.ok(screen.includes('uyarı eşiği aşıldı'), `no warn line: ${screen.slice(0, 300)}`);
  const fill = await page.locator('[data-usage-screen] .hairline-progress > div').first().getAttribute('style');
  assert.ok(fill !== null && /width:\s*89%/.test(fill), `the bar has no fill: ${fill}`);
  // F1: the divergence line — the head keys on started_at, the ledger on each row's `at`
  assert.equal(await page.locator('[data-usage-divergence]').count(), 1, 'no divergence line on disagreeing bases');
  // the breakdown: roles, models verbatim (row DATA), the unknown bucket, cache, the split note
  assert.ok(screen.includes('Uygulayıcı') && screen.includes('$15,17 · %81'), `role row: ${screen.slice(0, 500)}`);
  assert.ok(screen.includes('glm-5.3') && screen.includes('glm-5.3-flash'), 'model ids did not render verbatim');
  assert.ok(screen.includes('bilinmeyen model'), 'no unknown bucket');
  assert.ok(screen.includes('taze giriş 650k · cache okuma 1.4M · cache yazma 310k'), `cache line: ${screen.slice(0, 700)}`);
  assert.equal(await page.locator('[data-usage-models-note]').count(), 1, 'no models-split note on the non-summing split');
  assert.ok(screen.includes('$18,74 · 650k→94k'), `total row: ${screen.slice(0, 900)}`);
  // the spend list: WO rows usd-desc + the ✦ draft row INSIDE the list; the zero-spend WO absent
  assert.ok(screen.includes('Kullanım uygulaması') && screen.includes('$15,17 · 2 oturum'), `wo rows: ${screen.slice(0, 1200)}`);
  assert.ok(screen.includes('Yol haritası taslakları') && screen.includes('$1,41 · 1 oturum'), 'no ✦ draft row');
  assert.ok(!screen.includes('Kullanım boş işi'), 'the zero-spend WO leaked into the list');
  // the sessions: the ctx reading + the OBSERVED-result count (never num_turns)
  assert.ok(screen.includes('bağlam %62 · 124k/200k'), 'no ctx readout');
  assert.ok(screen.includes('1 sonuç'), 'no observed-result count');
  // honesty: the detail-less vintage names itself — in USER language, never internal WO jargon
  assert.ok(screen.includes('ayrıntı kaydı yok'), 'no unledgered qualifier');
  assert.ok(!screen.includes('WO-0052') && !screen.includes('per-turn'), 'internal jargon leaked to the screen');
  await page.screenshot({ path: join(SHOTS, 'usage-full@980.png') });
  await backToBoard();
});

await spec('WO-0054 boş yüz: davet satırı, hiç rakam yok, kota bölümü sinyalsiz çizilmez', async () => {
  await switchWs('kullanim', 'bos');
  await openUsage();
  const screen = await page.locator('[data-usage-screen]').innerText();
  assert.ok(screen.includes('Bu ay henüz kayıt yok'), `not the invitation: ${screen.slice(0, 200)}`);
  assert.equal(await page.locator('[data-usage-limit]').count(), 0, 'the quota panel rendered without a drive');
  assert.ok(!/\$\s?\d+[.,]\d{2}/.test(screen), `a formatted amount leaked onto the empty face: ${screen}`);
});

await spec('WO-0054 canlı kota: sinyalsiz yok → sağlayıcı sinyali panel → drive sonu iner; yabancı sürüş boyamaz; ✦ taslak kolu; uyum\'da sapma yok', async () => {
  // the F1 negative control first: a budgeted NON-divergent workspace renders the head WITHOUT the line
  await switchWs('bos', 'uyum');
  await openUsage();
  const uyumScreen = await page.locator('[data-usage-screen]').innerText();
  assert.ok(uyumScreen.includes('bu ay $0,50 / $20,00'), `uyum head readout: ${uyumScreen.slice(0, 300)}`);
  assert.equal(await page.locator('[data-usage-divergence]').count(), 0, 'the divergence line fired on agreeing bases');
  // a real plan drive on uyum's WO; the usage surface shows NO panel without the provider signal
  await openBoard();
  await openDetail('Kullanım uyum işi');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  await backToBoard();
  await openUsage();
  assert.equal(await page.locator('[data-usage-limit]').count(), 0, 'the panel rendered without a provider signal');
  // the provider's OWN signal → the panel: window label + utilization + the reset line
  await page.evaluate((resetAt) => window.docket.e2e?.emit({ kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 62, resetAt }], status: 'warning' }), futureStamp());
  await page.waitForTimeout(400);
  const panel = await page.locator('[data-usage-limit]').innerText();
  assert.ok(panel.includes('5 saatlik pencere'), `no window label: ${panel}`);
  assert.ok(panel.includes('%62'), `no utilization: ${panel}`);
  assert.ok(/sıfırlanır/.test(panel), `no reset line: ${panel}`);
  // karar 4: ANOTHER workspace's drive does not paint this screen (uyum's drive is still live)
  await switchWs('uyum', 'taslak');
  await openUsage();
  assert.equal(await page.locator('[data-usage-limit]').count(), 0, 'a foreign drive painted this screen');
  // wind the uyum drive down BEFORE the draft can start (the one-drive-at-a-time rule)
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 100, tokensOut: 10, usd: 0.05 } }));
  await page.waitForTimeout(700);
  // the ✦ DRAFT arm: the same workspace's draft drive paints it (the ${wsId}:draft arm) —
  // taslak's ledger is EMPTY, so this also pins the panel above the empty face
  await openRoadmap();
  await startDraft('E2E: draft arm — sağlayıcı sinyali taslak sürüşünden okunur.');
  await openUsage();
  assert.equal(await page.locator('[data-usage-limit]').count(), 0, 'draft arm: no signal, no panel');
  await draftEmit({ kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 41, resetAt: futureStamp() }], status: 'ok' });
  await page.waitForTimeout(400);
  const dpanel = await page.locator('[data-usage-limit]').innerText();
  assert.ok(dpanel.includes('✦ taslak sürüşü'), `the draft meta is missing: ${dpanel}`);
  assert.ok(dpanel.includes('5 saatlik pencere') && dpanel.includes('%41'), `draft panel: ${dpanel}`);
  await draftEmit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1200, tokensOut: 300, usd: 0.12 } });
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-usage-limit]').count(), 0, 'the draft panel survived the drive end');
  await stopAllDrives();
});

await spec('WO-0054 drive-sonu tazeleme: ekran açıkken satır iner — rakam TUTAR (dört-kanca kuralı); sürüş biter — rakam OYNAR (onEnd pini)', async () => {
  await switchWs('taslak', 'kullanim');
  await openUsage();
  const before = await page.locator('[data-usage-screen]').innerText();
  assert.ok(before.includes('$18,74'), `pre-drive total missing: ${before.slice(0, 400)}`);
  // start a plan drive on the kullanim WO, then come BACK to the usage surface: the re-entry's
  // read is the pre-row baseline ($18,74 — the drive has landed nothing yet)
  await openBoard();
  await openDetail('Kullanım uygulaması');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  await backToBoard();
  await openUsage();
  const baseline = await page.locator('[data-usage-screen]').innerText();
  assert.ok(baseline.includes('$18,74'), `baseline total missing: ${baseline.slice(0, 400)}`);
  // a mid-drive turn_usage lands a LEDGER row but fires NO hook — and the screen stays OPEN, so
  // the four hooks are the whole cadence: the store notifies (a re-render), the figure holds
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_usage', delta: { tokensIn: 5000, tokensOut: 500, usd: 0.33 } }));
  await page.waitForTimeout(600);
  const mid = await page.locator('[data-usage-screen]').innerText();
  assert.ok(mid.includes('$18,74'), 'the figure moved before any hook fired');
  assert.ok(!mid.includes('$19,07'), 'the mid-drive row leaked into the figure');
  // the drive ENDS → onEnd → refreshUsage → the landed row becomes visible
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1000, tokensOut: 100, usd: 0.33 } }));
  await page.waitForTimeout(800);
  const after = await page.locator('[data-usage-screen]').innerText();
  assert.ok(after.includes('$19,07'), `the figure did not move at onEnd: ${after.slice(0, 500)}`);
  await page.screenshot({ path: join(SHOTS, 'usage-drive-refresh@980.png') });
  await stopAllDrives();
  await openBoard();
});

// ===== WO-0055 — live agent visibility: the composite delegation block, the running count, the
// honest orphans, the archived re-nesting =====

await spec('WO-0055 rev 2: the identity agent block + the live strip name the running agents', async () => {
  await stopAllDrives(); // one drive at a time — stage on a FRESH work order
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Ajan görünür denemesi');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  const emit = (ev) => page.evaluate((e) => window.docket.e2e?.emit(e), ev);
  // the delegation call alone says the VERB; the task start promotes the line to the COUNT
  await emit({ kind: 'tool_use', callId: 'cT', tool: 'Agent', input: { description: 'Dosyaları tara' } });
  await page.waitForTimeout(300);
  let header = (await page.locator('#live-pane').first().textContent()) ?? '';
  assert.ok(header.includes('Devrediyor'), `the delegation call lost its verb: ${header.slice(0, 300)}`);
  await emit({ kind: 'agent_task', phase: 'started', taskId: 't-1', callId: 'cT', description: 'Dosyaları tara', subagentType: 'general-purpose', at: new Date().toISOString() });
  await emit({ kind: 'tool_use', callId: 'cN1', tool: 'Bash', input: { command: 'ls' }, parentToolUseId: 'cT' });
  await page.waitForTimeout(400);
  header = (await page.locator('#live-pane').first().textContent()) ?? '';
  assert.ok(header.includes('1 ajan sürüyor'), `the activity line carries no running-agent count: ${header.slice(0, 300)}`);
  // rev 2 — the LIVE STRIP (chip CLOSED): one row per running agent, the task's own words + elapsed
  const strip = page.locator('[data-agent-strip]');
  assert.equal(await strip.count(), 1, 'no live agent strip while an agent runs');
  assert.ok(((await strip.textContent()) ?? '').includes('Dosyaları tara'), 'the strip does not name the running agent');
  // behind the chip: the IDENTITY block — ◈ Ajan head (type word in the data voice) + the
  // running status; the task's own sentence visible WITHOUT clicking; the nested row inside
  await page.locator('[data-pane-log-toggle]').first().click();
  await page.waitForTimeout(300);
  const chat = page.locator('[data-chat]').first();
  const block = chat.locator('[data-chat-entry="agent_block"]').first();
  assert.equal(await block.count(), 1, 'no agent identity block behind the chip');
  const head = (await block.textContent()) ?? '';
  assert.ok(head.includes('Ajan') && head.includes('koşuyor'), `the block head lost its identity/status: ${head.slice(0, 200)}`);
  assert.ok(head.includes('general-purpose'), 'the type word is missing from the head');
  assert.ok(head.includes('Dosyaları tara'), 'the task sentence is not visible on the block');
  assert.ok(((await block.textContent()) ?? '').includes('Komut çalıştır'), 'the subagent row is not nested inside the block');
  assert.ok((await block.locator('.lamp-run').count()) >= 1, 'no running lamp on the open agent task');
  // the nested call CLOSES first (still under the running count), then the task ENDS: the lamp
  // dies, the strip disappears, the closing line carries the status + digest, the line reverts
  await emit({ kind: 'tool_result', callId: 'cN1', summary: 'docs src package.json', isError: false, parentToolUseId: 'cT' });
  await page.waitForTimeout(300);
  header = (await page.locator('#live-pane').first().textContent()) ?? '';
  assert.ok(header.includes('1 ajan sürüyor'), 'the count dropped while the agent was still open');
  await emit({ kind: 'agent_task', phase: 'ended', taskId: 't-1', status: 'completed', summary: 'Dört dosya buldum' });
  await page.waitForTimeout(400);
  header = (await page.locator('#live-pane').first().textContent()) ?? '';
  assert.ok(!header.includes('ajan sürüyor'), 'the count survived the last end');
  assert.ok(header.includes('Devrediyor'), 'the line did not revert to the unmatched delegation verb');
  assert.equal(await strip.count(), 0, 'the strip survived the last end');
  assert.equal(await block.locator('.lamp-run').count(), 0, 'the lamp stayed on after the end');
  const headText = (await block.textContent()) ?? '';
  assert.ok(headText.includes('bitti'), 'the head did not flip to the end status word');
  assert.equal(await block.locator('[data-chat-entry="agent_digest"]').count(), 1, 'no closing digest line after the end');
  assert.ok(((await block.locator('[data-chat-entry="agent_digest"]').textContent()) ?? '').includes('Dört dosya buldum'), 'the digest lost the provider summary');
  assert.equal(await block.locator('[data-chat-entry="agent_children"]').count(), 0, 'children stayed visible after the end');
  await block.locator('button').first().click();
  await page.waitForTimeout(300);
  assert.equal(await block.locator('[data-chat-entry="agent_children"]').count(), 1, 'the opened block did not reveal the nested rows');
  await page.screenshot({ path: join(SHOTS, 'agent-block@980.png') });
  await stopAllDrives();
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('Evet, sil').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Ajan görünür' }).count(), 0, 'the throwaway WO survived');
});

await spec('WO-0055: depth-2 nesting and the honest orphan ends', async () => {
  await stopAllDrives();
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Ajan derinlik denemesi');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  const emit = (ev) => page.evaluate((e) => window.docket.e2e?.emit(e), ev);
  await page.locator('[data-pane-log-toggle]').first().click();
  await page.waitForTimeout(300);
  const chat = page.locator('[data-chat]').first();
  // an inner delegation INSIDE the outer block's children (the subagent delegates further)
  await emit({ kind: 'tool_use', callId: 'd1', tool: 'Agent', input: { description: 'Dış görev' } });
  await emit({ kind: 'agent_task', phase: 'started', taskId: 'td1', callId: 'd1', description: 'Dış görev' });
  await emit({ kind: 'tool_use', callId: 'd2', tool: 'Agent', input: { description: 'İç görev' }, parentToolUseId: 'd1' });
  await emit({ kind: 'agent_task', phase: 'started', taskId: 'td2', callId: 'd2', description: 'İç görev' });
  await page.waitForTimeout(400);
  const outer = chat.locator('[data-chat-entry="agent_block"]', { hasText: 'Dış görev' }).first();
  assert.equal(await outer.count(), 1, 'the outer block is missing');
  const inner = outer.locator('[data-chat-entry="agent_block"]', { hasText: 'İç görev' }).first();
  assert.equal(await inner.count(), 1, 'the inner delegation did not nest inside the outer block');
  // (the beheaded END is a RENDER-level case: live, the FOLD drops an end with no open task —
  // pinned in agent-task.test.ts. The renderer's honest orphan row is asserted in the archived
  // spec below, where the seed writes the transcript directly.)
  await page.screenshot({ path: join(SHOTS, 'agent-depth@980.png') });
  await stopAllDrives();
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('Evet, sil').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Ajan derinlik' }).count(), 0, 'the throwaway WO survived');
});

await spec('WO-0055: the archived card re-nests identically (seeded agent rows)', async () => {
  await switchWs('kullanim', 'e2e'); // the usage block left the app on 'kullanim'; the seed's WO lives in 'e2e'
  await openDetail('Ajan arşivi');
  await page.waitForTimeout(450);
  const card = page.locator('[data-session-card]').filter({ hasText: 'Adım 1' }).first();
  assert.equal(await card.count(), 1, 'the seeded agent session card is missing');
  await card.locator('button').first().click(); // the card head IS the aç/kapa (the ledger has no chip)
  await page.waitForTimeout(400);
  const chat = card.locator('[data-chat]').first();
  const block = chat.locator('[data-chat-entry="agent_block"]').first();
  assert.equal(await block.count(), 1, 'the archived transcript did not re-nest the agent block');
  const head = (await block.textContent()) ?? '';
  assert.ok(head.includes('Ajan') && head.includes('bitti'), `the archived head lost its identity/status: ${head.slice(0, 200)}`);
  assert.ok(head.includes('Dosyaları tara'), 'the task sentence is not visible on the archived block');
  assert.equal(await block.locator('[data-chat-entry="agent_digest"]').count(), 1, 'the archived block lost its closing digest');
  // the task ENDED in the seed → the children hide behind the head's click (nothing opens itself)
  await block.locator('button').first().click();
  await page.waitForTimeout(300);
  assert.ok(((await block.textContent()) ?? '').includes('Komut çalıştır'), 'the nested subagent row did not survive the archive');
  // the REAL report won the pair over the end digest — the click-open body
  assert.ok(((await block.textContent()) ?? '').includes('Alt ajan raporu'), 'the report did not win the pair');
  assert.ok(((await block.textContent()) ?? '').includes('ls'), 'the nested command detail is missing');
  // the beheaded end's ONE honest self-describing row (word + digest)
  const chatText = (await chat.textContent()) ?? '';
  assert.ok(chatText.includes('ajan sonu') && chatText.includes('Yetim özet'), 'the beheaded end lost its one honest row');
  await page.screenshot({ path: join(SHOTS, 'agent-archived@980.png') });
  await backToBoard();
});

// ===== WO-0059 rev 4 — the from-scratch settings: a LEFT MENU (Modeller · Genel), per-role tier
// segments that write INSTANTLY, the provider's presence line (the stored key retired) =====
await spec('WO-0059 rev 4 ayarlar: sol menü üç öğe (WO-0070 İstem şablonları eklendi), rol kademe segmentleri (anlık yazım + kalıcılık), varlık satırı, sürüşte taşınır', async () => {
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(450);
  const dlg = page.locator('[role="dialog"]');
  // the menu: exactly FOUR bare items (WO-0070 added İstem şablonları, WO-0098 Sürücüler) — still
  // no provider section, no workspace section anywhere
  assert.equal(await dlg.locator('[data-settings-item]').count(), 4, 'the menu does not carry exactly four items');
  assert.equal(await dlg.locator('[data-model-section]').count(), 1, 'the model section is missing');
  assert.equal(await dlg.locator('[data-general-section]').count(), 0, 'the general section leaked into the models pane');
  assert.ok(((await dlg.locator('[data-model-section]').innerText()) ?? '').includes('Mimar'), 'the role rows are missing');
  // the tier segments: Default + the adapter's worst→best tiers; a click WRITES THROUGH (no Kaydet)
  const mimarRow = dlg.locator('[data-model-rows] > div', { hasText: 'Mimar' });
  await mimarRow.getByRole('button', { name: 'opus', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.docket.settings.getModels()))?.architect, 'opus', 'the Mimar tier did not write through');
  assert.equal(await mimarRow.locator('button[aria-pressed="true"]').textContent(), 'opus', 'the segment did not read pressed');
  await page.screenshot({ path: join(SHOTS, 'settings-menu@980.png') });
  // Genel: the presence line (name + the two-state word) + the permission rule + language + theme
  await dlg.locator('[data-settings-item]', { hasText: 'Genel' }).click();
  await page.waitForTimeout(300);
  assert.equal(await dlg.locator('[data-general-section]').count(), 1, 'the general section did not open');
  assert.equal(await dlg.locator('[data-provider-line]').count(), 1, 'the presence line is missing');
  // the mount check is a REAL spawn-free handshake — the machine may make it slower than one
  // waitForTimeout: poll until a RESULT word replaces the spinner (the two-state word is for
  // results only; a bare «Claude Code · Doğrula» line is the still-verifying shape)
  let line = '';
  for (let i = 0; i < 40; i++) {
    line = ((await dlg.locator('[data-provider-line]').innerText()) ?? '').trim();
    if (/Hazır|Bulunamadı/.test(line)) break;
    await page.waitForTimeout(250);
  }
  assert.ok(/Hazır|Bulunamadı/.test(line), `the presence line lost its two-state word: ${line}`);
  assert.ok((await dlg.getByText('Riskli hariç').count()) >= 1, 'the permission rule is not in Genel');
  await page.screenshot({ path: join(SHOTS, 'settings-general@980.png') });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
  // the tier survives the dialog (the ROW, not renderer state) — and the drive carries it: a FRESH
  // WO, the plan drive's role is ARCHITECT → the architect row rides (the per-role mapping's pin).
  await stopAllDrives(); // the one-drive-at-a-time rule: no lingering drive may hold the start
  await openDetail('Ajan arşivi');
  await stopAllDrives(); // a drive on an unopened detail shows no Durdur at board level — stop it there
  await backToBoard();
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Model kanıt');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  let carriedModel;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    carriedModel = await page.evaluate(() => window.docket.e2e?.lastDriveInput());
    if (carriedModel?.model === 'opus') break;
  }
  assert.equal(carriedModel?.model, 'opus', `the resolved drive input does not carry the architect tier: ${JSON.stringify(carriedModel)}`);
  assert.equal(carriedModel?.role, 'architect', 'the carry spec did not run an architect drive');
  await stopAllDrives();
  // cleanup: Default clears the architect row (an instant write, no Kaldır button exists)
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(450);
  await dlg.locator('[data-model-rows] > div', { hasText: 'Mimar' }).getByRole('button', { name: 'Default', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.docket.settings.getModels()), undefined, 'Default did not clear the row');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
});

await spec('WO-0059 rev 4: kök + bütçe grupları ws Düzenle dialogunda — genel ayarlardan taşındı', async () => {
  await openWsEdit();
  const dlg = page.locator('[role="dialog"]');
  assert.equal(await dlg.locator('[data-ws-knobs]').count(), 1, 'the moved knob group is not in the ws edit dialog');
  assert.ok((await dlg.locator('[data-budget-section]').count()) === 1, 'the budget group is missing');
  assert.ok((await dlg.locator('[data-docs-root-section]').count()) === 1, 'the docs-root group is missing');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
});

// ===== WO-0060 — the appbar drive/limit chip: the account's health in one glance =====
// The chip is ACCOUNT-wide and reads PERSISTED rows, so every earlier spec's leftovers speak here —
// the block runs LAST and ends on a clean world: limit-04's stamp is deliberately SHORT (+8s) —
// it crosses while the later suites run, so the chip block opens on a CLEAN world (a +1h leftover
// would hold the chip red through every later spec; found live). The rows-only pin rides chip 06's
// reload. One chip,
// one element: [data-appbar-drive][data-tier="limit|warn|running"].
const chip = page.locator('[data-appbar-drive]');
const chipTier = async () => (await chip.getAttribute('data-tier'));

await spec('WO-0060 çip 02: sürüş YEŞİL sayaç — 1 sürüyor; Durdur iner', async () => {
  // the rev-4 settings spec leaves the app on this WO's DETAIL — one ESC lands back on the board
  await backToBoard();
  await openDetail('Model kanıt');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  assert.equal(await chip.count(), 1, 'a running drive lit no chip');
  assert.equal(await chipTier(), 'running', 'the running drive is not the green tier');
  assert.ok(((await chip.textContent()) ?? '').includes('1'), 'the green chip lost its count copy');
  await page.screenshot({ path: join(SHOTS, 'appbar-chip-running@980.png') });
  const durdur = page.getByRole('button', { name: 'Durdur', exact: true });
  if ((await durdur.count()) === 0) {
    await page.screenshot({ path: join(SHOTS, 'chip02-debug@980.png') });
    console.log('CHIP02 DEBUG:', ((await page.locator('main').innerText()) ?? '').slice(0, 700).replace(/\n+/g, ' | '));
  }
  await durdur.first().click();
  await page.waitForTimeout(700);
  assert.equal(await chip.count(), 1, 'the LED vanished (WO-0085: always present)');
  assert.equal(await chipTier(), 'idle', 'Durdur did not rest the chip at idle');
  await backToBoard();
});

await spec('WO-0060 çip 03: sağlayıcının warning\'i AMBER — gövde figuresiz, tooltip pencere+%+saat; ok\'a dönüş yeşile iner', async () => {
  await openDetail('Model kanıt');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  assert.equal(await chipTier(), 'running', 'the staging drive did not light green');
  await page.evaluate((resetAt) => window.docket.e2e?.emit({ kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 86, resetAt }], status: 'warning' }), futureStamp());
  await page.waitForTimeout(400);
  assert.equal(await chip.count(), 1, 'the warning lit a second chip');
  assert.equal(await chipTier(), 'warn', 'the provider warning did not take the chip');
  const body = (await chip.textContent()) ?? '';
  assert.ok(body.includes('▲') && body.includes('86%'), `the amber body is missing: ${body}`);
  // WO-0085: the COMPACT body carries the figure now — the sentence (window + % + clock) is tooltip-only.
  await chip.hover();
  await page.waitForTimeout(700); // Radix delayDuration 350
  const tip = (await page.locator('[role="tooltip"]').textContent()) ?? '';
  assert.ok(tip.includes('5 saatlik pencere'), `the tooltip lost the window label: ${tip}`);
  assert.ok(tip.includes('%86'), `the tooltip lost the utilization: ${tip}`);
  await page.screenshot({ path: join(SHOTS, 'appbar-chip-warn@980.png') });
  // the provider's OWN all-clear reverts to green without ending the drive
  await page.evaluate((resetAt) => window.docket.e2e?.emit({ kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 40, resetAt }], status: 'ok' }), futureStamp());
  await page.waitForTimeout(400);
  assert.equal(await chipTier(), 'running', 'the chip stayed amber after the all-clear');
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 10, tokensOut: 2, usd: 0.01 } }));
  await page.waitForTimeout(700);
  assert.equal(await chip.count(), 1, 'the LED vanished (WO-0085: always present)');
  assert.equal(await chipTier(), 'idle', 'the clean end did not rest the chip at idle');
  await backToBoard();
});

await spec('WO-0060 çip 04: KIRMIZI amber\'i ezer; geri sayım tikler; gerçek çaprazlama çipi söker; temiz bacak dünyayı temizler', async () => {
  await openDetail('Model kanıt');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate((resetAt) => window.docket.e2e?.emit({ kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 90, resetAt }], status: 'warning' }), futureStamp());
  await page.waitForTimeout(400);
  assert.equal(await chipTier(), 'warn', 'the staging warning did not take');
  // the limit death while the warning holds: still ONE chip, and it is red (the locked ladder)
  await page.evaluate(limitDeath, new Date(Date.now() + 8_000).toISOString());
  await page.waitForTimeout(500);
  assert.equal(await chip.count(), 1, 'the limit death rendered a second chip');
  assert.equal(await chipTier(), 'limit', 'red did not outrank amber');
  const read1 = (await chip.textContent()) ?? '';
  await page.waitForTimeout(1200);
  const read2 = (await chip.textContent()) ?? '';
  assert.notEqual(read1, read2, `the countdown does not tick: ${read1} vs ${read2}`);
  await page.screenshot({ path: join(SHOTS, 'appbar-chip-limit@980.png') });
  // the SHORT stamp crossed for real: the chip unmounts ITSELF (the ticker's own gate)
  await page.waitForTimeout(8_500);
  assert.equal(await chip.count(), 1, 'the LED vanished after its own crossing (WO-0085)');
  assert.equal(await chipTier(), 'idle', 'the crossing did not rest the chip at idle');
  // cleanup: the crossed row stamp re-seeds the card — the clean leg clears it for the whole suite
  await page.locator('button', { hasText: 'Sürdür' }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 10, tokensOut: 2, usd: 0.01 } }));
  await page.waitForTimeout(800);
  assert.equal(await chipTier(), 'idle', 'a running chip came back on the cleanup leg');
  await backToBoard();
});

await spec('WO-0060 çip 05: ✦ TASLAK sayar — WO\'suz erişicinin kanıtı; taslak uyarısı amber boyar', async () => {
  await stopAllDrives();
  await switchWs('e2e', 'taslak');
  await openRoadmap();
  await startDraft('E2E: çip — taslak sürüşü appbar çipini yakar.');
  await page.waitForTimeout(400);
  assert.equal(await chip.count(), 1, 'the draft drive lit no chip (the WO-less arm is dead)');
  assert.equal(await chipTier(), 'running', 'the draft drive is not the green tier');
  assert.ok(((await chip.textContent()) ?? '').includes('1'), 'the draft chip lost its count copy');
  await draftEmit({ kind: 'limit_windows', windows: [{ window: 'five_hour', utilization: 55, resetAt: futureStamp() }], status: 'warning' });
  await page.waitForTimeout(400);
  assert.equal(await chipTier(), 'warn', 'the draft warning did not take (the WO-less arm)');
  await draftEmit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1200, tokensOut: 300, usd: 0.12 } });
  await page.waitForTimeout(700);
  assert.equal(await chipTier(), 'idle', 'the draft end did not rest the chip at idle');
  await stopAllDrives();
});

await spec('WO-0060 çip 06: reload — kırmızı çip SATIRDAN yeniden türer; çaprazlama iner; dünya temiz biter', async () => {
  await switchWs('taslak', 'e2e');
  await openBoard(); // chip 05 left the ROADMAP surface up — the card lives on the board
  await openDetail('Model kanıt');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate(limitDeath, new Date(Date.now() + 30_000).toISOString());
  await page.waitForTimeout(500);
  assert.equal(await chipTier(), 'limit', 'no red chip at the death');
  await page.reload();
  await page.waitForTimeout(900);
  // the fold is gone — the chip re-derives from the row via the mount-time getWorkOrders
  assert.equal(await chip.count(), 1, 'the chip did not re-derive from the row after the reload');
  assert.equal(await chipTier(), 'limit', 'the re-derived chip is not red');
  await page.waitForTimeout(31_000); // the real crossing, rows only
  assert.equal(await chip.count(), 1, 'the re-derived LED vanished after its crossing (WO-0085)');
  assert.equal(await chipTier(), 'idle', 'the re-derived chip did not rest at idle');
  // the app reloaded onto the seed's first workspace — read the switcher's own label to get back
  const from = ((await page.locator('header button').first().textContent()) ?? '').trim();
  await switchWs(from, 'e2e');
  // cleanup: the crossed stamp re-seeds the card; the clean leg clears the row — world clean
  await openDetail('Model kanıt');
  // the crossed stamp is INERT (a past stamp is excluded by limitInEffect; the board line is
  // history, wiped by the next run's seed) — the resume-after-reload leg is not worth its risk
  assert.equal(await chip.count(), 1, 'the LED vanished on the final clean leg (WO-0085)');
  assert.equal(await chipTier(), 'idle', 'the final clean leg did not rest the chip at idle');
});

// ===== WO-0072 — genel bakış: üç izdüşüm (Sıra · Borçlar · Hazır), satır gezinmesi, boş yüz =====
const genelLine = seedOut.trim().split('\n').find((l) => l.startsWith('GENEL='));
if (!genelLine) throw new Error('seed failed: no GENEL= line');
const openOverview = async () => {
  await page.getByRole('button', { name: 'Genel bakış', exact: true }).first().click();
  await page.waitForTimeout(600); // the read-once-per-entry refresh
};

await spec('WO-0072 dolu yüz: Sıra grupları, borç eşleşmesi (kapalı düşer, bağlantısız gerekçeli), hazır listesi, satır detayı açar', async () => {
  await switchWs('e2e', 'genel');
  await openOverview();
  const screen = await page.locator('[data-overview-screen]').innerText();
  // Sıra: the open WO reads as the operator's turn; the CLOSED work order is nowhere.
  // WO-0074: the section/group labels ride `.readout` (text-transform: uppercase) — innerText
  // returns the RENDERED form, so the pins speak the rendered case, never the bundle's.
  assert.ok(screen.includes('SENİN SIRAN') && screen.includes('WO-0091') && screen.includes('Genel açık iş'), `turns: ${screen.slice(0, 400)}`);
  assert.ok(!screen.includes('WO-0092'), 'a CLOSED work order leaked into the projection');
  // Borçlar: the open WO's debt stays linked, the closed WO's debt is GONE, the unlinked one
  // keeps its reason line
  assert.ok(screen.includes('AÇIK BORÇLAR') && screen.includes('Açık işin borcu'), `debts: ${screen.slice(0, 900)}`);
  assert.ok(!screen.includes('Kapalı işin borcu'), 'a closed WO debt leaked into the projection');
  assert.ok(screen.includes('Bağlantısız borç') && screen.includes('bağlı iş emri yok'), 'the unlinked debt row lost its reason line');
  // Hazır: the untouched written WO + the planli task in the unblocked faz only
  assert.ok(screen.includes('BAŞLAMAYA HAZIR') && screen.includes('Genel hazır görev'), `ready: ${screen.slice(0, 1200)}`);
  assert.ok(!screen.includes('Bloke görev'), 'a blocked-faz task leaked into ready');
  assert.ok(!screen.includes('Genel koşan görev'), 'a kosuyor task leaked into ready');
  await page.screenshot({ path: join(SHOTS, 'overview-full@980.png') });
  // the debt chip NAVIGATES: the linked WO's detail opens over the surface; Escape reveals it again
  await page.locator('[data-overview-debts] button', { hasText: 'WO-0091' }).first().click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-overview-screen]').count(), 0, 'the detail did not open over the surface');
  assert.ok(((await page.locator('main').first().textContent()) ?? '').includes('Genel açık iş'), 'the wrong detail opened');
  await backToBoard();
  assert.equal(await page.locator('[data-overview-screen]').count(), 1, 'the overview did not come back after the detail');
  await openBoard();
});

await spec('WO-0072 boş yüz: iş emri, görev ve borcu olmayan çalışma alanı tek davet satırıdır', async () => {
  await switchWs('genel', 'bos');
  await openOverview();
  assert.equal(await page.locator('[data-overview-empty]').count(), 1, 'not the empty face');
  const screen = await page.locator('[data-overview-screen]').innerText();
  assert.ok(screen.includes('Gösterilecek bir şey yok'), `not the invitation: ${screen}`);
  assert.ok(!screen.includes('Başlamaya hazır') && !screen.includes('Açık borçlar'), 'an empty section framed itself');
  await backToBoard();
});

// ===== WO-0088 — the parallel spine: N work orders + a draft driving at once =====
// The scripted fake is per-drive now (the composition root mints ONE runner per owner); the test
// targets each drive by its owner tag ({ owner, ev } emit) — the legacy bare emit would hit the
// most recently started drive only.
const taggedEmit = (owner, ev) => page.evaluate(([o, e]) => window.docket.e2e?.emit({ owner: o, ev: e }), [owner, ev]);
const wsTagEmit = async (ev) => {
  const ws = (await page.evaluate(() => window.docket.source.getWorkspaces())).find((w) => w.id === 'taslak');
  await taggedEmit(`ws:${ws.id}`, ev);
};

await spec('WO-0088 paralel omurga: iki iş emri + taslak aynı anda sürer; olaylar, masraflar ve sorular karışmaz', async () => {
  await switchWs('bos', 'e2e'); // the previous spec left the empty workspace; the wave rides 'e2e'
  await stopAllDrives();
  await backToBoard();
  // --- stage two fresh work orders and start BOTH plan drives ---
  const readWoId = async (title) => page.evaluate((t) => window.docket.source.getWorkOrders().then((os) => os.find((o) => o.title === t)?.id ?? null), title);
  const openWo = async (title) => {
    await page.locator('[data-wo-id]', { hasText: title }).first().click();
    await page.waitForTimeout(450);
  };
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Paralel A');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(600); // A's drive boots
  await backToBoard();
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Paralel B');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(600); // B's drive boots WHILE A runs — the old singleton refused here
  const woA = await readWoId('Paralel A');
  const woB = await readWoId('Paralel B');
  assert.ok(woA && woB, 'the two parallel work orders did not resolve');
  // --- a ✦ draft drives alongside both (the 'taslak' ws has a clean roadmap face) ---
  await backToBoard();
  await switchWs('e2e', 'taslak');
  await openRoadmap();
  await startDraft('E2E: paralel dalga taslağı.');
  await page.waitForTimeout(400);
  const pane = page.locator('[data-roadmap-pane]');
  assert.ok(((await pane.innerText()) || '').includes('MİMAR — TASLAK'), 'no live draft pane');
  // --- three live streams, each tagged: the words land in THEIR pane only ---
  await taggedEmit(`wo:${woA}`, { kind: 'assistant_text', text: 'A paralel satırı' });
  await taggedEmit(`wo:${woB}`, { kind: 'assistant_text', text: 'B paralel satırı' });
  await wsTagEmit({ kind: 'assistant_text', text: 'taslak paralel satırı' });
  await page.waitForTimeout(400);
  // the board carries BOTH running cards (the Çalışıyor bucket hosts them side by side)
  const bucket = (name) => page.locator('section').filter({ has: page.locator('h2', { hasText: name }) });
  await switchWs('taslak', 'e2e');
  await page.getByRole('button', { name: 'Pano' }).click(); // the surface rides the switch — land it
  await page.waitForTimeout(400);
  assert.ok((await bucket('Çalışıyor').locator('[data-wo-id]', { hasText: 'Paralel A' }).count()) >= 1, 'A\'s card is not in Çalışıyor');
  assert.ok((await bucket('Çalışıyor').locator('[data-wo-id]', { hasText: 'Paralel B' }).count()) >= 1, 'B\'s card is not in Çalışıyor');
  // A's detail shows A's words, never B's (the transcript lives behind the döküm chip)
  await openWo('Paralel A');
  await page.getByRole('button', { name: 'Dökümü aç' }).first().click();
  await page.waitForTimeout(400);
  const paneA = await page.locator('main').first().innerText();
  assert.ok(paneA.includes('A paralel satırı'), 'A\'s own line did not stream');
  assert.ok(!paneA.includes('B paralel satırı'), 'B\'s line leaked into A\'s detail');
  // --- two asks held at once; each card names ITS work order; answering A leaves B held ---
  await taggedEmit(`wo:${woA}`, { kind: 'permission_request', requestId: 'par-a', tool: 'Bash', input: { command: 'git push origin wo-par-a' } });
  await taggedEmit(`wo:${woB}`, { kind: 'permission_request', requestId: 'par-b', tool: 'Bash', input: { command: 'git push origin wo-par-b' } });
  await page.waitForTimeout(500);
  assert.ok((await page.getByText('git push origin wo-par-a').count()) >= 1, 'A\'s ask card did not surface');
  // m7: the CARD's own subject chip names the work order — element-level, not whole-page text
  // (the strip already carries the id, so a page-level assert could never fail).
  assert.equal(await page.locator('[data-ask-subject]').first().innerText(), woA, 'A\'s ask-card subject chip does not name its work order');
  await page.getByRole('button', { name: 'İzin ver', exact: true }).first().click();
  await page.waitForTimeout(700); // decide → A's runner releases + ask_resolved streams
  assert.equal(await page.getByText('git push origin wo-par-a').count(), 0, 'A\'s answered ask card survived');
  // B's ask: still held, and the card carries B's id (the WO-0088 subject chip)
  await backToBoard();
  await openWo('Paralel B');
  await page.getByRole('button', { name: 'Dökümü aç' }).first().click();
  await page.waitForTimeout(400);
  const bText = await page.locator('main').first().innerText();
  assert.ok(bText.includes('git push origin wo-par-b'), 'B\'s held ask vanished when A\'s was answered');
  assert.equal(await page.locator('[data-ask-subject]').first().innerText(), woB, `B\'s ask-card subject chip does not name its work order (${woB})`);
  assert.ok(bText.includes('B paralel satırı') && !bText.includes('A paralel satırı'), 'B\'s transcript crossed with A\'s');
  // --- resume B (answer its held ask), then Durdur stops EXACTLY B while A keeps running to completion ---
  await page.getByRole('button', { name: 'İzin ver', exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Durdur', exact: true }).first().click();
  await page.waitForTimeout(900);
  const readStatuses = (id) => page.evaluate((wid) => window.docket.source.getWorkOrder(wid).then((w) => w.sessions.map((s) => s.status)), id);
  assert.ok((await readStatuses(woB)).includes('stopped'), `B\'s drive did not record stopped: ${await readStatuses(woB)}`);
  await taggedEmit(`wo:${woA}`, { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 90, tokensOut: 40, usd: 0.02 } });
  await page.waitForTimeout(700);
  assert.ok((await readStatuses(woA)).includes('idle'), `A\'s drive did not record its terminal idle: ${await readStatuses(woA)}`);
  // the record: A's terminal row carries its own cost under its own owner — no clobbered sessions
  const rows = await page.evaluate((id) => window.docket.source.getWorkOrder(id).then((w) => w.sessions.map((s) => ({ cost: s.cost?.usd ?? null, status: s.status }))), woA);
  assert.ok(rows.some((r) => r.cost !== null && Math.abs(r.cost - 0.02) < 1e-9), `A\'s terminal row lost its cost: ${JSON.stringify(rows)}`);
  // --- the draft finishes alongside (its own owner tag) ---
  await switchWs('e2e', 'taslak');
  await openRoadmap();
  await wsTagEmit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 300, tokensOut: 120, usd: 0.01 } });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, 'parallel-spine@980.png') });
  // cleanup: the two throwaway work orders leave the way they came
  await page.getByRole('button', { name: 'Pano' }).click();
  await switchWs('taslak', 'e2e');
  await page.getByRole('button', { name: 'Pano' }).click(); // the surface rides the switch — land it
  await page.waitForTimeout(400);
  for (const title of ['Paralel A', 'Paralel B']) {
    await openWo(title);
    await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByText('Evet, sil').click();
    await page.waitForTimeout(800);
  }
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Paralel A' }).count(), 0, 'the throwaway parallel WO survived');
});

// ===== WO-0090 — the briefing check: the briefing resolves before it ships =====
// The 'brifing' world's decision store is the suite's only GIT repo — everywhere else the check
// is honestly undefined ("could not look") and no line renders, so this world owns all three pins.
// The block switches back to 'e2e': the WO-0092 section below arrives assuming it.
await spec('WO-0090 bayat brifing: eksik işaret VE bakılan sürüm, sürüşten önce karar yığınında adlanır', async () => {
  await switchWs('e2e', 'brifing');
  await openDetail('Brifing bayat');
  // poll for the line — the check read rides its own IPC beside the detail load
  await page.waitForSelector('[data-briefing-stale]', { timeout: 8000 });
  const line = page.locator('[data-briefing-stale]');
  assert.equal(await line.count(), 1, 'the stale briefing line did not render');
  const text = (await line.innerText()) ?? '';
  assert.ok(text.includes('lib/kayip.dart:9'), `the line does not name the missing pointer: ${text}`);
  assert.ok(!text.includes('src/a.ts'), `the line names a RESOLVING pointer (noise): ${text}`);
  assert.ok(/@[0-9a-f]{7}\b/.test(text), `the line does not name the checked sha: ${text}`);
  await page.screenshot({ path: join(SHOTS, 'briefing-stale-line@980.png') });
  await backToBoard();
});

await spec('WO-0090 temiz brifing: her işaret çözümlenince YENİ hiçbir şey çizilmez (gürültü pimi)', async () => {
  await openDetail('Brifing temiz');
  await page.waitForTimeout(600); // let the check land before asserting its silence
  assert.equal(await page.locator('[data-briefing-stale]').count(), 0, 'a line rendered over an all-resolving briefing');
  await backToBoard();
});

await spec('WO-0090 işaretsiz brifing: sıfır işaret yokluktur — satır yok, hata yok (WO-0053 kuralı)', async () => {
  await openDetail('Brifing sade');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-briefing-stale]').count(), 0, 'a zero-pointer briefing rendered a line (absent, never a failure)');
  await backToBoard();
  await switchWs('brifing', 'e2e'); // the WO-0092 section below arrives assuming 'e2e'
});

// ===== WO-0091 — the stall gate: a live drive that stops making progress is the operator's turn =====
// The verdict is derived from STAMPS, never wall-clock waiting: the events below carry `at`
// stamps minted minutes in the past, so the fold crosses the threshold the moment they land.
// TWO drives run in parallel (WO-0088's spine): one silent (the observed 1h11m · 205-token shape),
// one slow-but-advancing — the board must tell them apart.
await spec('WO-0091 durgunluk kapısı: sessizleşen sürüşün kartı sana döner; ilerleyen ve körü kalmış sürüş asla takıldı demez', async () => {
  await stopAllDrives();
  await backToBoard();
  const readWoId = (title) => page.evaluate((t) => window.docket.source.getWorkOrders().then((os) => os.find((o) => o.title === t)?.id ?? null), title);
  const stageAndDrive = async (title) => {
    await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
    await page.waitForTimeout(350);
    await page.locator('[role="dialog"] input').first().fill(title);
    await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
    await page.waitForTimeout(1400);
    await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
    await page.waitForTimeout(600); // the drive boots
    await backToBoard();
    const id = await readWoId(title);
    assert.ok(id, `the stall WO did not resolve: ${title}`);
    return id;
  };
  const woSilent = await stageAndDrive('Durgun sessiz');
  const woSlow = await stageAndDrive('Durgun yavaş');
  const bucketOf = (name) => page.locator('section').filter({ has: page.locator('h2', { hasText: name }) });
  const cardIn = async (name, title) => (await bucketOf(name).locator('[data-wo-id]', { hasText: title }).count()) >= 1;
  const old = (min) => new Date(Date.now() - min * 60000).toISOString();
  const ctx = (used, min) => ({ kind: 'context_usage', usedTokens: used, maxTokens: 200000, percentage: used / 200000, at: old(min) });
  // --- the SILENT drive: feed live, count FROZEN, no tool event for half an hour ---
  await taggedEmit(`wo:${woSilent}`, { kind: 'started', sessionId: 'stall-silent', at: old(30) });
  await taggedEmit(`wo:${woSilent}`, ctx(1000, 30)); // feed goes LIVE (the first reading claims no movement)
  await taggedEmit(`wo:${woSilent}`, ctx(1000, 1)); // alive (fresh) but frozen — the observed shape
  // --- the SLOW drive: 25 minutes old, but the count keeps CLIMBING (5 min since the last move) ---
  await taggedEmit(`wo:${woSlow}`, { kind: 'started', sessionId: 'stall-slow', at: old(25) });
  await taggedEmit(`wo:${woSlow}`, ctx(1000, 25));
  await taggedEmit(`wo:${woSlow}`, ctx(1180, 15)); // moved
  await taggedEmit(`wo:${woSlow}`, ctx(1330, 5)); // moved again — the anchor reads the NEWEST movement
  await page.waitForTimeout(500);
  const stallText = await page.locator('[data-wo-id]', { hasText: 'Durgun sessiz' }).first().innerText();
  assert.ok(stallText.includes("dk'dır ilerleme yok"), `the stall line missing: ${stallText}`);
  assert.ok(await cardIn('Sıra sende', 'Durgun sessiz'), 'the stalled card never returned to the operator');
  assert.ok(await cardIn('Çalışıyor', 'Durgun yavaş'), 'an advancing drive tripped the gate');
  // --- a LOST feed is cannot-tell — the claim lifts, the card keeps working honestly ---
  await taggedEmit(`wo:${woSilent}`, { kind: 'context_feed_lost', at: old(1) });
  await page.waitForTimeout(400);
  assert.ok(await cardIn('Çalışıyor', 'Durgun sessiz'), 'a feed-lost drive must read working (cannot-tell), never stalled');
  // --- cleanup: end both drives, then the throwaway work orders leave the way they came ---
  for (const id of [woSilent, woSlow]) {
    await taggedEmit(`wo:${id}`, { kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 60, tokensOut: 20, usd: 0.01 } });
  }
  await page.waitForTimeout(800);
  for (const title of ['Durgun sessiz', 'Durgun yavaş']) {
    await page.locator('[data-wo-id]', { hasText: title }).first().click();
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByText('Evet, sil').click();
    await page.waitForTimeout(800);
  }
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Durgun' }).count(), 0, 'a throwaway stall WO survived');
});

// ===== WO-0092 — the issue bridge: see the issues → spawn work orders =====
// The 'sorun' world's connection parses to the fixture forge repo; under DOCKET_E2E the
// composition root swaps the gh binary for the scripted e2e-forge runner — REAL adapter parsing,
// ZERO network. Spec order matters: the degraded-refusal spec runs BEFORE the successful spawns
// so nothing it asserts can be disturbed by earlier writes (it writes nothing itself).
const sorunLine = seedOut.trim().split('\n').find((l) => l.startsWith('SORUN='));
if (!sorunLine) throw new Error('seed failed: no SORUN= line');
const sorunWsId = JSON.parse(sorunLine.slice(6)).sorun;
const openIssueFold = async () => {
  await openOverview();
  const toggle = page.locator('[data-issue-fold-toggle]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.first().click();
    await page.waitForTimeout(300);
  }
};

await spec('WO-0092 sorun katlaması: depo kartı açık sorunları taşır — başlık, etiket, milestone, ↗; her açık satırda üretim', async () => {
  await switchWs('e2e', 'sorun');
  await openIssueFold();
  const fold = await page.locator('[data-issue-fold]').innerText();
  assert.ok(fold.includes('#333') && fold.includes('OTP paketi bittiğinde tam kesinti'), `row #333: ${fold.slice(0, 300)}`);
  assert.ok(fold.includes('#330') && fold.includes('Faz 1 — Antrenör Profil Sistemi'), 'the milestone title is not a display fact on the row');
  assert.ok(fold.includes('bug'), 'the label name missing');
  assert.ok(fold.includes('#329') && fold.includes('#328'), 'the other open rows missing');
  assert.equal(await page.locator('[data-issue-row] button[data-issue-spawn]').count(), 4, 'not every open row carries the spawn action');
  // m4: the sibling repo's failed issue look is ISOLATED — its PR page stays ok, the fold speaks
  // the reason alone, and the failure never touches the api card's rows.
  assert.equal(await page.locator('[data-issue-degraded]').count(), 1, 'the isolated issue-look failure has no surface');
  await page.screenshot({ path: join(SHOTS, 'issue-bridge@980.png') });
});

await spec('WO-0092 bozuk ayrıntı: ayrıntısı ölemeyen sorun tekil üretimi yerinde reddeder; toplu seçim de onaysız yazmaz', async () => {
  await openIssueFold();
  await page.locator('[data-issue-row="antreo-app/api#329"] button[data-issue-spawn]').first().click();
  await page.waitForTimeout(700); // the failed drill-down
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'a dialog opened on a degraded drill-down');
  assert.equal(await page.locator('[data-issue-spawn-error]').count(), 1, 'no in-place refusal reason');
  // the batch refuses the same way: one dead drill-down refuses the WHOLE batch, nothing written
  await page.locator('[data-issue-row="antreo-app/api#333"] button[aria-pressed]').first().click();
  await page.locator('[data-issue-row="antreo-app/api#329"] button[aria-pressed]').first().click();
  await page.waitForTimeout(200);
  await page.locator('[data-issue-batch-bar] button', { hasText: '2 iş emri oluştur' }).click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the batch confirm opened despite a degraded drill-down');
  assert.ok((await page.locator('[data-issue-fold]').innerText()).includes('İş emri açılamadı'), 'no batch refusal reason');
  const woCount = await page.evaluate(
    (ws) => window.docket.source.getWorkOrders().then((os) => os.filter((o) => o.workspace === ws).length),
    sorunWsId,
  );
  assert.equal(woCount, 0, 'a degraded spawn wrote something');
  // deselect #333 so the later batch spec starts clean
  await page.locator('[data-issue-row="antreo-app/api#333"] button[aria-pressed]').first().click();
  await page.waitForTimeout(200);
});

await spec('WO-0092 tek üretim: ▸ İş emri aç → önden dolu create diyalogu → kaydet → bantta sorun çipi (↗)', async () => {
  await openIssueFold();
  await page.locator('[data-issue-row="antreo-app/api#333"] button[data-issue-spawn]').first().click();
  // the ONE drill-down rides IPC — poll for the dialog, never a fixed sleep
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length > 0, undefined, { timeout: 8000 });
  const dlg = page.locator('[role="dialog"]');
  assert.equal(await dlg.count(), 1, 'the prefilled create dialog did not open');
  assert.ok((await dlg.locator('[data-issue-context]').innerText()).includes('antreo-app/api#333'), 'no issue origin line');
  const titleVal = await dlg.locator('input').first().inputValue();
  assert.ok(titleVal.includes('OTP paketi bittiğinde'), `title not prefilled from the issue: ${titleVal}`);
  const descVal = await dlg.locator('textarea').first().inputValue();
  assert.ok(descVal.includes('E2E gövdesi'), `body not prefilled from the drill-down: ${descVal}`);
  // m2/m5: the track seed applies — the issue's own repo chip is the pressed one, the sibling
  // code repo is not (the slug resolved through the connection row, not the forge name).
  const apiChip = dlg.locator('button[aria-pressed]', { hasText: 'sorun-api' });
  const mobileChip = dlg.locator('button[aria-pressed]', { hasText: 'sorun-mobile' });
  assert.equal(await apiChip.getAttribute('aria-pressed'), 'true', 'the issue repo track was not seeded');
  assert.equal(await mobileChip.getAttribute('aria-pressed'), 'false', 'the sibling track must stay unseeded');
  await dlg.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1500); // create + navigate to the new detail
  const chip = page.locator('[data-detail-issue-chip]');
  assert.equal(await chip.count(), 1, 'the detail band carries no issue chip');
  assert.ok(((await chip.innerText()) ?? '').includes('antreo-app/api#333'), 'the chip does not name the issue ref');
  assert.equal(await chip.locator('button').count(), 1, 'the cache-resolved chip carries no ↗ action');
  await backToBoard();
});

await spec('WO-0092 toplu üretim: 2 sorun → 2 iş emri, ardışık numaralar, tek sayılı onay; orta-kadro hatasında dürüst yeniden deneme', async () => {
  await openIssueFold();
  await page.locator('[data-issue-row="antreo-app/api#330"] button[aria-pressed]').first().click();
  await page.locator('[data-issue-row="antreo-app/api#328"] button[aria-pressed]').first().click();
  await page.waitForTimeout(200);
  const bar = page.locator('[data-issue-batch-bar]');
  assert.ok(((await bar.innerText()) ?? '').includes('2 sorun seçildi'), 'the selection bar does not count');
  await bar.locator('button', { hasText: '2 iş emri oluştur' }).click();
  // both drill-downs ride sequential IPC — poll for the confirm, never a fixed sleep
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length > 0, undefined, { timeout: 8000 });
  const dlg = page.locator('[role="dialog"]');
  assert.ok((await dlg.getByText('2 iş emri oluşturulacak').count()) >= 1, 'the confirm does not count the batch');
  // m3: the SECOND create fails (the first passes) — the confirm stays open, honestly re-counted
  // to the remainder, and the retry creates only what is left (no duplicate issue link).
  await page.evaluate(() => window.docket.e2e?.failCreates(1, 1));
  await dlg.getByRole('button', { name: '2 iş emri oluştur' }).click();
  // create #1 lands, create #2 fails — poll for the honest re-count (dialog open + remainder=1)
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"]')?.textContent?.includes('1 iş emri oluşturulacak') ?? false,
    undefined,
    { timeout: 8000 },
  );
  assert.equal(await dlg.count(), 1, 'the confirm closed on a mid-batch failure (the remainder would be lost)');
  await dlg.getByRole('button', { name: '1 iş emri oluştur' }).click();
  // the retry creates the remainder — poll for the close
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0, undefined, { timeout: 8000 });
  assert.equal(await dlg.count(), 0, 'the confirm did not close after the honest retry');
  // sequential numbers + the issue titles, read from the store. The creates run in the scan
  // page's order (number ASC) — the pin is CONSECUTIVENESS (one counted batch = N sequential
  // allocations), never the click order.
  const wos = await page.evaluate(() => window.docket.source.getWorkOrders().then((os) => os.map((o) => ({ id: o.id, title: o.title }))));
  const a = wos.find((o) => o.title.includes('şablonsuz'));
  const b = wos.find((o) => o.title.includes('Sosyal giriş'));
  assert.ok(a && b, `the batch WOs are missing: ${JSON.stringify(wos)}`);
  assert.equal(Math.abs(Number(a.id.slice(3)) - Number(b.id.slice(3))), 1, `ids are not sequential: ${a?.id} / ${b?.id}`);
  // the two-way link, issue side: the rows mark their spawned WOs (view-time join) — exactly one
  // chip per issue (the m3 duplicate would show as two)
  const spawned = page.locator('[data-issue-spawned-wo="antreo-app/api#330"] button');
  assert.equal(await spawned.count(), 1, 'the issue row does not mark its spawned WO (or marks it twice — the m3 duplicate)');
  await spawned.first().click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-detail-issue-chip]').count(), 1, 'the chip did not open the spawned WO detail');
  // the injected failure ALSO fires a real error toast (App.tsx's runBatchSpawn catch) — error
  // toasts never auto-dismiss (ADR-0012: an operator reads and acts on one). Left alive, it sits
  // in the top-right corner for the rest of this continuous session and blocks whatever renders
  // under it later (found live: it silently ate WO-0093's Sil clicks four specs downstream). A
  // real operator would read and dismiss it; this test does the same, now that no dialog is open
  // to misread the click as an outside-pointerdown dismiss (Radix's default Dialog behavior).
  const failToast = page.locator('[data-toast="error"]');
  if ((await failToast.count()) > 0) await failToast.first().click();
  await backToBoard();
});


// ===== WO-0093 — the worktree automation: Başlat prepares the working copy =====
// The 'wt' world is a REAL local git repo (seed commit on main) — the prep runs real `git
// worktree add -b`, network-free. Order matters: the parallel+resume+porcelain spec runs first
// (it needs both seeded copies alive), then delete, then the close pair, then the prep failure
// (in 'bos', whose default branch is deliberately NOT main — the verbatim base-missing arm).
const wtLine = seedOut.trim().split('\n').find((l) => l.startsWith('WT='));
if (!wtLine) throw new Error('seed failed: no WT= line');
const WT = JSON.parse(wtLine.slice('WT='.length));
const wtRootOf = () => join(dirname(DB), 'worktrees', WT.ws);
const wtDirOf = (title) => {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const hit = readdirSync(wtRootOf()).find((d) => d.endsWith(`-${slug}`));
  return hit ? join(wtRootOf(), hit) : null;
};
const wtRepoPorcelain = () => execFileSync('git', ['-C', WT.repo, 'status', '--porcelain'], { encoding: 'utf8' });
const wtWorktreeList = () => execFileSync('git', ['-C', WT.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
// git's own listing reports the REAL path (macOS /var is a symlink to /private/var — the
// adapter's own isRegisteredWorktree note); wtDirOf's path is unresolved, so the compare must
// realpath it the same way, or a genuinely-registered copy reads as unregistered here.
// realpathSync throws ENOENT on a path that no longer exists — exactly the case right after a
// successful delete/removal, which is the honest "not registered" answer, not a test error.
const wtRegistered = (path) => {
  if (!existsSync(path)) return false;
  return wtWorktreeList().split('\n').some((l) => l === `worktree ${realpathSync(path)}`);
};
// git's own .git/worktrees bookkeeping is expected and excluded: the ONLY allowed dirt is the
// Docket-authored order.md docs the operator commits (pre-existing behavior, not this feature's).
const wtAssertRepoUntouched = () => {
  for (const line of wtRepoPorcelain().split('\n').filter((l) => l.trim() !== '')) {
    assert.ok(line.startsWith('?? docs/work-orders/'), `the connected repo's working tree was touched: ${line}`);
  }
};
// The closable chain over a worktree-enabled order: plan proposal → approval → the gates chain
// (step → review → verifier), all through the tagged emit channel. Leaves the WO closable.
const wtDriveToClosable = async (woId) => {
  const emit = (ev) => taggedEmit(`wo:${woId}`, ev);
  const done = (result) => emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 100, tokensOut: 30, usd: 0.01 }, result });
  await emit({ kind: 'plan_ready', planText: '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```\n' });
  await done('Plan önerildi.');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Onayla', exact: true }).click();
  await page.waitForTimeout(1100); // the gates chain: step 1 starts itself
  await done('# Rapor\n\n`src-wt.txt:1` tamam.');
  await page.waitForTimeout(1000); // the review leg starts itself
  await done('İnceleme tamam.\nVERDICT: proceed');
  await page.waitForTimeout(1000); // the verifier leg starts itself
  await done('# Doğrulama\n\n`src-wt.txt:1` ok.');
  // nextManuelAction treats ANY done step without a verdict as reviewable, verifier steps
  // included — the verifier's own report still needs its review leg before canClose is satisfied
  // (found live: closing without this refused with "ön koşullar karşılanmadı", canClose's honest
  // step_not_reviewed, since the verifier step sat done with no verdict).
  await page.waitForTimeout(1000); // the verifier's own review leg starts itself
  await done('Doğrulama incelendi.\nVERDICT: proceed');
  await page.waitForTimeout(1100);
};

await spec('WO-0093 hazırlık: Başlat kopyayı hazırlar — sürüş orada koşar, dal hazır; tekrar başlatma yeniden eklemez; ikinci iş paralel ayrı kopyada; bağlı depo temiz kalır', async () => {
  // toplu üretim's own chain leaves the app on Genel bakış (a spawned WO's detail, opened from
  // the issue fold, backToBoard's Escape only closes ITS OWN layer) — switchWs changes the
  // workspace but not the surface, so [data-wo-id] renders nothing there. Land on Pano first.
  await page.getByRole('button', { name: 'Pano' }).click();
  await page.waitForTimeout(300);
  await switchWs('sorun', 'wt');
  await backToBoard();
  await openDetail('Kopya A');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(900);
  const wtA = wtDirOf('Kopya A');
  assert.ok(wtA && existsSync(wtA), 'Başlat did not prepare the working copy');
  const di = await page.evaluate(() => window.docket.e2e?.lastDriveInput());
  assert.equal(di?.cwd, wtA, 'the drive does not run in the derived working copy');
  const branch = execFileSync('git', ['-C', wtA, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(branch, basename(wtA), 'the branch is not the wo-NNNN-<slug> convention');
  assert.equal(branch.startsWith('wo-'), true, 'the branch does not carry the wo- prefix');
  // resume leg: Durdur → Sürdür — the registration never grows (already-prepared = no-op).
  // The Durdur's onEnd reload also re-hydrates the detail: the meta line arrives with it.
  const entryCount = () => wtWorktreeList().split('\n').filter((l) => l.startsWith('worktree ')).length;
  const before = entryCount();
  await page.getByRole('button', { name: 'Durdur', exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[data-worktree-line]').count(), 1, 'no derived-path meta line on the detail');
  assert.ok(((await page.locator('[data-worktree-line]').textContent()) ?? '').includes(wtA), 'the meta line lost the path');
  await page.getByRole('button', { name: /Sürdür/ }).first().click();
  await page.waitForTimeout(800);
  assert.equal(entryCount(), before, 'the resume re-added the working copy');
  // the second order starts WHILE A runs — two isolated copies, two branches, zero collisions
  await backToBoard();
  await openDetail('Kopya B');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(900);
  const wtB = wtDirOf('Kopya B');
  assert.ok(wtB && existsSync(wtB), 'the second order did not prepare its copy');
  assert.notEqual(wtA, wtB, 'the two orders share a working copy');
  assert.ok(wtRegistered(wtA) && wtRegistered(wtB), 'both copies are not registered');
  // the connected repo's working tree: untouched but for Docket's own authored docs
  wtAssertRepoUntouched();
  // stopAllDrives only ever finds ITS Durdur on the CURRENTLY-OPEN detail (DriveControls lives
  // there, never on the board card) — with A resumed-and-left-running and B just started, both
  // need their OWN visit + stop, or A leaks into the next spec still "thinking".
  await stopAllDrives(); // Kopya B, still open here
  await backToBoard();
  await openDetail('Kopya A');
  await stopAllDrives(); // Kopya A, resumed earlier and never revisited since
  await backToBoard();
});

await spec('WO-0093 silme: onay çalışma kopyasını sayar; silme kopyayı ve kaydı kaldırır', async () => {
  await openDetail('Kopya A');
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  const wtA = wtDirOf('Kopya A');
  assert.equal(await page.locator('[data-delete-worktree-line]').count(), 1, 'the delete confirm does not name the working copy');
  assert.ok(((await page.locator('[data-delete-worktree-line]').textContent()) ?? '').includes(wtA), 'the confirm line lost the path');
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(existsSync(wtA), false, 'the working copy survived the delete');
  assert.equal(wtRegistered(wtA), false, 'the worktree registration survived the delete');
  wtAssertRepoUntouched();
});

await spec('WO-0093 kapanış (kirli): kapatma kopyayı KORUR ve söyler; silme sonra da kaldırır', async () => {
  await openDetail('Kopya B');
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(800);
  await wtDriveToClosable(WT.b);
  // the agent's leftover: the copy is DIRTY now
  writeFileSync(join(wtDirOf('Kopya B'), 'agent-notu.md'), 'kirli\n');
  await stopAllDrives();
  await page.getByRole('button', { name: 'İş emrini kapat', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] input#wo-close-note').fill('e2e kapanış');
  await page.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
  await page.waitForTimeout(1300);
  assert.ok(existsSync(wtDirOf('Kopya B')), 'the dirty working copy was removed by the close');
  assert.ok((await page.getByText(/Kirli çalışma kopyası korundu/).count()) >= 1, 'no kept toast naming the dirty copy');
  // cleanup: the delete cascade removes even a dirty copy (--force is the delete's own grammar)
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(existsSync(wtDirOf('Kopya B')), false, 'the dirty copy survived the delete cascade');
  wtAssertRepoUntouched();
});

await spec('WO-0093 seçim + temiz kapanış: seçim varsayılan AÇIK, öncelik satırı dürüst; temiz kapanış kopyayı kaldırır', async () => {
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  const chip = page.locator('[data-wo-checkout]');
  assert.equal(await chip.getAttribute('aria-pressed'), 'true', 'the working-copy choice is not default ON');
  // the honest precedence line: an explicit cwd while ON names the override — and dies alone
  await page.locator('[role="dialog"] input').first().fill('Kopya C');
  await page.getByLabel('Çalışma kopyası (isteğe bağlı)').fill('/tmp/wt-c-oncelik');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-checkout-precedence]').count(), 1, 'no precedence line when both stand');
  await page.getByLabel('Çalışma kopyası (isteğe bağlı)').fill('');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-checkout-precedence]').count(), 0, 'the precedence line stood without the override');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400); // create → the detail arrives
  const woC = await page.evaluate(() =>
    window.docket.source.getWorkOrders().then((os) => os.find((o) => o.title === 'Kopya C')?.id ?? null),
  );
  assert.ok(woC, 'Kopya C did not resolve');
  await page.getByRole('button', { name: 'Plan iste', exact: true }).click();
  await page.waitForTimeout(800);
  assert.ok(existsSync(wtDirOf('Kopya C')), 'the created order did not prepare its copy');
  await wtDriveToClosable(woC);
  await stopAllDrives();
  await page.getByRole('button', { name: 'İş emrini kapat', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] input#wo-close-note').fill('e2e temiz kapanış');
  await page.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
  await page.waitForTimeout(1300);
  assert.equal(existsSync(wtDirOf('Kopya C')), false, 'the clean close kept the working copy');
  assert.equal(await page.getByText(/korundu/).count(), 0, 'a kept toast fired on a clean removal');
  wtAssertRepoUntouched();
});

await spec('WO-0093 hazırlık hatası: main yoksa Başlat gerekçesiyle reddeder — oturum satırı yok, yarım durum yok', async () => {
  await switchWs('wt', 'bos'); // the 'bos' repo's default branch is master — main is missing
  await backToBoard();
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await page.locator('[role="dialog"] input').first().fill('Kapı kopyası');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Plan iste', exact: true }).click();
  await page.waitForTimeout(1000);
  // the fail card's title is operator-generic (ADR-0012: raw diagnostics never render directly);
  // the verbatim reason rides the collapsed "Ayrıntı" toggle.
  await page.getByRole('button', { name: /Ayrıntı/ }).click();
  await page.waitForTimeout(300);
  const mainText = await page.locator('main').first().innerText();
  assert.ok(mainText.includes('worktree prep failed'), `the start did not refuse with the reason: ${mainText.slice(0, 300)}`);
  const woD = await page.evaluate(() =>
    window.docket.source.getWorkOrders().then((os) => os.find((o) => o.title === 'Kapı kopyası')?.id ?? null),
  );
  const sessions = await page.evaluate((id) => window.docket.source.getWorkOrder(id).then((w) => w.sessions.length), woD);
  assert.equal(sessions, 0, 'a refused prep wrote a session row');
  assert.equal(existsSync(join(dirname(DB), 'worktrees', 'bos')), false, 'a half-prepared copy was left behind');
  // cleanup
  await page.getByRole('button', { name: 'Sil', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Evet, sil', exact: true }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-wo-id]', { hasText: 'Kapı kopyası' }).count(), 0, 'the throwaway survived');
});

// ===== WO-0098 — backend profiles: the settings section, the selection, the session evidence =====
// The profile is resolved INSIDE the pipeline (lastDriveInput is main's pre-pipeline fill, so it
// never carries it — by design: the slot is not host-controllable). The scripted runner REPORTS a
// model derived from the env it was actually handed (the real CLI's init model moves with the
// env — docs/probes/backend-profiles/raw/d1-d2), so the session row's reported model is the
// end-to-end evidence, never a config echo.
const E2E_PROFILE_ENV = 'AGENT_CONFIG_DIR=/tmp/docket-e2e-glm';
await spec('WO-0098 sürücüler: yerleşik kart ilk; gizli anahtar/değer alan altında reddedilir, hiçbir şey yazılmaz; profil eklenir; profil başına Test et', async () => {
  await stopAllDrives();
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(450);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('[data-settings-item]', { hasText: 'Sürücüler' }).click();
  await page.waitForTimeout(300);
  assert.equal(await dlg.locator('[data-profiles-section]').count(), 1, 'the Sürücüler section did not open');
  assert.equal(await dlg.locator('[data-profile-card="default"]').count(), 1, 'the built-in passthrough card is missing');
  // a secret KEY refuses under the env field — and nothing lands
  await dlg.locator('[data-profile-name]').fill('Sızıntı');
  await dlg.locator('[data-profile-env-input]').fill('PROVIDER_AUTH_TOKEN=abc');
  await dlg.locator('[data-profile-submit]').click();
  await page.waitForTimeout(300);
  const alertText = async () => ((await dlg.locator('[data-profile-form] [role="alert"]').allInnerTexts()).join(' '));
  assert.ok((await alertText()).includes('gizli anahtar'), `the secret key was not refused under its field: ${await alertText()}`);
  // a token-looking VALUE under an innocent key refuses the same way
  await dlg.locator('[data-profile-env-input]').fill('BASE_THING=0f3a9c1e2b4d5f6a7b8c9d0e1f2a3b4c');
  await page.waitForTimeout(200);
  assert.ok((await alertText()).includes('anahtara benziyor'), `the token-looking value was not refused: ${await alertText()}`);
  assert.deepEqual(await page.evaluate(() => window.docket.settings.getBackendProfiles()), [], 'a refused profile was written');
  // the valid profile lands
  await dlg.locator('[data-profile-name]').fill('GLM');
  await dlg.locator('[data-profile-env-input]').fill(E2E_PROFILE_ENV);
  await dlg.locator('[data-profile-submit]').click();
  await page.waitForTimeout(500);
  assert.equal(await dlg.locator('[data-profile-card="GLM"]').count(), 1, 'the new profile card is missing');
  assert.deepEqual(
    await page.evaluate(() => window.docket.settings.getBackendProfiles()),
    [{ name: 'GLM', env: { AGENT_CONFIG_DIR: '/tmp/docket-e2e-glm' } }],
    'the stored profile is not the operator\'s verbatim pair',
  );
  // Test et runs PER PROFILE — a real zero-token handshake under that env; poll for a result word
  await dlg.locator('[data-profile-test="GLM"]').click();
  // the adapter's own ceiling is 30s (CHECK_TIMEOUT_MS) — a loaded machine's spawn may need most
  // of it; poll PAST the ceiling so the spec reads a result word, never its own impatience
  let cardText = '';
  for (let i = 0; i < 140; i++) {
    cardText = ((await dlg.locator('[data-profile-card="GLM"]').innerText()) ?? '').trim();
    if (/Hazır|Bulunamadı/.test(cardText)) break;
    await page.waitForTimeout(250);
  }
  assert.ok(/Hazır|Bulunamadı/.test(cardText), `the per-profile Test et reported no result: ${cardText}`);
  await page.screenshot({ path: join(SHOTS, 'settings-profiles@980.png') });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
});

await spec('WO-0098 seçim + kanıt: ws varsayılanı sürüşe gider, pane + oturum satırı profil + bildirilen modeli taşır; WO geçersiz kılması (Varsayılan) kazanır', async () => {
  // a prior spec that died mid-dialog must not cascade here — land on a dialog-free board
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await stopAllDrives();
  await openWsEdit();
  const wsDlg = page.locator('[role="dialog"]');
  const sec = wsDlg.locator('[data-ws-profile-section]');
  assert.equal(await sec.count(), 1, 'the workspace backend picker is missing');
  await sec.getByRole('button', { name: 'GLM', exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await sec.locator('button[aria-pressed="true"]').textContent(), 'GLM', 'the workspace default did not write through');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
  // (1) a WO that names NO override rides the workspace default
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  const cDlg = page.locator('[role="dialog"]');
  assert.equal(await cDlg.locator('[data-wo-profile]').count(), 1, 'the per-WO backend field is missing');
  await cDlg.locator('input').first().fill('Sürücü kanıt');
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  let inp;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    inp = await page.evaluate(() => window.docket.e2e?.lastDriveInput());
    if (inp?.role === 'architect' && inp?.workOrderId) break;
  }
  const inheritWo = inp.workOrderId;
  assert.equal('profile' in (inp ?? {}), false, 'main pre-filled a profile — the slot belongs to the pipeline');
  // the live pane names the backend + the model the session REPORTED
  let meta = '';
  for (let i = 0; i < 20; i++) {
    meta = (await page.locator('[data-pane-backend]').first().getAttribute('data-pane-backend').catch(() => null)) ?? '';
    if (meta.includes('GLM')) break;
    await page.waitForTimeout(250);
  }
  assert.ok(meta.includes('GLM') && meta.includes(E2E_PROFILE_ENV), `the pane meta does not carry the backend evidence: ${meta}`);
  await page.screenshot({ path: join(SHOTS, 'pane-backend@980.png') });
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(900);
  const evidence = await page.evaluate((id) => window.docket.source.getWorkOrder(id).then((w) => w?.sessions.map((s) => ({ profile: s.profile, reportedModel: s.reportedModel }))), inheritWo);
  assert.ok(
    evidence?.some((s) => s.profile === 'GLM' && s.reportedModel === `e2e-model/${E2E_PROFILE_ENV}`),
    `the session row does not carry the backend evidence: ${JSON.stringify(evidence)}`,
  );
  await backToBoard();
  // (2) a WO pinning the built-in (Varsayılan) wins over the workspace default: no env injected
  await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
  await page.waitForTimeout(350);
  await cDlg.locator('input').first().fill('Geçişli kanıt');
  await cDlg.locator('[data-wo-profile]').getByRole('button', { name: 'Varsayılan', exact: true }).click();
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    inp = await page.evaluate(() => window.docket.e2e?.lastDriveInput());
    if (inp?.workOrderId && inp.workOrderId !== inheritWo) break;
  }
  assert.notEqual(inp?.workOrderId, inheritWo, 'the pinned WO never drove');
  const pinnedDocs = await page.evaluate((id) => window.docket.source.getWorkOrderDocs(id), inp.workOrderId);
  assert.ok(pinnedDocs.order?.includes('profile: default'), 'the override did not land in order.md front-matter');
  assert.equal(await page.locator('[data-pane-backend]').count(), 0, 'the built-in drive still shows a backend meta');
  await page.evaluate(() => window.docket.e2e?.emit({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } }));
  await page.waitForTimeout(900);
  const pinnedEvidence = await page.evaluate((id) => window.docket.source.getWorkOrder(id).then((w) => w?.sessions.map((s) => ({ profile: s.profile ?? null, reportedModel: s.reportedModel }))), inp.workOrderId);
  assert.ok(pinnedEvidence?.every((s) => s.profile === null) && pinnedEvidence.some((s) => s.reportedModel === 'e2e-model/passthrough'), `the passthrough row lies: ${JSON.stringify(pinnedEvidence)}`);
  await backToBoard();
  // cleanup — the workspace back to the built-in, the profile removed (the next run starts clean)
  await openWsEdit();
  await page.locator('[role="dialog"] [data-ws-profile-section]').getByRole('button', { name: 'Varsayılan', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Ayarlar"]').click();
  await page.waitForTimeout(450);
  await page.locator('[role="dialog"] [data-settings-item]', { hasText: 'Sürücüler' }).click();
  await page.waitForTimeout(250);
  await page.locator('[role="dialog"] [data-profile-remove="GLM"]').click();
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => window.docket.settings.getBackendProfiles()), [], 'Sil did not remove the profile');
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.waitForTimeout(300);
});

await spec('zero renderer console errors', async () => {
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
});

// leave the operator's real app on Sistem (the userData is shared — see the boot pin note)
await page.evaluate(() => localStorage.removeItem('docket.theme')).catch(() => undefined);
await app.close();
console.log(failures.length ? `\n${failures.length} failing: ${failures.join(', ')}` : '\nall UI specs green');
process.exit(failures.length ? 1 : 0);
