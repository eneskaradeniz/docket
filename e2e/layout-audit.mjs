// e2e/layout-audit.mjs — `npm run test:layout`. Runs the L-1 … L-11 rules of e2e/layout-rules.mjs
// for every screen × window size × theme and prints one line per result:
//   L-n: <screen> <WxH> <theme> ok|FAIL|skipped <detail>
// The app target adds one more line per size × theme for the search palette, measured open on the
// cockpit screen (⌘K): the panel must sit in the window's centre over a scrim that covers the
// window and blurs what is behind it, the empty standing must show the input row alone, a typed
// standing must grow the body under it, and the history standing (an opened query remembered,
// then Temizle) must grow under its head and collapse back to the input alone:
//   palette: kokpit <WxH> <theme> ok|FAIL <detail>
// and one for the settings panel, opened once through the sidebar's gear: the panel must sit
// centred and wholly inside the window at its min() size, no control it carries may reach past
// the window or the panel's own box (L-3's rule, measured while the panel is up):
//   settings: kokpit <WxH> <theme> ok|FAIL <detail>
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
// the accounts frame and its collapsible body (#377), the cockpit's closed-list heading, the
// search palette's panel, scrim, body and history head, and the settings panel's panel and scrim.
const APP_SELECTORS = {
  sidebar: 'nav[aria-label]',
  main: 'main',
  accountsFrame: '[data-accounts-frame]',
  accountsBody: '[data-accounts-body]',
  kanbanWrap: '[data-board-kanban]',
  kanbanScroller: '[data-board-cols]',
  kanbanColHead: '[data-board-col-head]',
  kanbanCard: '[data-board-card]',
  detailAsk: '[data-detail-ask]',
  livePane: '[data-detail-live]',
  closedHeading: { css: 'h2', text: 'Son kapananlar' },
  palette: '[data-search-palette]',
  paletteScrim: '[data-search-scrim]',
  paletteBody: '[data-search-body]',
  paletteHistory: '[data-search-history]',
  settingsPanel: '[data-settings-panel]',
  settingsScrim: '[data-settings-scrim]',
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

/** The palette's own measurement: ⌘K opens it, the panel must sit centred in the window over a
 *  scrim that covers the whole window and blurs what is behind it. The palette eases in and out
 *  (backdrop 320ms; panel 380ms, 90ms behind; the body folds in 280ms), so each measurement
 *  waits for the running transition to settle instead of sleeping. It measures three standings:
 *  the empty one shows the input row alone (zero body), a typed one grows the body under it, and
 *  the history one — an opened query remembered — grows the body under the "Son aramalar" head
 *  until Temizle walks the rows out and the body collapses; Temizle also leaves the stored
 *  history empty for the next size × theme. Esc closes it again.
 *  The palette's history persists in the app profile across runs; the check starts from a known
 *  empty one — the key is cleared and the page reloaded (the theme attribute follows the reload
 *  back in). */
async function paletteCheck(target, theme) {
  const { page, selectors } = target;
  const panelSettled = () =>
    page.waitForFunction(
      (sel) => {
        const panel = document.querySelector(sel);
        if (panel === null) return false;
        // Opacity is the longest leg of both the open and the close — at 1 every other
        // property of the same transition has landed too.
        return parseFloat(getComputedStyle(panel).opacity) > 0.999;
      },
      selectors.palette,
      { timeout: 4000 },
    );
  const bodySettled = (open) =>
    page.waitForFunction(
      ([bodySel, listSel, open]) => {
        const body = document.querySelector(bodySel);
        const list = document.querySelector(listSel);
        if (body === null || list === null) return false;
        // A running fold still animates; once nothing animates, the body's height is final.
        const idle = body.getAnimations().length === 0 && list.getAnimations().length === 0;
        const grown = body.getBoundingClientRect().height > 1;
        return open ? grown && idle : !grown && idle;
      },
      [selectors.paletteBody, `${selectors.palette} [role="listbox"]`, open],
      { timeout: 4000 },
    );
  const paletteFocused = () =>
    page.waitForFunction(
      (sel) => document.activeElement?.closest(sel) !== null,
      selectors.palette,
      { timeout: 4000 },
    );

  await page.evaluate(() => window.localStorage.removeItem('docket.searchHistory.v1'));
  await page.reload();
  await page.waitForSelector('nav');
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);

  await page.keyboard.press('Meta+K');
  await paletteFocused();
  await panelSettled();
  const m = await page.evaluate(([panelSel, scrimSel, bodySel]) => {
    const panel = document.querySelector(panelSel);
    const scrim = document.querySelector(scrimSel);
    const body = document.querySelector(bodySel);
    if (panel === null || scrim === null || body === null) return null;
    const r = panel.getBoundingClientRect();
    const s = scrim.getBoundingClientRect();
    const cs = getComputedStyle(scrim);
    return {
      cx: (r.left + r.right) / 2,
      cy: (r.top + r.bottom) / 2,
      w: r.width,
      h: r.height,
      iw: innerWidth,
      ih: innerHeight,
      covers: s.left <= 0 && s.top <= 0 && s.right >= innerWidth && s.bottom >= innerHeight,
      blurs: cs.backdropFilter !== '' && cs.backdropFilter !== 'none',
      emptyBody: body.getBoundingClientRect().height,
    };
  }, [selectors.palette, selectors.paletteScrim, selectors.paletteBody]);
  // A typed standing grows the body under the input — measured settled, like the empty one.
  await page.keyboard.type('antero');
  await bodySettled(true);
  const typedBody = await page.evaluate(
    (bodySel) => document.querySelector(bodySel)?.getBoundingClientRect().height ?? null,
    selectors.paletteBody,
  );
  // The history standing: opening the first result remembers the query ('antero'), and the
  // reopened palette lists it under the head. Temizle walks the rows out — the body collapses
  // to the input alone and focus stays in the input.
  await page.keyboard.press('Enter');
  await page.locator(selectors.palette).waitFor({ state: 'detached', timeout: 4000 });
  await page.keyboard.press('Meta+K');
  await paletteFocused();
  await panelSettled();
  await bodySettled(true);
  const historyM = await page.evaluate(([headSel, bodySel]) => {
    const head = document.querySelector(headSel);
    const body = document.querySelector(bodySel);
    const input = document.querySelector('[data-search-palette] input');
    return {
      listed: head?.textContent ?? '',
      h: body?.getBoundingClientRect().height ?? -1,
      inputIsText: input?.type === 'text',
    };
  }, [selectors.paletteHistory, selectors.paletteBody]);
  const historyOk =
    historyM.h > 1 &&
    historyM.listed.includes('Son aramalar') &&
    historyM.listed.includes('Temizle') &&
    historyM.inputIsText;
  await page.getByRole('button', { name: 'Temizle' }).first().click({ timeout: 4000 });
  await bodySettled(false);
  const clearedBody = await page.evaluate(
    (bodySel) => document.querySelector(bodySel)?.getBoundingClientRect().height ?? null,
    selectors.paletteBody,
  );
  const focusAfterClear = await page.evaluate(
    (sel) => document.activeElement?.closest(sel) !== null && document.activeElement?.tagName === 'INPUT',
    selectors.palette,
  );
  await page.keyboard.press('Escape');
  await page.locator(selectors.palette).waitFor({ state: 'detached', timeout: 4000 });
  if (m === null) return { ok: false, detail: 'palette elements not found' };
  if (typedBody === null || clearedBody === null) return { ok: false, detail: 'palette body not found' };
  const dx = Math.abs(m.cx - m.iw / 2);
  const dy = Math.abs(m.cy - m.ih / 2);
  // Sub-1px body is the fold's subpixel dust, not a body; a typed one clears it by an order.
  const ok =
    dx <= 0.5 &&
    dy <= 0.5 &&
    m.covers &&
    m.blurs &&
    m.w > 0 &&
    m.emptyBody < 1 &&
    typedBody > 1 &&
    historyOk &&
    clearedBody < 1 &&
    focusAfterClear;
  return {
    ok,
    detail: `centre +${dx.toFixed(1)}/+${dy.toFixed(1)} panel ${Math.round(m.w)}x${Math.round(m.h)} body ${
      Math.round(m.emptyBody)
    }→${Math.round(typedBody)}px history ${Math.round(historyM.h)}→${Math.round(clearedBody)}px focus ${
      focusAfterClear ? 'kept' : 'lost'
    } scrim ${m.covers ? 'covers' : 'gaps'} blur ${m.blurs ? 'yes' : 'no'}`,
  };
}

