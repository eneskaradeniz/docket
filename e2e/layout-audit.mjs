// e2e/layout-audit.mjs — `npm run test:layout`. Runs the L-1 … L-11 rules of e2e/layout-rules.mjs
// for every screen × window size × theme and prints one line per result:
//   L-n: <screen> <WxH> <theme> ok|FAIL|skipped <detail>
// The run opens by printing the resolved size plan with its real numbers (`size: <name> <WxH>`,
// full screen being the primary display's work area), and the app target adds one line per
// size × theme asserting the window lies wholly inside that work area:
//   window: <size name> <WxH> <theme> ok|FAIL window WxH at x,y ⊆ workArea WxH at x,y
// The app target adds one more line per size × theme for the search palette, measured open on the
// cockpit screen (⌘K): the panel must sit in the window's centre over a scrim that covers the
// window and blurs what is behind it, the empty standing must show the input row alone, a typed
// standing must grow the body under it, and the history standing (an opened query remembered,
// then Temizle) must grow under its head and collapse back to the input alone:
//   palette: kokpit <WxH> <theme> ok|FAIL <detail>
// and one for the settings panel, opened once through the sidebar's gear: the panel must sit
// centred and wholly inside the window at its min() size, no control it carries may reach past
// the window or the panel's own box (L-3's rule, measured while the panel is up, and the same
// containment walked again on the two sections the nav rows open — Telefon, Güncelleme):
//   settings: kokpit <WxH> <theme> ok|FAIL <detail>
// and one for the title bar's Update button (U-24), measured on the cockpit: 40px bar, wordmark
// at the left, the button 28px at the bar's right end and outside the drag region; the first
// combo of the run also walks the button's states — apply, a disabled percent, then the restart
// label:
//   titlebar: kokpit <WxH> <theme> ok|FAIL <detail>
// A second, fake-free launch closes the loop once per run: with the noop checker the button
// must be absent from the bar and the Güncelleme section must read "Docket güncel.":
//   titlebar-plain: ok|FAIL <detail>
// Exit code is 1 when any line is FAIL.
//
// Two targets share the same rules and differ only in their selector map:
//   --target=prototype <path/to/index.html>  the frozen rev-8 prototype in Chromium (file://)
//   (default)                                 the built Electron app, window resized in main
//
// The app run needs the design seed (e2e/seed-design.ts) and the host lock: another agent may be
// running Electron on this machine, and parallel launches starve each other.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';
import { ROOT, launchDesignApp, screenNavigator, seedDesign, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { runRules, RULE_IDS, resolveSizes, sizesForWorkArea, THEMES, SCREENS } from './layout-rules.mjs';

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
// search palette's panel, scrim, body and history head, the settings panel's panel and scrim,
// and the title bar with its state-driven Update button (U-24).
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
  titleBar: '[data-title-bar]',
  updateButton: '[data-update-button]',
  settingsUpdate: '[data-settings-update]',
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
    // The prototype is frozen: a Chromium viewport has no display to read, so the plan resolves
    // against the 1920x1080 area the rev-8 references were drawn for.
    sizes: sizesForWorkArea({ width: 1920, height: 1080 }),
    close: () => browser.close(),
    async show(screen, theme, { size: [w, h] }) {
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

/** The settings panel's own measurement: the nav's Ayarlar row opens it over the cockpit. The
 *  panel must sit centred and wholly inside the window at its min() size (the 1024×640 minimum
 *  fits it by construction), over a scrim that covers the window and blurs what is behind it,
 *  and no control it carries may reach past the window or the panel's own box (L-3's rule,
 *  measured while the panel is up, then walked again on the Telefon and Güncelleme sections).
 *  The panel eases in with the palette's motion numbers, so the measurement waits for the
 *  running transition to settle. Esc closes it again. */
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

  // The nav's Ayarlar row is the panel's door; its accessible name is its visible label.
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
  // The two sections the nav's rows open (U-24) get the same containment walk as the default
  // section, plus their own honest content: the phone section's "not linked" standing with its
  // disabled pair action, the Güncelleme section's version line, status and check action.
  const sectionOutside = async () =>
    page.evaluate((panelSel) => {
      const panel = document.querySelector(panelSel);
      if (panel === null) return null;
      const r = panel.getBoundingClientRect();
      const visible = (el) => {
        const b = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const outside = [];
      for (const el of panel.querySelectorAll('button, input, select, textarea')) {
        if (!visible(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) {
          outside.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24));
        }
      }
      return outside;
    }, selectors.settingsPanel);
  const inPanel = (text) => page.locator(selectors.settingsPanel).getByText(text).first();
  const menuButton = (name) =>
    page.locator(selectors.settingsPanel).getByRole('button', { name, exact: true }).first();
  await menuButton('Telefon').click({ timeout: 4000 });
  await inPanel('Telefon bağlı değil').waitFor({ state: 'visible', timeout: 4000 });
  const pairDisabled = await page
    .locator(selectors.settingsPanel)
    .getByRole('button', { name: 'Eşleştir', exact: true })
    .first()
    .isDisabled();
  await inPanel('Yakında').waitFor({ state: 'visible', timeout: 4000 });
  const phoneOutside = await sectionOutside();
  await menuButton('Güncelleme').click({ timeout: 4000 });
  await inPanel('Şimdi kontrol et').waitFor({ state: 'visible', timeout: 4000 });
  await inPanel('Sürüm').waitFor({ state: 'visible', timeout: 4000 });
  const updateOutside = await sectionOutside();
  await page.keyboard.press('Escape');
  await page.locator(selectors.settingsPanel).waitFor({ state: 'detached', timeout: 4000 });
  if (m === null) return { ok: false, detail: 'settings panel elements not found' };
  if (phoneOutside === null || updateOutside === null) {
    return { ok: false, detail: 'a section walk lost the panel' };
  }
  const dx = Math.abs(m.cx - m.iw / 2);
  const dy = Math.abs(m.cy - m.ih / 2);
  const wantW = Math.min(880, m.iw - 64);
  const wantH = Math.min(580, m.ih - 64);
  const inside = m.left >= -0.5 && m.top >= -0.5 && m.right <= m.iw + 0.5 && m.bottom <= m.ih + 0.5;
  const sized = Math.abs(m.w - wantW) <= 0.5 && Math.abs(m.h - wantH) <= 0.5;
  const ok =
    dx <= 0.5 &&
    dy <= 0.5 &&
    inside &&
    sized &&
    m.covers &&
    m.blurs &&
    m.outside.length === 0 &&
    pairDisabled &&
    phoneOutside.length === 0 &&
    updateOutside.length === 0;
  return {
    ok,
    detail: `centre +${dx.toFixed(1)}/+${dy.toFixed(1)} panel ${Math.round(m.w)}x${Math.round(m.h)} want ${wantW}x${wantH} ${
      inside ? 'inside' : 'overflows the window'
    } controls ${m.outside.length === 0 ? 'contained' : `${m.outside.length} outside: ${m.outside.slice(0, 3).join('; ')}`} pair ${
      pairDisabled ? 'disabled' : 'ENABLED'
    } sections ${phoneOutside.length + updateOutside.length === 0 ? 'contained' : `${phoneOutside.length + updateOutside.length} outside`} scrim ${
      m.covers ? 'covers' : 'gaps'
    } blur ${m.blurs ? 'yes' : 'no'}`,
  };
}

/** The title bar's Update button (U-24): the bar stays a 40px strip with the wordmark at its
 *  left, and the button — the design seed fakes an available update, so it is up — sits 28px
 *  tall at the bar's right end, clear of the drag region. With `walk`, the button is also driven
 *  through its standings once per run: apply turns the label into a disabled percent, and the
 *  download's end turns it into the restart label. The ready click is left alone — it is the
 *  restart itself. */
async function titleBarCheck(target, walk) {
  const { page, selectors } = target;
  const m = await page.evaluate(
    ([barSel, btnSel]) => {
      const bar = document.querySelector(barSel);
      const btn = document.querySelector(btnSel);
      if (bar === null) return null;
      const r = bar.getBoundingClientRect();
      const wordmark = [...bar.children].find((el) => (el.textContent ?? '') === 'Docket') ?? null;
      const b = btn ? btn.getBoundingClientRect() : null;
      const cs = btn ? getComputedStyle(btn) : null;
      return {
        h: r.height,
        top: r.top,
        right: r.right,
        wordmarkLeft: wordmark ? wordmark.getBoundingClientRect().left : null,
        btn:
          b === null
            ? null
            : {
                top: b.top,
                bottom: b.bottom,
                right: b.right,
                h: b.height,
                noDrag: cs.webkitAppRegion ?? cs.getPropertyValue('-webkit-app-region'),
              },
      };
    },
    [selectors.titleBar, selectors.updateButton],
  );
  let walkNote = 'not walked';
  if (walk && m !== null && m.btn !== null) {
    const label = () =>
      page.evaluate((btnSel) => document.querySelector(btnSel)?.textContent.trim() ?? '', selectors.updateButton);
    await page.click(selectors.updateButton);
    // The percent standings are the walk's middle — any of them proves the disabled download.
    await page.waitForFunction(
      (btnSel) => {
        const btn = document.querySelector(btnSel);
        return btn !== null && btn.disabled && /^%\d+$/.test((btn.textContent ?? '').trim());
      },
      selectors.updateButton,
      { timeout: 10_000 },
    );
    const percent = await label();
    await page.waitForFunction(
      (btnSel) => {
        const btn = document.querySelector(btnSel);
        return btn !== null && !btn.disabled && (btn.textContent ?? '').trim() === 'Yeniden başlat';
      },
      selectors.updateButton,
      { timeout: 10_000 },
    );
    walkNote = `walked ${percent} → Yeniden başlat`;
  }
  if (m === null) return { ok: false, detail: 'title bar not found' };
  if (m.btn === null) return { ok: false, detail: 'update button not found (the seed fakes one)' };
  const heightOk = Math.abs(m.h - 40) <= 0.5;
  const wordmarkOk = m.wordmarkLeft !== null && m.wordmarkLeft > 0 && m.wordmarkLeft < 200;
  const btnHeightOk = Math.abs(m.btn.h - 28) <= 0.5;
  const inBar = m.btn.top >= m.top - 0.5 && m.btn.bottom <= m.top + m.h + 0.5 && m.btn.right <= m.right + 0.5;
  const ok = heightOk && wordmarkOk && btnHeightOk && inBar && m.btn.noDrag === 'no-drag';
  return {
    ok,
    detail: `bar ${m.h.toFixed(0)}px wordmark ${m.wordmarkLeft === null ? 'missing' : m.wordmarkLeft.toFixed(0)}px button ${m.btn.h.toFixed(0)}px ${
      inBar ? 'in the bar' : 'outside the bar'
    } drag ${m.btn.noDrag} ${walkNote}`,
  };
}

/** The without-standing of the Update button (U-24): a second launch on its own seed with the
 *  fake update env left out, so the composed checker is the no-op one — the bar must carry no
 *  button at all and the Güncelleme section must read "Docket güncel." with the check action
 *  still offered. */
async function plainTitleBarCheck() {
  const seed = seedDesign();
  // The fake update env is deleted, not merely absent: a harness run that carries it in its own
  // environment would otherwise leak the scripted checker into the "without" measurement.
  const env = { ...process.env, DOCKET_DATA_DIR: seed.dataDir, DOCKET_OPENCODE_BIN: seed.agentBin };
  delete env.DOCKET_UPDATE_FAKE;
  const app = await electron.launch({ args: [join(ROOT, 'dist-electron', 'main.js')], env });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('nav', { timeout: 30_000 });
    const bar = await page.evaluate(() => {
      const el = document.querySelector('[data-title-bar]');
      if (el === null) return null;
      return { h: el.getBoundingClientRect().height, buttons: el.querySelectorAll('[data-update-button]').length };
    });
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).first().click({ timeout: 4000 });
    await page.waitForSelector('[data-settings-panel]', { timeout: 4000 });
    await page
      .locator('[data-settings-panel]')
      .getByRole('button', { name: 'Güncelleme', exact: true })
      .first()
      .click({ timeout: 4000 });
    await page.locator('[data-settings-panel]').getByText('Docket güncel.').first().waitFor({ state: 'visible', timeout: 4000 });
    const check = await page
      .locator('[data-settings-panel]')
      .getByRole('button', { name: 'Şimdi kontrol et', exact: true })
      .first()
      .isEnabled();
    await page.keyboard.press('Escape');
    if (bar === null) return { ok: false, detail: 'title bar not found' };
    const ok = Math.abs(bar.h - 40) <= 0.5 && bar.buttons === 0 && check;
    return {
      ok,
      detail: `bar ${bar.h.toFixed(0)}px button ${bar.buttons} (want 0) section ${
        check ? 'offers the check' : 'check unreachable'
      }`,
    };
  } finally {
    await app.close();
  }
}

