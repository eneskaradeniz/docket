// e2e/journeys.mjs — `npm run test:journeys`. J-1 … J-7 of docs/v2/ui.md → "Verifying the shell",
// driven through the BUILT app on the design seed (e2e/seed-design.ts). Every step asserts visible
// text and saves a screenshot to e2e/.out/journeys/.
//
// Each size × theme combination gets its own app launch on its own fresh seed: J-1 and J-3 change
// what the seed holds (an answered ask, an approved gate), so a shared seed would make later
// combinations start from a different world. `--quick` runs the default 1280x800 dark only.
//
// Copy asserted here is the rev-8 prototype's Turkish, which the seed's world is built to match —
// except the work-order codes: the prototype's sparse İE-nnnn exist nowhere as numbers, so the
// assertions use the seed's derived codes (A-29 number, U-22 format; the seed manifest maps them).
import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launchDesignApp, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { SIZES, THEMES } from './layout-rules.mjs';

const OUT = join(ROOT, 'e2e', '.out', 'journeys');
mkdirSync(OUT, { recursive: true });
await acquireE2eLock(ROOT);

const quick = process.argv.includes('--quick');
const combos = quick ? [[[1280, 800], 'dark']] : THEMES.flatMap((theme) => SIZES.map((size) => [size, theme]));
const WAIT = 4000; // a step that is going to pass does so in well under a second

const failures = [];
let total = 0;

for (const [size, theme] of combos) {
  const tag = `${size[0]}x${size[1]} ${theme}`;
  const handle = await launchDesignApp();
  const { page } = handle;
  await setWindow(handle, size, theme);

  const text = (t) => page.getByText(t, { exact: false }).first();
  /** Assert the text is visible. */
  const see = async (t) => text(t).waitFor({ state: 'visible', timeout: WAIT });
  const gone = async (t) => text(t).waitFor({ state: 'hidden', timeout: WAIT });
  const click = async (t) => text(t).click({ timeout: WAIT });
  const button = async (name) => page.getByRole('button', { name }).first().click({ timeout: WAIT });

  let jn = '';
  let stepNo = 0;
  /** Save a screenshot for the step that just passed. */
  const shot = async (label) => {
    stepNo += 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: join(OUT, `${jn}-${size[0]}x${size[1]}-${theme}-${stepNo}-${slug}.png`) });
  };

  const journey = async (id, name, fn) => {
    jn = id;
    stepNo = 0;
    total += 1;
    const title = `${id}: ${name} [${tag}]`;
    try {
      await click('Kokpit').catch(() => undefined); // every journey starts at the cockpit
      await fn();
      console.log(`  ok   ${title}`);
    } catch (error) {
      failures.push(title);
      console.log(`  FAIL ${title}\n       ${String(error).split('\n')[0]}`);
      await page.screenshot({ path: join(OUT, `${id}-${size[0]}x${size[1]}-${theme}-FAIL.png`) }).catch(() => undefined);
    }
  };

  await journey('J-1', 'cockpit: answer a permission ask inline, the item leaves Senden bekleyenler', async () => {
    await see('Senden bekleyenler');
    await see('dotnet ef database update');
    await shot('ask-visible');
    await button('İzin ver');
    await gone('dotnet ef database update');
    await shot('ask-answered');
  });

  await journey('J-2', 'tree → repo row → board; Kanban ⇄ Liste survives reload', async () => {
    await click('antreo-api');
    await see('Pano');
    await see('Rol matrisi');
    await shot('board-kanban');
    await button('Liste');
    await see('İE-0016');
    await shot('board-liste');
    await page.reload();
    await page.waitForSelector('nav');
    await click('antreo-api');
    await see('İE-0016');
    assert.equal(await page.getByText('ANALİZ', { exact: true }).count(), 0, 'the Kanban columns must stay hidden after reload');
    await shot('board-liste-after-reload');
  });

  await journey('J-3', 'card → in-place detail → approve → ‹ Geri keeps the view state', async () => {
    await click('antreo-api');
    await button('Liste');
    await click('Swagger staging testi');
    await see('Bu aşamada senden beklenen');
    await shot('detail');
    await button('Onayla');
    await see('Onaylandı');
    await shot('approved');
    await click('‹ Geri');
    await see('İE-0016');
    assert.equal(await page.getByText('ANALİZ', { exact: true }).count(), 0, 'Liste must still be the active view');
    await shot('back-on-board');
  });

  await journey('J-4', 'project row → roadmap → expand a cross-repo task → its work order opens the detail', async () => {
    await click('Antero');
    await see('Yol haritası');
    await shot('roadmap');
    await click('Mobil login');
    await see('İE-0026');
    await see('İE-0027');
    await shot('task-expanded');
    await click('İE-0026');
    await see('Mobil login');
    await see('Bu aşamada senden beklenen');
    await shot('detail');
  });

  await journey('J-5', 'single-repo project → board → Yol haritası ↗', async () => {
    await click('Kadife Odoo');
    await see('kadife-odoo');
    await see('Pano');
    await shot('board');
    await click('Yol haritası ↗');
    await see('Yol haritası');
    await shot('roadmap');
  });

  await journey('J-6', "account card → account view → Ayarlar'da düzenle ↗ opens Settings", async () => {
    await button('Hesapları gizle / göster'); // the frame starts collapsed; the cards need it open
    await click('Claude Max');
    await see('Ayarlar\'da düzenle');
    await shot('account');
    await click('Ayarlar\'da düzenle');
    await see('Hesaplar');
    await shot('settings');
  });

  await journey('J-7', '⌘K focuses the search', async () => {
    await page.keyboard.press('Meta+K');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName} ${el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? ''}` : '';
    });
    assert.match(focused, /^INPUT .*(İş emri|Ara)/i, `focus is on ${focused}`);
    await shot('search-focused');
  });

  await handle.app.close();
}

console.log(`${total - failures.length}/${total} journeys ok; screenshots in ${OUT}`);
process.exit(failures.length === 0 ? 0 : 1);
