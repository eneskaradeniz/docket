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
    console.log(`  ✗ ${name}\n    ${String(e).split('\n').slice(0, 3).join('\n    ')}`);
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

console.log('\nWO-0031c console specs (re-anchored to the WO-0037/0038 DOSYA screen)');

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

await spec('WO-0039 stabilization: the running session is ONE card — re-entry renders the row AS the pointer; the drive runs in the background', async () => {
  await openDetail('Yeni iş emri örneği');
  // the label is honest since round 3: "Sürdür" when a persisted architect session exists (this WO
  // carries one from the previous spec's stopped drive), "Plan iste" when none does
  await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
  await page.waitForTimeout(600); // the drive starts; the session row records behind it
  // The operator's repro (2026-08-23): leave and come back — the reload loads the RUNNING row, and
  // the ledger used to render it BESIDE the pointer (two "Plan" cards for one live session).
  await backToBoard();
  await openDetail('Yeni iş emri örneği');
  await page.waitForTimeout(500);
  const audit = page.locator('section#sec-audit');
  const cardCount = await audit.locator('[data-session-card]').count();
  assert.equal(cardCount, 1, `the running session rendered ${cardCount} cards (the re-entry dupe)`);
  assert.equal(await audit.locator('[data-session-live-pointer]').count(), 1, 'the one card is not the live pointer');
  assert.ok((await audit.getByText('Canlı oturum').count()) >= 1, 'the pointer lost its jump line');
  // the background drive survived the navigation — the pane is still live (one Durdur, the pane header's)
  assert.equal(await page.getByRole('button', { name: 'Durdur', exact: true }).count(), 1, 'the drive did not survive the re-entry');
  await stopAllDrives();
  // Round 3 (operator: "devam et butonu gidiyor"): the Sürdür OFFER derives from the app-level
  // fold — it must survive ANOTHER leave-and-come-back, not die with the controller's memory.
  await backToBoard();
  await openDetail('Yeni iş emri örneği');
  await page.waitForTimeout(400);
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

await spec('DOSYA at 980: ONE scroll — no tabs at any width; the chat lives in the driven row (WO-0038)', async () => {
  // 'İzin bekliyor' — its step is ACTIVE with a persisted transcript, so the spine's driven row
  // actually holds the compact chat with content.
  await backToBoard(); // defensive: the stopped_asking spec leaves the detail open
  await openDetail('İzin bekliyor');
  assert.equal(await page.locator('[role="tablist"]').count(), 0, 'a tab bar survived at 980');
  assert.equal(await page.locator('[role="tab"]').count(), 0, 'a tab survived at 980');
  // the driven row holds the compact chat INLINE (pinned — no toggle hides it)
  assert.equal(await page.locator('[data-step-live="1"]').count(), 1, 'no driven-row hook on the active step');
  const chat = page.locator('[data-step-live] [data-chat]');
  assert.ok((await chat.count()) >= 1, 'no chat column inside the driven step row');
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
  assert.ok((await page.locator('[data-step-live] [data-chat]').count()) >= 1, 'the driven-row chat is gone at 1240');
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
  assert.ok((await page.getByText('Bağımsız', { exact: true }).count()) >= 1, 'the unscoped session is not named Bağımsız');
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
  await page.waitForTimeout(600); // the kit Tooltip's 350ms delay
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
  for (let i = 0; i < 10; i++) {
    await emit({ kind: 'assistant_text', text: `Doldurma satırı ${i} — `.padEnd(220, 'x') });
  }
  await page.waitForTimeout(400);
  const atBottom = () => page.locator('[data-chat]').first().evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 48);
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
  assert.ok((await page.getByText('doğrulayıcı raporu yok', { exact: true }).count()) >= 1, 'no verification absence sentence in the close card');
  assert.equal(await page.getByText('eksik', { exact: true }).count(), 0, 'a reasonless eksik leaked');
  // WO-0038 order: Belgeler → (Kaynaklar on presence) → Oturum dökümü — the one scroll's sections
  const ids = await page.evaluate(() => [...document.querySelectorAll('.flow-scroll section[id]')].map((s) => s.id));
  assert.deepEqual(ids, ['sec-docs', 'sec-audit'], `the record sections are wrong: ${ids.join(',')}`);
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
  assert.ok(cardText.includes('Adım 1 · a'), `the card is not named for its step: ${cardText}`);
  assert.ok(cardText.includes('Özet — Raf: döküm satırı 1'), 'the artifact headline (özet) is missing');
  assert.ok((await card.locator('.rlamp').count()) >= 1, 'the card header carries no role lamp');
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
  await rowByPath('/tmp/e2e-ikinci-depo').getByRole('button', { name: 'Depo yolunu düzenle' }).click();
  await page.waitForTimeout(250);
  const editor = dlg.locator('input.font-mono:not([placeholder])');
  assert.ok((await editor.count()) === 1, 'the ✎ did not open a path editor');
  assert.equal(await editor.inputValue(), '/tmp/e2e-ikinci-depo', 'the editor seeded the wrong row');
  await editor.fill('/tmp/yeni/yol/e2e-ikinci-depo');
  await editor.press('Enter');
  await page.waitForTimeout(500);
  assert.ok((await dlg.locator('div[title="/tmp/yeni/yol/e2e-ikinci-depo"]').count()) >= 1, 'the path edit did not commit');
  await rowByPath('/tmp/yeni/yol/e2e-ikinci-depo').getByRole('button', { name: 'Depo yolunu düzenle' }).click();
  await page.waitForTimeout(250);
  await editor.fill('/tmp/farkli-ad');
  await editor.press('Enter');
  await page.waitForTimeout(400);
  assert.ok((await dlg.getByText('Ad değişemez', { exact: false }).count()) >= 1, 'no basename refusal line');
  assert.equal((await editor.count()), 1, 'a failed commit closed the editor (the typed text would be lost)');
  await editor.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await editor.count(), 0, 'ESC did not revert the editor');
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
    const editor = dlg.locator('input.font-mono:not([placeholder])');
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
    await pa.waitForLoadState('domcontentloaded');
    await pa.waitForTimeout(700);
    assert.equal(await pa.evaluate(() => navigator.language.startsWith('tr')), true, 'the --lang switch did not reach the renderer');
    assert.ok((await pa.getByText('Haydi ilk çalışma alanını oluşturalım').count()) >= 1, 'detection did not boot tr');
    assert.equal(await pa.evaluate(() => document.documentElement.getAttribute('lang')), 'tr', 'html lang is not tr');
    // pick English explicitly, then WIPE the localStorage mirror before closing — the next boot
    // must prove the DB row, not the mirror
    await pa.locator('button[aria-label="Ayarlar"]').click();
    await pa.waitForTimeout(350);
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

await spec('zero renderer console errors', async () => {
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
});

await app.close();
console.log(failures.length ? `\n${failures.length} failing: ${failures.join(', ')}` : '\nall UI specs green');
process.exit(failures.length ? 1 : 0);
