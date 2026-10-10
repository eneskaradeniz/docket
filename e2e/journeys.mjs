// e2e/journeys.mjs — `npm run test:journeys`. J-1 … J-11 of docs/v2/ui.md → "Verifying the shell",
// driven through the BUILT app on the design seed (e2e/seed-design.ts). Every step asserts visible
// text and saves a screenshot to e2e/.out/journeys/, and every outcome lands in the structured
// report (e2e/report.mjs) as it is printed.
//
// Each size × theme combination gets its own app launch on its own fresh seed: J-1 and J-3 change
// what the seed holds (an answered ask, an approved gate), so a shared seed would make later
// combinations start from a different world. A run walks the default combination plan — dark at
// every size, light at the default window; `--full` (FULL=1 for the npm script) restores all six,
// and `--quick` stays the default 1152x720 dark alone.
//
// Copy asserted here is the rev-8 prototype's Turkish, which the seed's world is built to match —
// except the work-order codes: the prototype's sparse İE-nnnn exist nowhere as numbers, so the
// assertions use the seed's derived codes (A-29 number, U-22 format; the seed manifest maps them).
import { strict as assert } from 'node:assert';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launchDesignApp, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { SIZE_PLAN, comboPlan, resolveSizes } from './layout-rules.mjs';
import { appendJourney, beginReport, REPORT_PATH } from './report.mjs';
import { launchRoadmapApp } from './roadmap-app.mjs';
import { launchWizardApp } from './wizard-app.mjs';

const OUT = join(ROOT, 'e2e', '.out', 'journeys');
mkdirSync(OUT, { recursive: true });
await acquireE2eLock(ROOT);
// test:ui:report runs this behind the audit with DOCKET_REPORT_APPEND=1 so both land in one file;
// alone, the journey run starts its own fresh report.
beginReport();