// --- app target --------------------------------------------------------------------------------------
async function openApp() {
  await acquireE2eLock(ROOT);
  const handle = await launchDesignApp();
  const { page } = handle;
  const goto = screenNavigator(page);
  // The plan resolves once per run, against the app's own primary display — the real numbers the
  // labels then carry.
  const sizes = await resolveSizes(handle.app);
  return {
    selectors: APP_SELECTORS,
    page,
    sizes,
    close: () => handle.app.close(),
    async show(screen, theme, { size }) {
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
    /** The guarantee behind every combination: the window's bounds lie wholly inside the primary
     *  display's work area. Both rectangles are read in the main process, where they live. */
    async windowCheck() {
      const m = await handle.app.evaluate(({ BrowserWindow, screen }) => {
        const b = BrowserWindow.getAllWindows()[0].getBounds();
        const a = screen.getPrimaryDisplay().workArea;
        return {
          bx: b.x, by: b.y, bw: b.width, bh: b.height,
          ax: a.x, ay: a.y, aw: a.width, ah: a.height,
        };
      });
      const inside =
        m.bx >= m.ax && m.by >= m.ay && m.bx + m.bw <= m.ax + m.aw && m.by + m.bh <= m.ay + m.ah;
      return {
        ok: inside,
        detail: `window ${m.bw}x${m.bh} at ${m.bx},${m.by} ${inside ? '⊆' : '⊄'} workArea ${m.aw}x${m.ah} at ${m.ax},${m.ay}`,
      };
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

// The plan's real numbers, printed once so every later label can be read against them.
for (const { name, size } of target.sizes) console.log(`size: ${name} ${size[0]}x${size[1]}`);

let failures = 0;
let lines = 0;
// The Update button's state walk runs once per run — the first cockpit combo carries it.
let walkedUpdate = false;
for (const theme of THEMES) {
  for (const entry of target.sizes) {
    for (const screen of SCREENS) {
      const { name: sizeName, size } = entry;
      const [width, height] = size;
      const label = `${screen} ${width}x${height} ${theme}`;
      let results;
      try {
        await target.show(screen, theme, entry);
        results = await runRules(target.page, { screen, width, height, theme, sizeName }, target.selectors);
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
      // The window's own containment is asserted once per size × theme, on the first screen of
      // the size: it must lie wholly inside the primary display's work area.
      if (screen === 'kokpit' && target.windowCheck !== undefined) {
        let r;
        try {
          r = await target.windowCheck();
        } catch (error) {
          r = { ok: false, detail: `window unreachable: ${String(error).split('\n')[0]}` };
        }
        if (!r.ok) failures += 1;
        lines += 1;
        console.log(`window: ${sizeName} ${width}x${height} ${theme} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      }
      // The palette is measured open once per size × theme, on the cockpit screen; the settings
      // panel is measured the same way, through the nav's Ayarlar row; the title bar's Update
      // button is measured the same way, and the first combo of the run also walks its states.
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
      if (screen === 'kokpit' && target.selectors.titleBar) {
        let r;
        try {
          r = await titleBarCheck(target, !walkedUpdate);
          walkedUpdate = true;
        } catch (error) {
          r = { ok: false, detail: `title bar unreachable: ${String(error).split('\n')[0]}` };
        }
        if (!r.ok) failures += 1;
        lines += 1;
        console.log(`titlebar: ${label} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      }
    }
  }
}
// The without-standing runs once per run, on its own fake-free launch.
if (target.selectors.titleBar) {
  let r;
  try {
    r = await plainTitleBarCheck();
  } catch (error) {
    r = { ok: false, detail: `fake-free launch unreachable: ${String(error).split('\n')[0]}` };
  }
  if (!r.ok) failures += 1;
  lines += 1;
  console.log(`titlebar-plain: ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
}
await target.close();
console.log(`${lines} checks, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
