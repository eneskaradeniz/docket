// e2e/journeys.mjs — `npm run test:journeys`. J-1 … J-8 of docs/v2/ui.md → "Verifying the shell",
// driven through the BUILT app on the design seed (e2e/seed-design.ts). Every step asserts visible
// text and saves a screenshot to e2e/.out/journeys/.
//
// Each size × theme combination gets its own app launch on its own fresh seed: J-1 and J-3 change
// what the seed holds (an answered ask, an approved gate), so a shared seed would make later
// combinations start from a different world. `--quick` runs the default 1152x720 dark only.
//
// Copy asserted here is the rev-8 prototype's Turkish, which the seed's world is built to match —
// except the work-order codes: the prototype's sparse İE-nnnn exist nowhere as numbers, so the
// assertions use the seed's derived codes (A-29 number, U-22 format; the seed manifest maps them).
import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launchDesignApp, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { SIZE_PLAN, THEMES, resolveSizes } from './layout-rules.mjs';

const OUT = join(ROOT, 'e2e', '.out', 'journeys');
mkdirSync(OUT, { recursive: true });
await acquireE2eLock(ROOT);

const quick = process.argv.includes('--quick');
const combos = quick
  ? [['default', 'dark']]
  : THEMES.flatMap((theme) => SIZE_PLAN.map(({ name }) => [name, theme]));
const WAIT = 4000; // a step that is going to pass does so in well under a second

const failures = [];
let total = 0;

// The display does not change across one run's launches: the plan is resolved once, from the
// first launch's primary display, and every later launch picks its entry by name.
let resolved = null;