const quick = process.argv.includes('--quick');
const full = process.argv.includes('--full') || process.env.FULL === '1';
// Only the size names are known before the first launch; the concrete numbers come from the
// resolved plan inside the loop, read from the first launch's primary display.
const combos = quick ? [['default', 'dark']] : comboPlan(SIZE_PLAN, { full }).map(({ size, theme }) => [size.name, theme]);
const WAIT = 4000; // a step that is going to pass does so in well under a second
// Waits that depend on an account scan, an import or a data load are bounded by machine speed, not
// by product behaviour: on a busy machine they run far past WAIT while the product is fine.
const SCAN_WAIT = 20_000;

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
  const see = async (t, timeout = WAIT) => text(t).waitFor({ state: 'visible', timeout });
  const gone = async (t) => text(t).waitFor({ state: 'hidden', timeout: WAIT });
  const click = async (t, timeout = WAIT) => text(t).click({ timeout });
  const button = async (name) => page.getByRole('button', { name }).first().click({ timeout: WAIT });

  let jn = '';
  let stepNo = 0;
  // The milestones the walk has passed — the shot labels, in order; a FAIL entry keeps the ones
  // that landed before the error, which is the honest shape of a partial walk.
  let steps = [];
  /** Save a screenshot for the step that just passed. */
  const shot = async (label) => {
    stepNo += 1;
    steps.push(label);
    const slug = label.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: join(OUT, `${jn}-${size[0]}x${size[1]}-${theme}-${stepNo}-${slug}.png`) });
  };

  const journey = async (id, name, fn) => {
    jn = id;
    stepNo = 0;
    steps = [];
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
      appendJourney({ id: title, status: 'ok', steps });
    } catch (error) {
      failures.push(title);
      console.log(`  FAIL ${title}\n       ${String(error).split('\n')[0]}`);
      appendJourney({ id: title, status: 'FAIL', steps, detail: String(error).split('\n')[0] });
      await page.screenshot({ path: join(OUT, `${id}-${size[0]}x${size[1]}-${theme}-FAIL.png`) }).catch(() => undefined);
    }
  };

  await journey('J-1', 'cockpit: answer a permission ask inline, the permission_answered event closes the ask', async () => {
    await see('Senden bekleyenler');
    // The ask is raised by a REAL run: the seed queues İE-0029's stage and the launched app's
    // dispatcher starts it on its own cadence (first tick 5 s in), the scripted design-agent asks
    // over the real ACP transport and the executor parks the run on the in-process permission
    // board. So this step waits the dispatcher out — the ask is answerable exactly because it
    // arrived through that production entry, not through a seeded event.
    await text('dotnet ef database update').waitFor({ state: 'visible', timeout: 30_000 });
    await shot('ask-visible');
    await button('İzin ver');
    // The answer resolves the board entry; the executor appends permission_answered (R-44's
    // closeness rule) and the cockpit's re-query drops the command band — the order stays listed
    // under its next standing (the stage's human gate), which is the honest product behaviour.
    await gone('dotnet ef database update');
    await shot('ask-answered');
  });

  await journey('J-2', 'tree → repo row → board; Kanban ⇄ Liste survives reload', async () => {
    await click('antreo-api');
    // The view choice persists per repo in the app profile; every launch starts from a throwaway
    // profile (e2e/profile.mjs), so the board opens at Kanban — the click pins that standing
    // whatever the app's default or the storage's history.
    await button('Kanban');
    await page.waitForSelector('[data-board-kanban]', { timeout: SCAN_WAIT });
    await see('Rol matrisi', SCAN_WAIT);
    await see('Bitti');
    await shot('board-kanban');
    await button('Liste');
    await see('İE-0016', SCAN_WAIT);
    await shot('board-liste');
    await page.reload();
    await page.waitForSelector('nav');
    await click('antreo-api', SCAN_WAIT);
    await see('İE-0016', SCAN_WAIT);
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

  await journey('J-6', "account card → limits popover → Hesabı aç → account view → Ayarlar'da düzenle ↗ opens the settings panel; the nav's Telefon and Ayarlar rows open it on their own sections; Esc closes and the account view is still there", async () => {
    await button('Hesapları gizle / göster'); // the frame starts collapsed; the cards need it open
    // U-51: the card's click opens the limits popover; U-51a: its Hesabı aç button is the way
    // into the account view (the card's own click no longer navigates).
    await click('Claude Max');
    await see('En dar');
    await button('Hesabı aç');
    await see('Ayarlar\'da düzenle');
    await shot('account');
    await click('Ayarlar\'da düzenle');
    // The panel is an overlay, not a route: it opens over the account view, which stays
    // underneath (blurred behind the scrim, still on the DOM) exactly as it was.
    await page.waitForSelector('[data-settings-panel]', { timeout: WAIT });
    await see('Hesaplar');
    // U-37: it lands on that account's sub-page, Limitler tab, not on the list.
    await page.getByRole('tab', { name: 'Limitler', selected: true }).waitFor({ state: 'visible', timeout: WAIT });
    await see('Ayarlar\'da düzenle');
    await shot('settings-panel');
    // Esc leaves the sub-page first (U-28), then closes the panel.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('[data-settings-panel]').waitFor({ state: 'detached', timeout: WAIT });
    await see('Ayarlar\'da düzenle');
    await shot('closed-back-on-account');
    // The sidebar's nav rows are the panel's doors (U-24): Telefon opens it on the phone
    // section's honest "not linked yet" standing; Ayarlar opens it on Hesaplar (U-28), with Görünüm holding Dil and Tema.
    await page.getByRole('button', { name: 'Telefon', exact: true }).first().click({ timeout: WAIT });
    await page.waitForSelector('[data-settings-panel]', { timeout: WAIT });
    await see('Telefon bağlı değil');
    await see('Yakında');
    await shot('settings-phone');
    await page.keyboard.press('Escape');
    await page.locator('[data-settings-panel]').waitFor({ state: 'detached', timeout: WAIT });
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click({ timeout: WAIT });
    await page.waitForSelector('[data-settings-panel]', { timeout: WAIT });
    await see('Çalışma');
    await see('Uygulama');
    await see('Hesaplar');
    await page.locator('[data-settings-panel]').getByRole('button', { name: 'Görünüm', exact: true }).click({ timeout: WAIT });
    await see('Dil');
    await see('Tema');
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

// J-9 walks the wizard on its own world (U-58 … U-60): a fresh data dir holding two adopted
// accounts whose fixture config directories share one capability, and no project — the wizard's
// own precondition. It runs once per run, not per size × theme combination: the wizard is a
// first-run surface with its own launch, and its walk asserts the step machine, not the layout.
{
  const handle = await launchWizardApp();
  const { page } = handle;
  const text = (t) => page.getByText(t, { exact: false }).first();
  const see = async (t, timeout = WAIT) => text(t).waitFor({ state: 'visible', timeout });
  const click = async (t, timeout = WAIT) => text(t).click({ timeout });
  const button = async (name) => page.getByRole('button', { name }).first().click({ timeout: WAIT });

  let jn = 'J-9';
  let stepNo = 0;
  let steps = [];
  const shot = async (label) => {
    stepNo += 1;
    steps.push(label);
    const slug = label.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: join(OUT, `${jn}-${stepNo}-${slug}.png`) });
  };
  const title = 'J-9: wizard: Yetenekler reads both accounts, syncs the shared row and imports it at the finish';
  total += 1;
  try {
    // Hoş geldin → Hesaplar: the two seeded accounts, both already selected. The fixture home
    // holds no `.claude*` directory and no installable CLI, so exactly these two rows can ever
    // stand under Bulunanlar — the count is the world's hermeticity assertion, not just readiness.
    await see('Hoş geldin');
    await shot('welcome');
    await button('Devam');
    await page.locator('[data-account-section="found"] [data-account-row]').first().waitFor({ state: 'visible', timeout: SCAN_WAIT });
    const foundRows = page.locator('[data-account-section="found"] [data-account-row]');
    const rowCount = await foundRows.count();
    assert(rowCount === 2, `the wizard world must list exactly the two fixture accounts under Bulunanlar, saw ${rowCount}`);
    await see('Kişisel');
    await see('İş');
    // "Hatalı ve bulunamayanlar" folds the builtin defs' own candidates — nothing was scanned to
    // produce them, so no row there may name an absolute path: neither the fixture home nor the
    // operator's real one (the harness env keeps the real HOME; the app env does not).
    const failedRows = page.locator('[data-account-section="failed"] [data-account-row]');
    const failedCount = await failedRows.count();
    for (let at = 0; at < failedCount; at += 1) {
      const rowText = (await failedRows.nth(at).textContent()) ?? '';
      assert(
        !rowText.includes(handle.dirs.home) && !rowText.includes(process.env.HOME ?? '\u0000'),
        `a failed-section row names a real path: ${rowText.slice(0, 120)}`,
      );
    }
    await shot('accounts');
    await button('Devam');
    // Yetenekler: one group per account; the shared capability is one row in both groups. The
    // group titles read "Asistan · Hesap" — the provider's name · the account's label (U-59).
    await page.locator('[data-cap-group]').first().waitFor({ state: 'visible', timeout: SCAN_WAIT });
    const groupCount = await page.locator('[data-cap-group]').count();
    assert(groupCount === 2, `expected 2 capability groups, saw ${groupCount}`);
    await page.locator('[data-cap-row="mcp:db|docker"]').waitFor({ state: 'visible', timeout: SCAN_WAIT });
    const sharedRows = page.locator('[data-cap-row="mcp:fetch|npx"]');
    assert((await sharedRows.count()) === 2, `the shared capability should list in both groups, saw ${await sharedRows.count()}`);
    await shot('capabilities');
    // Toggling one row syncs the other by identity (U-59). The row carries two buttons — the
    // checkbox toggle and the ⓘ trigger — so both are reached by their own role, never `button`.
    const [accA, accB] = handle.seed.accounts.map((account) => account.id);
    const rowIn = (group) => `[data-cap-group="${group}"] [data-cap-row="mcp:fetch|npx"]`;
    await page.locator(`${rowIn(accA)} [role="checkbox"]`).click({ timeout: WAIT });
    await page.waitForFunction(
      ([selA, selB]) =>
        document.querySelector(`${selA} [role="checkbox"]`)?.getAttribute('aria-checked') === 'true' &&
        document.querySelector(`${selB} [role="checkbox"]`)?.getAttribute('aria-checked') === 'true',
      [rowIn(accA), rowIn(accB)],
      { timeout: WAIT },
    );
    await shot('row-synced');
    // The ⓘ popover lists the Kaynaklar — one "Asistan · Hesap" per source. Scoped to the row:
    // exactly one ⓘ carries this accessible name inside it.
    await page.locator(rowIn(accA)).getByRole('button', { name: 'Bilgi: fetch' }).click({ timeout: WAIT });
    await see('Kaynaklar');
    await see('Claude Code · Kişisel');
    await see('Claude Code · İş');
    await shot('info-kaynaklar');
    await page.keyboard.press('Escape');
    // The summary counts the one picked identity, then the walk goes on to the finish.
    await see('1 yetenek');
    await button('Devam');
    await see('İşleri önce birinci sıradaki hesap yapar');
    await button('Devam');
    await see('Önerilen ayarlar uygulandı');
    await button('Kurulumu bitir');
    // The finish's capability line takes its check only when the import really ran (U-60).
    await page.locator('[data-finish-line="capabilities"][data-ps="done"]').waitFor({ state: 'visible', timeout: SCAN_WAIT });
    await shot('finish-capability-line');
    await page.locator('[data-wizard]').waitFor({ state: 'detached', timeout: SCAN_WAIT });
    await see('Kurulum tamamlandı');
    await shot('done');
    // The import's own evidence: the definition file exists in the data dir. The yaml stores the
    // candidate's own fields — kind, name, command — the identity is derived from (R-62), so the
    // assertion reads those, not a literal identity string.
    const capsDir = join(handle.seed.dataDir, 'capabilities');
    const files = readdirSync(capsDir);
    const wrote = files.includes('fetch.yaml') && readFileSync(join(capsDir, 'fetch.yaml'), 'utf8').includes('command: npx');
    assert(wrote, `capabilities.import left no definition for the shared capability (${files.join(', ')})`);
    console.log(`  ok   ${title}`);
    appendJourney({ id: title, status: 'ok', steps });
  } catch (error) {
    failures.push(title);
    console.log(`  FAIL ${title}\n       ${String(error).split('\n')[0]}`);
    appendJourney({ id: title, status: 'FAIL', steps, detail: String(error).split('\n')[0] });
    await page.screenshot({ path: join(OUT, 'J-9-FAIL.png') }).catch(() => undefined);
  }
  await handle.app.close();
}

// J-10 walks the roadmap page's run controls on its own world (U-63 … U-68): a fresh home holding
// one project whose roadmap has a done phase, a paused phase with an attention work order, a phase
// blocked by it and a planned phase with two runnable tasks — and no account, so nothing can run
// or spend. It runs once per run, not per size × theme combination: it asserts the control
// machine, not the layout (the layout audit covers the roadmap page at the fixed widths).
{
  const handle = await launchRoadmapApp();
  const { page, seed } = handle;
  const see = async (t) => page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout: WAIT });
  const phase = (id) => page.locator(`[data-phase="${id}"]`);
  const inCard = (id, name) => phase(id).getByRole('button', { name }).first();
  const toastWith = (t) => page.locator('[data-toast]').filter({ hasText: t }).first();
  // The toast stack sits top-right over the cards: it is closed (its own close button) before any
  // step reaches an element it could cover, and the step waits until none is left.
  const dismissToasts = async () => {
    const toasts = page.locator('[data-toast]');
    for (let left = await toasts.count(); left > 0; left = await toasts.count()) {
      await toasts.first().getByRole('button', { name: 'Kapat' }).click({ timeout: WAIT });
      await page.waitForFunction((n) => document.querySelectorAll('[data-toast]').length < n, left, { timeout: WAIT });
    }
  };

  let jn = 'J-10';
  let stepNo = 0;
  let steps = [];
  const shot = async (label) => {
    stepNo += 1;
    steps.push(label);
    const slug = label.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: join(OUT, `${jn}-${stepNo}-${slug}.png`) });
  };
  const title = 'J-10: roadmap: run controls — blocked reason, confirmation, start, pause, attention panel';
  total += 1;
  try {
    await page.locator('nav button, nav a').filter({ hasText: seed.project }).first().click({ timeout: WAIT });
    await phase('temel').waitFor({ state: 'visible', timeout: WAIT });
    await shot('roadmap');

    // Done phase: the green chip, no run button.
    await phase('temel').getByText('✓ Bitti').waitFor({ state: 'visible', timeout: WAIT });
    assert((await phase('temel').getByRole('button', { name: 'Fazı çalıştır' }).count()) === 0, 'a done phase must not offer Fazı çalıştır');

    // Blocked phase: the button is disabled and the reason names the blocking phase.
    const blocked = inCard('bildirim', 'Fazı çalıştır');
    await blocked.waitFor({ state: 'visible', timeout: WAIT });
    assert(await blocked.isDisabled(), 'the blocked phase’s Fazı çalıştır must be disabled');
    await phase('bildirim').getByText('Önce “Ödeme akışı” bitmeli').waitFor({ state: 'visible', timeout: WAIT });
    await shot('blocked-reason');

    // Paused phase with an attention work order: Sürdür, the hint and the attention chip.
    await phase('odeme').getByText('Duraklatıldı').waitFor({ state: 'visible', timeout: WAIT });
    await phase('odeme').getByText('Yeni iş başlamaz').waitFor({ state: 'visible', timeout: WAIT });
    await inCard('odeme', 'Sürdür').waitFor({ state: 'visible', timeout: WAIT });
    await inCard('odeme', '1 dikkat').waitFor({ state: 'visible', timeout: WAIT });

    // Runnable phase: the confirmation carries the counts; Vazgeç closes it and starts nothing.
    await inCard('yayin', 'Fazı çalıştır').click({ timeout: WAIT });
    await phase('yayin').getByText('2 görev').waitFor({ state: 'visible', timeout: WAIT });
    await phase('yayin').getByText('3 iş emri').waitFor({ state: 'visible', timeout: WAIT });
    await phase('yayin').getByText('Ücretli bir model gerekirse izin ayrıca sorulur').waitFor({ state: 'visible', timeout: WAIT });
    await shot('confirmation');
    await inCard('yayin', 'Vazgeç').click({ timeout: WAIT });
    await inCard('yayin', 'Başlat').waitFor({ state: 'detached', timeout: WAIT });
    assert((await phase('yayin').getByRole('button', { name: 'Duraklat' }).count()) === 0, 'Vazgeç must not start the phase');

    // Başlat sends the command. The world has no account, so the work orders open but none can
    // queue: the warn toast counts the DISTINCT tasks that failed (yuk-testi with two work orders
    // and surum-notlari with one → 2), and nothing may claim a work order queued.
    await inCard('yayin', 'Fazı çalıştır').click({ timeout: WAIT });
    await inCard('yayin', 'Başlat').click({ timeout: WAIT });
    await toastWith('2 görev açılamadı').waitFor({ state: 'visible', timeout: WAIT });
    assert((await page.getByText('sıraya girdi').count()) === 0, 'nothing queued, so no toast may say work orders queued');
    await shot('started');
    await dismissToasts();
    await inCard('yayin', 'Duraklat').waitFor({ state: 'visible', timeout: WAIT });
    await phase('yayin').getByText('Çalışıyor').first().waitFor({ state: 'visible', timeout: WAIT });

    // Duraklat flips the card to Sürdür.
    await inCard('yayin', 'Duraklat').click({ timeout: WAIT });
    await toastWith('Faz duraklatıldı').waitFor({ state: 'visible', timeout: WAIT });
    await inCard('yayin', 'Sürdür').waitFor({ state: 'visible', timeout: WAIT });
    await shot('paused');
    await dismissToasts();

    // The attention chip opens the panel: the work order's code, its task and the sentence; the
    // code opens the work order's detail.
    await inCard('odeme', '1 dikkat').click({ timeout: WAIT });
    const panel = phase('odeme').getByRole('group', { name: 'Dikkat isteyen iş emirleri' });
    await panel.waitFor({ state: 'visible', timeout: WAIT });
    await panel.getByText(seed.flaggedTask).waitFor({ state: 'visible', timeout: WAIT });
    await panel.getByText('başarısız. Faz sürüyor, bağımsız görevler devam ediyor.').waitFor({ state: 'visible', timeout: WAIT });
    await shot('attention');
    // The panel lists exactly one flagged order; its number is not pinned, because the work orders
    // Başlat opened since may rank anywhere.
    const codeButton = panel.getByRole('button').first();
    assert(/^İE-\d{4}$/.test(((await codeButton.textContent()) ?? '').trim()), 'the attention row must show a work-order code');
    await codeButton.click({ timeout: WAIT });
    await phase('odeme').waitFor({ state: 'detached', timeout: WAIT });
    await shot('detail');

    console.log(`  ok   ${title}`);
    appendJourney({ id: title, status: 'ok', steps });
  } catch (error) {
    failures.push(title);
    console.log(`  FAIL ${title}\n       ${String(error).split('\n')[0]}`);
    appendJourney({ id: title, status: 'FAIL', steps, detail: String(error).split('\n')[0] });
    await page.screenshot({ path: join(OUT, 'J-10-FAIL.png') }).catch(() => undefined);
  }
  await handle.app.close();
}

