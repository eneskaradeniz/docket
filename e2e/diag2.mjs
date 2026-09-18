// WO-0059 rev 4 diag — what does the 'Yeni iş emri örneği' DETAIL look like at chip-01 time?
// Mirror the suite: seed → (limit-04's leftover is the LAST touch of that WO) → board → detail →
// dump the decision stack + the spine's buttons.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const seedOut = execFileSync('npx', ['tsx', 'e2e/seed.ts'], { cwd: ROOT, encoding: 'utf8' });
const DB = seedOut.trim().split('\n').find((l) => l.startsWith('DB=')).slice(3);

const app = await electron.launch({
  args: [join(ROOT, 'dist-electron', 'main.js')],
  env: { ...process.env, DOCKET_DB_PATH: DB, DOCKET_E2E: '1', NODE_ENV: 'production' },
});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).split('\n')[0]));
await page.waitForTimeout(1200);

// the app boots on the seed's FIRST workspace — find which ws holds 'Yeni iş emri örneği' by
// walking the switcher list (Tümünü gör) — or simpler: the seed's own printout order suggests the
// first ws. Dump what the board shows right now:
await page.waitForTimeout(400);
const cards = await page.locator('[data-wo-id]').allInnerTexts();
console.log('board cards on the boot ws:', JSON.stringify(cards).slice(0, 300));

// walk to 'e2e' via Tümünü gör if needed
const seeAll = page.getByRole('button', { name: /Tümünü gör/ });
if ((await seeAll.count()) > 0) {
  const current = ((await page.locator('header button').first().textContent()) ?? '').replace(/[▾▎]/g, '').trim();
  console.log('current ws:', current);
}
// try the direct openDetail from wherever we are; if absent, report
const card = page.locator('[data-wo-id]', { hasText: 'Yeni iş emri örneği' }).first();
console.log('card visible here:', await card.count());
if ((await card.count()) > 0) {
  await card.click();
  await page.waitForTimeout(600);
  const body = await page.locator('main').innerText().catch(() => '(no main)');
  console.log('DETAIL TEXT (first 900):', body.slice(0, 900).replace(/\n+/g, ' | '));
  const surdur = await page.getByRole('button', { name: 'Sürdür', exact: true }).count();
  const planIste = await page.getByRole('button', { name: 'Plan iste', exact: true }).count();
  const yeniden = await page.getByRole('button', { name: 'Yeniden dene', exact: true }).count();
  const limitCard = await page.locator('[data-limit-card]').count();
  console.log(`buttons — Sürdür:${surdur} Planİste:${planIste} Yeniden:${yeniden} LimitCard:${limitCard}`);
}
await app.close();