for (const [sizeName, theme] of combos) {
  const handle = await launchDesignApp();
  if (resolved === null) resolved = await resolveSizes(handle.app);
  const { size } = resolved.find((s) => s.name === sizeName);
  const tag = `${size[0]}x${size[1]} ${theme}`;
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
      // The title bar buttons are icon-only — reach them by their aria-label, not text.
      await page
        .getByRole('button', { name: 'Anasayfa' })
        .first()
        .click({ timeout: WAIT })
        .catch(() => undefined); // every journey starts at the cockpit
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
    // The view choice persists per repo in the app profile, so the journey enters from Kanban
    // whatever an earlier run left behind.
    await button('Kanban');
    await page.waitForSelector('[data-board-kanban]', { timeout: WAIT });
    await see('Rol matrisi');
    await see('Bitti');
    await shot('board-kanban');
    await button('Liste');
    await see('İE-0016');
    await shot('board-liste');
    await page.reload();
    await page.waitForSelector('nav');
    await click('antreo-api');
    await see('İE-0016');
    assert.equal(await page.locator('[data-board-kanban]').count(), 0, 'the Kanban columns must stay hidden after reload');
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
    assert.equal(await page.locator('[data-board-kanban]').count(), 0, 'Liste must still be the active view');
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
    await page.waitForSelector('[data-board-kanban]');
    await shot('board');
    await click('Yol haritası ↗');
    await see('Yol haritası');
    await shot('roadmap');
  });

  await journey('J-6', "account card → account view → Ayarlar'da düzenle ↗ opens the settings panel; the nav's Telefon and Ayarlar rows open it on their own sections; Esc closes and the account view is still there", async () => {
    await button('Hesapları gizle / göster'); // the frame starts collapsed; the cards need it open
    await click('Claude Max');
    await see('Ayarlar\'da düzenle');
    await shot('account');
    await click('Ayarlar\'da düzenle');
    // The panel is an overlay, not a route: it opens over the account view, which stays
    // underneath (blurred behind the scrim, still on the DOM) exactly as it was.
    await page.waitForSelector('[data-settings-panel]', { timeout: WAIT });
    await see('Hesaplar');
    await see('Ayarlar\'da düzenle');
    await shot('settings-panel');
    await page.keyboard.press('Escape');
    await page.locator('[data-settings-panel]').waitFor({ state: 'detached', timeout: WAIT });
    await see('Ayarlar\'da düzenle');
    await shot('closed-back-on-account');
    // The sidebar's nav rows are the panel's doors (U-24): Telefon opens it on the phone
    // section's honest "not linked yet" standing; Ayarlar opens it where the gear used to.
    await page.getByRole('button', { name: 'Telefon', exact: true }).first().click({ timeout: WAIT });
    await page.waitForSelector('[data-settings-panel]', { timeout: WAIT });
    await see('Telefon bağlı değil');
    await see('Yakında');
    await shot('settings-phone');
    await page.keyboard.press('Escape');
    await page.locator('[data-settings-panel]').waitFor({ state: 'detached', timeout: WAIT });
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click({ timeout: WAIT });
    await page.waitForSelector('[data-settings-panel]', { timeout: WAIT });
    await see('Dil');
    await shot('settings-language');
    await page.keyboard.press('Escape');
    await page.locator('[data-settings-panel]').waitFor({ state: 'detached', timeout: WAIT });
  });

  await journey('J-7', '⌘K opens the palette and focuses its input', async () => {
    // The palette eases in and out (backdrop 320ms; panel 380ms, 90ms behind it; the body folds
    // in 280ms) — the waits below ride the transitions themselves, no fixed sleeps.
    // The palette's history persists in the app profile across runs; the journey starts from a
    // known empty one — clear the key and reload before the first open.
    await page.evaluate(() => window.localStorage.removeItem('docket.searchHistory.v1'));
    await page.reload();
    await page.waitForSelector('nav');
    const panelSettled = () =>
      page.waitForFunction(
        () => {
          const panel = document.querySelector('[data-search-palette]');
          // Opacity is the longest leg of the open — at 1 the rise and scale have landed too.
          return panel !== null && parseFloat(getComputedStyle(panel).opacity) > 0.999;
        },
        undefined,
        { timeout: WAIT },
      );
    const bodySettled = (open) =>
      page.waitForFunction(
        (open) => {
          const body = document.querySelector('[data-search-body]');
          const list = document.querySelector('[data-search-palette] [role="listbox"]');
          if (body === null || list === null) return false;
          // A running fold still animates; once nothing animates, the body's height is final.
          const idle = body.getAnimations().length === 0 && list.getAnimations().length === 0;
          const grown = body.getBoundingClientRect().height > 1;
          return open ? grown && idle : !grown && idle;
        },
        open,
        { timeout: WAIT },
      );
    const bodyHeight = () =>
      page.evaluate(() => document.querySelector('[data-search-body]')?.getBoundingClientRect().height ?? -1);

    await page.keyboard.press('Meta+K');
    await page.waitForFunction(
      () => document.activeElement?.closest('[data-search-palette]') !== null,
      undefined,
      { timeout: WAIT },
    );
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName} ${el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? ''}` : '';
    });
    assert.match(focused, /^INPUT (Proje|Search)/i, `focus is on ${focused}`);
    await panelSettled();
    // An empty query leaves the panel as the input row alone — no body under it (sub-1px is
    // the fold's subpixel dust, not a body).
    const emptyBody = await bodyHeight();
    assert.ok(emptyBody < 1, `empty palette shows a ${emptyBody}px body under the input`);
    await shot('palette-open');
    // 'a' then 'ad' both match the seed ("Kadife Odoo"), so every standing on the way has rows —
    // sample the palette across the whole debounce window while the keys land and the rows
    // settle, and require the no-results line never to appear.
    const emptySeen = page.evaluate(
      (emptyText) =>
        new Promise((resolve) => {
          let seen = false;
          const startedAt = performance.now();
          const sample = () => {
            const list = document.querySelector('[data-search-palette] [role="listbox"]');
            if (list !== null && list.textContent.includes(emptyText)) seen = true;
            if (performance.now() - startedAt > 500) resolve(seen);
            else setTimeout(sample, 16);
          };
          sample();
        }),
      'Sonuç yok',
    );
    await page.keyboard.press('a');
    await page.keyboard.press('d');
    assert.ok((await emptySeen) === false, 'the no-results line flashed while "a"/"ad" settled');
    await bodySettled(true);
    // 'ad' matches the project and its repo — the first row carrying the text is evidence enough.
    await see('Kadife');
    await shot('palette-first-keys');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await bodySettled(false);
    // The palette's index is the tree's own names: 'antero' finds the project, Enter opens its roadmap.
    await page.keyboard.type('antero');
    await bodySettled(true);
    await page.locator('[data-search-palette]').getByText('Antero').waitFor({ state: 'visible', timeout: WAIT });
    await shot('palette-results');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await see('Yol haritası');
    await shot('palette-opened-roadmap');
    // Opening a result is what remembers a query: reopened, the palette lists it under the
    // history's header. The row is clicked inside the palette — the roadmap beneath the scrim
    // carries the same name and must not take the click.
    await page.keyboard.press('Meta+K');
    await page.waitForFunction(
      () => document.activeElement?.closest('[data-search-palette]') !== null,
      undefined,
      { timeout: WAIT },
    );
    await panelSettled();
    await bodySettled(true);
    await see('Son aramalar');
    await page.locator('[data-search-palette]').getByText('antero', { exact: true }).click({ timeout: WAIT });
    const filled = await page.evaluate(() => document.querySelector('[data-search-palette] input')?.value ?? '');
    assert.equal(filled, 'antero', 'a history choice must fill the input with its query');
    await bodySettled(true);
    await page.locator('[data-search-palette]').getByText('Antero').waitFor({ state: 'visible', timeout: WAIT });
    await shot('palette-history-chosen');
    // Clearing the text brings the history standing back — the × belongs to its rows alone.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace');
    await bodySettled(true);
    await see('Son aramalar');
    // The row's × removes the one entry — with the last row the header leaves too, and the body
    // folds back to the input alone.
    await page.getByRole('button', { name: 'Aramayı geçmişten kaldır' }).first().click({ timeout: WAIT });
    await bodySettled(false);
    await gone('Son aramalar');
    const removedBody = await bodyHeight();
    assert.ok(removedBody < 1, `an emptied history keeps a ${removedBody}px body under the input`);
    await shot('palette-history-removed');
    // Temizle clears the whole list at once: one more query is remembered by opening its result,
    // and the reopened palette's rows walk out with the row-exit motion while focus stays in
    // the input.
    await page.keyboard.type('kadife');
    await bodySettled(true);
    await page.keyboard.press('Enter');
    await see('Yol haritası');
    await page.keyboard.press('Meta+K');
    await page.waitForFunction(
      () => document.activeElement?.closest('[data-search-palette]') !== null,
      undefined,
      { timeout: WAIT },
    );
    await bodySettled(true);
    await see('Son aramalar');
    await button('Temizle');
    await bodySettled(false);
    await gone('Son aramalar');
    const focusAfterClear = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName} ${el.getAttribute('placeholder') ?? ''}` : '';
    });
    assert.match(focusAfterClear, /^INPUT /i, `focus after Temizle is on ${focusAfterClear}`);
    await shot('palette-history-cleared');
    // The sidebar's Ara row opens the same door (U-24); clearing the text folds the body away
    // again (the history stays empty — a query is remembered only by an opening), and Esc eases
    // the palette out. The row's accessible name is its label plus the right-aligned ⌘K hint,
    // the name the palette's door has always carried.
    await page.keyboard.press('Escape');
    await page.locator('[data-search-palette]').waitFor({ state: 'detached', timeout: WAIT });
    await page.getByRole('button', { name: 'Ara ⌘K', exact: true }).click({ timeout: WAIT });
    await page.waitForSelector('[data-search-palette]', { timeout: WAIT });
    await page.keyboard.type('antero');
    await bodySettled(true);
    for (let i = 0; i < 7; i += 1) await page.keyboard.press('Backspace');
    await bodySettled(false);
    const clearedBody = await bodyHeight();
    assert.ok(clearedBody < 1, `cleared palette keeps a ${clearedBody}px body under the input`);
    await page.keyboard.press('Escape');
    await page.locator('[data-search-palette]').waitFor({ state: 'detached', timeout: WAIT });
    await shot('palette-closed');
  });

  await journey('J-8', 'cockpit → project → back → forward; the detail’s ‹ Geri rides the same history', async () => {
    // The chevrons' standing is a DOM attribute that lands with the route's own render; reading
    // it in the same breath as the screen's text can catch the commit between the two queries —
    // so every standing is waited for, never sampled.
    const dimmedIs = (hook, want) =>
      page.waitForFunction(
        ({ hook, want }) => {
          const btn = document.querySelector(`[data-nav-${hook}]`);
          return btn !== null && (btn.getAttribute('aria-disabled') !== null) === want;
        },
        { hook, want },
        { timeout: WAIT },
      );
    // The history lives in memory alone (U-25): the journeys before this one left theirs behind —
    // J-7 ends on a roadmap, and the helper's Anasayfa click would only push another cockpit on
    // top of it, leaving back legitimately alive. A reload starts the history over as the
    // cockpit's single entry, the standing the ends' dimming is measured on.
    await page.reload();
    await page.waitForSelector('nav');
    await see('Senden bekleyenler');
    await dimmedIs('back', true);
    await dimmedIs('forward', true);
    await shot('ends-dimmed');
    // A project from the tree is the history's second entry.
    await click('Antero');
    await see('Yol haritası');
    await dimmedIs('back', false);
    await shot('roadmap');
    // ⌘[ returns to the cockpit — the chevrons and the keys are the same doors.
    await page.keyboard.press('Meta+[');
    await see('Senden bekleyenler');
    await dimmedIs('forward', false);
    await shot('back-on-cockpit');
    // ⌘] returns to the roadmap.
    await page.keyboard.press('Meta+]');
    await see('Yol haritası');
    await shot('forward-on-roadmap');
    // While the palette is open the keys belong to it: ⌘[ changes nothing underneath.
    await page.keyboard.press('Meta+K');
    await page.waitForSelector('[data-search-palette]', { timeout: WAIT });
    await page.keyboard.press('Meta+[');
    await see('Yol haritası');
    await page.keyboard.press('Escape');
    await page.locator('[data-search-palette]').waitFor({ state: 'detached', timeout: WAIT });
    await shot('palette-owns-the-keys');
    // The bar's buttons do the same walk, and the detail's ‹ Geri is the same back (U-25): its
    // row names the screen behind it in the history.
    await button('Geri ⌘[');
    await see('Senden bekleyenler');
    await button('İleri ⌘]');
    await see('Yol haritası');
    await click('Mobil login');
    await see('İE-0026');
    await click('İE-0026');
    await see('Bu aşamada senden beklenen');
    await shot('detail');
    await click('‹ Geri · yol haritası');
    await see('Yol haritası');
    await dimmedIs('forward', false);
    await shot('back-from-detail');
  });

  await handle.app.close();
}

console.log(`${total - failures.length}/${total} journeys ok; screenshots in ${OUT}`);
process.exit(failures.length === 0 ? 0 : 1);