// J-11 walks Settings → Eşzamanlılık (U-69 … U-74) on the roadmap world — a hermetic home with no
// account, so nothing can run or spend. That world does not pin the dispatch mode, so the walk
// switches to Otomatik itself. Every number is reached by an absolute target (the steppers are
// clicked until the output reads it), never derived from a value the walk changes. Persistence is
// proven across a page reload, which rebuilds every store from the backend. Once per run.
{
  const handle = await launchRoadmapApp();
  const { page } = handle;
  const panel = page.locator('[data-settings-panel]');
  const form = page.locator('[data-dispatch-settings]:not([data-dispatch-loading])');
  const out = (id) => form.locator(`[role="group"]:has([data-step="${id}"]) output`);
  const dismissToasts = async () => {
    const toasts = page.locator('[data-toast]');
    for (let left = await toasts.count(); left > 0; left = await toasts.count()) {
      await toasts.first().getByRole('button', { name: 'Kapat' }).click({ timeout: WAIT });
      await page.waitForFunction((n) => document.querySelectorAll('[data-toast]').length < n, left, { timeout: WAIT });
    }
  };
  /** Click the stepper's arrows until its output reads `target`. */
  const setStep = async (id, target) => {
    for (let i = 0; i < 20; i += 1) {
      const current = Number(await out(id).textContent({ timeout: WAIT }));
      if (current === target) return;
      await form.locator(`[data-step="${id}"][data-dir="${target > current ? 1 : -1}"]`).click({ timeout: WAIT });
    }
    throw new Error(`the ${id} stepper never reached ${target}`);
  };
  const openSection = async () => {
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click({ timeout: WAIT });
    await panel.waitFor({ state: 'visible', timeout: WAIT });
    await panel.getByRole('button', { name: 'Eşzamanlılık', exact: true }).click({ timeout: WAIT });
    // The form appears only once the settings read has landed.
    await form.waitFor({ state: 'visible', timeout: SCAN_WAIT });
  };

  let stepNo = 0;
  const steps = [];
  const shot = async (label) => {
    stepNo += 1;
    steps.push(label);
    const slug = label.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: join(OUT, `J-11-${stepNo}-${slug}.png`) });
  };
  const title = 'J-11: settings: Eşzamanlılık — mode, cap, validation message, save, persisted across a reload';
  total += 1;
  try {
    await openSection();
    await shot('section');

    // Otomatik (explicit, whatever the world started in): the machine's Tavan wording appears.
    await form.getByRole('button', { name: 'Otomatik', exact: true }).click({ timeout: WAIT });
    await form.getByText('Makine boşken aynı anda çalışan en fazla iş').waitFor({ state: 'visible', timeout: WAIT });
    assert((await form.getByRole('button', { name: 'Otomatik', exact: true }).getAttribute('aria-pressed')) === 'true', 'Otomatik must be the pressed mode');

    // Cap 6, per-repo 5, then the cap down to 4: per-repo is above it, the message names the rule
    // and Kaydet is disabled.
    await setStep('global', 6);
    await setStep('perRepo', 5);
    await setStep('global', 4);
    await form.getByText('Depo başına sınır tavandan büyük olamaz.').waitFor({ state: 'visible', timeout: WAIT });
    assert(await form.getByRole('button', { name: 'Kaydet', exact: true }).isDisabled(), 'Kaydet must be disabled while per-repo exceeds the cap');
    await shot('validation');

    // Fixed: per-repo 2, cap 6 — the message goes and Kaydet opens.
    await setStep('perRepo', 2);
    await setStep('global', 6);
    await form.getByText('olamaz.').waitFor({ state: 'detached', timeout: WAIT });
    await dismissToasts();
    const save = form.getByRole('button', { name: 'Kaydet', exact: true });
    await save.click({ timeout: WAIT });
    await panel.getByText('Kaydedildi', { exact: true }).waitFor({ state: 'visible', timeout: WAIT });
    assert(await save.isDisabled(), 'Kaydet must be disabled again once the form equals what was saved');
    await shot('saved');

    // The page reload rebuilds every store: what the section reads back is what the backend holds.
    await page.reload();
    await page.waitForSelector('nav', { timeout: 30_000 });
    await openSection();
    await page.waitForFunction(
      () => {
        const read = (id) => document.querySelector(`[role="group"]:has([data-step="${id}"]) output`)?.textContent;
        return read('global') === '6' && read('perRepo') === '2';
      },
      undefined,
      { timeout: SCAN_WAIT },
    );
    assert((await form.getByRole('button', { name: 'Otomatik', exact: true }).getAttribute('aria-pressed')) === 'true', 'the saved mode must read back as Otomatik');
    await shot('reloaded');

    console.log(`  ok   ${title}`);
    appendJourney({ id: title, status: 'ok', steps });
  } catch (error) {
    failures.push(title);
    console.log(`  FAIL ${title}\n       ${String(error).split('\n')[0]}`);
    appendJourney({ id: title, status: 'FAIL', steps, detail: String(error).split('\n')[0] });
    await page.screenshot({ path: join(OUT, 'J-11-FAIL.png') }).catch(() => undefined);
  }
  await handle.app.close();
}

console.log(`${total - failures.length}/${total} journeys ok; screenshots in ${OUT}`);
console.log(`report: ${REPORT_PATH}`);
process.exit(failures.length === 0 ? 0 : 1);
