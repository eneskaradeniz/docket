// e2e/layout-audit.mjs — `npm run test:layout`. Runs the L-1 … L-9 rules of e2e/layout-rules.mjs
// for every screen × window size × theme and prints one line per result:
//   L-n: <screen> <WxH> <theme> ok|FAIL|skipped <detail>
// Exit code is 1 when any line is FAIL.
//
// Two targets share the same rules and differ only in their selector map:
//   --target=prototype <path/to/index.html>  the frozen rev-8 prototype in Chromium (file://)
//   (default)                                 the built Electron app, window resized in main
//
// The app run needs the design seed (e2e/seed-design.ts) and the host lock: another agent may be
// running Electron on this machine, and parallel launches starve each other.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { ROOT, launchDesignApp, screenNavigator, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { runRules, RULE_IDS, SIZES, THEMES, SCREENS } from './layout-rules.mjs';

/** Selector maps. A key the target lacks is reported by the rule as `skipped: no hook <key>`. */
const PROTOTYPE_SELECTORS = {
  sidebar: '.r7-side',
  main: '.r7-main',
  accountsBody: '[data-r7-accbody]',
  kanbanWrap: '[data-r7-kanban]',
  kanbanScroller: '.r7-cols',
  detailAsk: '.r7-left',
  livePane: '.r7-live',
  closedHeading: { css: 'h2.r7-sect', text: 'Son kapananlar' },
};

// Hooks the app carries: its nav landmark, <main>, and the stable hooks of the rev-8 screens —
// the board's Kanban track and scroller (#379), the detail's left column and live pane (#379),
// the accounts frame's collapsible body (#377), and the cockpit's closed-list heading.
const APP_SELECTORS = {
  sidebar: 'nav[aria-label]',
  main: 'main',
  accountsBody: '[data-accounts-body]',
  kanbanWrap: '[data-board-kanban]',
  kanbanScroller: '[data-board-cols]',
  detailAsk: '[data-detail-ask]',
  livePane: '[data-detail-live]',
  closedHeading: { css: 'h2', text: 'Son kapananlar' },
};

const parseArgs = (argv) => {
  const target = argv.find((a) => a.startsWith('--target='))?.slice('--target='.length) ?? 'app';
  const rest = argv.filter((a) => !a.startsWith('--'));
  return { target, path: rest[0] };
};

// --- prototype target --------------------------------------------------------------------------------
async function openPrototype(path) {
  const file = resolve(path.replace(/^~/, process.env.HOME ?? '~'));
  if (!existsSync(file)) throw new Error(`prototype not found: ${file}`);
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = pathToFileURL(file).href;
  return {
    selectors: PROTOTYPE_SELECTORS,
    page,
    close: () => browser.close(),
    async show(screen, theme, [w, h]) {
      await page.setViewportSize({ width: w, height: h });
      const route = screen === 'liste' ? 'pano' : screen;
      await page.goto(`${base}#/${route}`);
      await page.evaluate(() => location.reload());
      await page.waitForSelector('.r7-shell');
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      if (screen === 'liste') await page.click('[data-r7-v="liste"]');
      await page.waitForTimeout(450); // the accounts frame animates its height
    },
  };
}

// --- app target --------------------------------------------------------------------------------------
async function openApp() {
  await acquireE2eLock(ROOT);
  const handle = await launchDesignApp();
  const { page } = handle;
  const goto = screenNavigator(page);
  return {
    selectors: APP_SELECTORS,
    page,
    close: () => handle.app.close(),
    async show(screen, theme, size) {
      await setWindow(handle, size, theme);
      await goto[screen]();
      // The board's view choice persists per repo (U-18), so an earlier `liste` measurement
      // would otherwise leave the Kanban hidden for this run's `pano` — every screen enters
      // from its own standing.
      if (screen === 'pano') {
        await page.getByRole('button', { name: 'Kanban' }).first().click({ timeout: 1500 });
      }
      await page.waitForTimeout(450);
    },
  };
}

// --- run ---------------------------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.target === 'prototype' && !args.path) {
  console.error('usage: layout-audit.mjs --target=prototype <path/to/index.html>');
  process.exit(2);
}
const target = args.target === 'prototype' ? await openPrototype(args.path) : await openApp();

let failures = 0;
let lines = 0;
for (const theme of THEMES) {
  for (const size of SIZES) {
    for (const screen of SCREENS) {
      const [width, height] = size;
      const label = `${screen} ${width}x${height} ${theme}`;
      let results;
      try {
        await target.show(screen, theme, size);
        results = await runRules(target.page, { screen, width, height, theme }, target.selectors);
      } catch (error) {
        const why = String(error).split('\n')[0];
        results = RULE_IDS.map((id) => ({
          id, ok: false, detail: `screen unreachable: ${why}`,
        }));
      }
      for (const r of results) {
        const status = r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAIL';
        if (status === 'FAIL') failures += 1;
        lines += 1;
        console.log(`${r.id}: ${label} ${status} ${r.detail}`);
      }
    }
  }
}
await target.close();
console.log(`${lines} checks, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