/** The settings panel's own measurement: the sidebar's gear opens it over the cockpit. The panel
 *  must sit centred and wholly inside the window at its min() size (the 1024×640 minimum fits it
 *  by construction), over a scrim that covers the window and blurs what is behind it, and no
 *  control it carries may reach past the window or the panel's own box (L-3's rule, measured
 *  while the panel is up). The panel eases in with the palette's motion numbers, so the
 *  measurement waits for the running transition to settle. Esc closes it again. */
async function settingsPanelCheck(target) {
  const { page, selectors } = target;
  const panelIdle = () =>
    page.waitForFunction(
      (sel) => {
        const panel = document.querySelector(sel);
        if (panel === null) return false;
        // Opacity is the longest leg of the open — at 1 the rise and scale have landed too — and
        // an idle animation set means nothing is still moving.
        return (
          parseFloat(getComputedStyle(panel).opacity) > 0.999 && panel.getAnimations().length === 0
        );
      },
      selectors.settingsPanel,
      { timeout: 4000 },
    );

  // The gear is icon-only; its accessible name is the bundle's settings label.
  await page.getByRole('button', { name: 'Ayarlar' }).first().click({ timeout: 4000 });
  await page.waitForSelector(selectors.settingsPanel, { timeout: 4000 });
  await panelIdle();
  const m = await page.evaluate(([panelSel, scrimSel]) => {
    const panel = document.querySelector(panelSel);
    const scrim = document.querySelector(scrimSel);
    if (panel === null || scrim === null) return null;
    const r = panel.getBoundingClientRect();
    const s = scrim.getBoundingClientRect();
    const cs = getComputedStyle(scrim);
    // L-3's containment, judged against the panel itself: a control the panel carries must lie
    // inside the panel's box, not only inside the window.
    const outside = [];
    const visible = (el) => {
      const b = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    for (const el of panel.querySelectorAll('button, input, select, textarea')) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) {
        outside.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24));
      }
    }
    return {
      cx: (r.left + r.right) / 2,
      cy: (r.top + r.bottom) / 2,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      w: r.width,
      h: r.height,
      iw: innerWidth,
      ih: innerHeight,
      covers: s.left <= 0 && s.top <= 0 && s.right >= innerWidth && s.bottom >= innerHeight,
      blurs: cs.backdropFilter !== '' && cs.backdropFilter !== 'none',
      outside,
    };
  }, [selectors.settingsPanel, selectors.settingsScrim]);
  await page.keyboard.press('Escape');
  await page.locator(selectors.settingsPanel).waitFor({ state: 'detached', timeout: 4000 });
  if (m === null) return { ok: false, detail: 'settings panel elements not found' };
  const dx = Math.abs(m.cx - m.iw / 2);
  const dy = Math.abs(m.cy - m.ih / 2);
  const wantW = Math.min(880, m.iw - 64);
  const wantH = Math.min(580, m.ih - 64);
  const inside = m.left >= -0.5 && m.top >= -0.5 && m.right <= m.iw + 0.5 && m.bottom <= m.ih + 0.5;
  const sized = Math.abs(m.w - wantW) <= 0.5 && Math.abs(m.h - wantH) <= 0.5;
  const ok =
    dx <= 0.5 && dy <= 0.5 && inside && sized && m.covers && m.blurs && m.outside.length === 0;
  return {
    ok,
    detail: `centre +${dx.toFixed(1)}/+${dy.toFixed(1)} panel ${Math.round(m.w)}x${Math.round(m.h)} want ${wantW}x${wantH} ${
      inside ? 'inside' : 'overflows the window'
    } controls ${m.outside.length === 0 ? 'contained' : `${m.outside.length} outside: ${m.outside.slice(0, 3).join('; ')}`} scrim ${
      m.covers ? 'covers' : 'gaps'
    } blur ${m.blurs ? 'yes' : 'no'}`,
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
      // The palette is measured open once per size × theme, on the cockpit screen; the settings
      // panel is measured the same way, through the sidebar's gear.
      if (screen === 'kokpit' && target.selectors.palette) {
        let r;
        try {
          r = await paletteCheck(target, theme);
        } catch (error) {
          r = { ok: false, detail: `palette unreachable: ${String(error).split('\n')[0]}` };
        }
        if (!r.ok) failures += 1;
        lines += 1;
        console.log(`palette: ${label} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      }
      if (screen === 'kokpit' && target.selectors.settingsPanel) {
        let r;
        try {
          r = await settingsPanelCheck(target);
        } catch (error) {
          r = { ok: false, detail: `settings panel unreachable: ${String(error).split('\n')[0]}` };
        }
        if (!r.ok) failures += 1;
        lines += 1;
        console.log(`settings: ${label} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      }
    }
  }
}
await target.close();
console.log(`${lines} checks, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
