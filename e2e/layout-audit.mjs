// e2e/layout-audit.mjs — `npm run test:layout`. Runs the L-1 … L-12 rules of e2e/layout-rules.mjs
// for every screen in the run's combinations and prints one line per result:
//   L-n: <screen> <WxH> <theme> ok|FAIL|skipped <detail>
// The run opens by printing the resolved size plan with its real numbers (`size: <name> <WxH>`,
// full screen being the primary display's work area), and the app target adds one line per
// size × theme asserting the window lies wholly inside that work area:
//   window: <size name> <WxH> <theme> ok|FAIL window WxH at x,y ⊆ workArea WxH at x,y
// Every screen × theme also reads its face back from the document after the resize: a walk that
// lost the theme (a reload's boot applying the system scheme) must fail, not measure the same
// theme twice:
//   theme: <screen> <WxH> <theme> ok|FAIL data-theme=<held>, requested <theme>
// The app target adds one more line per size × theme for the search palette, measured open on the
// cockpit screen (⌘K): the panel must sit in the window's centre over a scrim that covers the
// window and blurs what is behind it, the empty standing must show the input row alone, a typed
// standing must grow the body under it, and the history standing (an opened query remembered,
// then Temizle) must grow under its head and collapse back to the input alone:
//   palette: kokpit <WxH> <theme> ok|FAIL <detail>
// and one for the settings panel, opened once through the sidebar's gear: the panel must sit
// centred and wholly inside the window at its min() size, no control it carries may reach past
// the window or the panel's own box (L-3's rule, measured while the panel is up, and the same
// containment walked again on Görünüm and Güncelleme; Telefon is its own window):
//   settings: kokpit <WxH> <theme> ok|FAIL <detail>
// and one for Docket AI's panel (U-120, U-124, U-125), opened through ⌘J: wholly inside the window,
// its right edge aligned with the round button's and sitting above it, no control past the panel's
// box, the focus in the composer on open and back on the button after Esc:
//   chat: kokpit <WxH> <theme> ok|FAIL <detail>
// followed by one for its full-screen reading mode (U-192 … U-198), through Genişlet: the panel
// covers the content area only (the sidebar's right edge, the title bar's bottom, the window's
// right and bottom), the reading column at most 48 rem and centred in the area the rail leaves, no
// horizontal overflow in the feed, the history rail standing exactly from the 64 rem viewport on:
//   chat-full: kokpit <WxH> <theme> ok|FAIL <detail>
// and one for the title bar's Update button (U-24), measured on the cockpit: 40px bar, wordmark
// at the left, the button 28px at the bar's right end, 16px clear of the window's right edge and
// outside the drag region; the first combo of the run also walks the button's states — apply, a
// disabled percent, then the restart label:
//   titlebar: kokpit <WxH> <theme> ok|FAIL <detail>
// A second, fake-free launch closes the loop once per run: with the noop checker the button
// must be absent from the bar and the Güncelleme section must read "Docket güncel.":
//   titlebar-plain: ok|FAIL <detail>
// The attention cards walk once per run after the combos (U-62), at the three fixed widths
// 1024/1280/1512 clamped to the work area: every project line clamps at two lines, no card
// overflows, the cards of one row keep one height:
//   attention: kokpit <WxH> ok|FAIL <detail>
// The page viewer walks the same three fixed widths in both themes (U-75 … U-82), once per run
// after the combos: the seeded page of İE-0033 opens from its work order's Sayfalar row, and the
// measured standing is the latest version in Önizleme — no horizontal overflow on the document or
// the main column, the header's controls level on their row, the stage box (the native view's
// reserved rectangle, never the view itself) inside the main column at its reserved minimum, the
// comments rail below the stage while the main container sits under its two-column floor and
// beside it above, no text clipped without its ellipsis, and the rail honest about what it holds
// (both delivery states, the pending chip, the two versions):
//   page: sayfa <WxH> <theme> ok|FAIL <detail>
// The work-order detail walks its own pass (U-239, #972) after the page viewer's, once per run:
// the four named sizes (1024×640, 1152×720, 1280×800, 1512×982, clamped to the work area) in
// both themes — no horizontal page scroll, strip segments disjoint, stacked cards on the 12 px
// token — and the two decision standings U-239 names at the default window: the approval's and
// the live permission ask's actions sit inside the main column, reachable without scrolling:
//   detail: detay <WxH> <theme> ok|FAIL <detail>
// Exit code is 1 when any line is FAIL.
//
// The run walks four combinations by default — dark at every size plus light at the default
// window, the size the operator uses — and prints the count before the first result line;
// `--full` (FULL=1 for the npm script) restores all six, for a release run or after a
// token/theme change. Every default run closes with the loading skeletons' own measurement
// (U-26): a pass on its own launch, handing the app DOCKET_API_DELAY_MS (the design harness's
// own slow mode) so every reply waits and the loading standings stand long enough to measure —
//   skeleton: <screen> ok|FAIL <detail>
// one line per composed screen (kokpit carries the sidebar's tree and account compositions
// with it). The pass cannot share the main launch: under the delay the L rules would read
// mid-load placeholders. `--slow` stays accepted as a no-op alias so older commands keep
// working — the pass it used to switch on is part of every run now.
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
import { chromium } from 'playwright-core';
import { ROOT, launchDesignApp, screenNavigator, seedDesign, setWindow } from './design-app.mjs';
import { SLOW_API_DELAY_MS } from './design-run.mjs';
import { acquireE2eLock } from './lock.mjs';
import { assertProfileIsolated, freshProfile } from './profile.mjs';
import { launchQuietElectron } from './quiet-launch.mjs';
import { appendCheck, beginReport, REPORT_PATH } from './report.mjs';
import {
  comboPlan,
  measureSkeletonHolders,
  measureSkeletons,
  resolveSizes,
  runRules,
  RULE_IDS,
  SCREENS,
  skeletonVerdict,
  THEMES,
} from './layout-rules.mjs';

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
// the title bar with its state-driven Update button (U-24), and the page screen's header, stage,
// reserved stage body and comments rail.
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
  navBack: '[data-nav-back]',
  navForward: '[data-nav-forward]',
  settingsUpdate: '[data-settings-update]',
  settingsPanel: '[data-settings-panel]',
  settingsScrim: '[data-settings-scrim]',
  newWorkOrder: '[data-new-work-order]',
  newWorkOrderScrim: '[data-new-work-order-scrim]',
  phoneWindow: '[data-phone-window]',
  phoneWindowScrim: '[data-phone-window-scrim]',
  chatFab: '[data-chat-fab]',
  chatPanel: '[data-chat-panel]',
  accountMark: '[data-provider-mark]',
  skeleton: '[data-skeleton]',
  attentionCard: '[data-attention-card]',
  attentionLine: '[data-attention-line]',
  pageScreen: '[data-page-screen]',
  pageHeader: '[data-page-header]',
  pageStage: '[data-page-stage]',
  pageStageBody: '[data-page-stage-body]',
  pageRail: '[data-page-rail]',
};

const parseArgs = (argv) => {
  const target = argv.find((a) => a.startsWith('--target='))?.slice('--target='.length) ?? 'app';
  const rest = argv.filter((a) => !a.startsWith('--'));
  return {
    target,
    path: rest[0],
    full: argv.includes('--full') || process.env.FULL === '1',
    // Accepted as a no-op alias (the header says why): parsed so the flag stays known, read by nothing.
    slow: argv.includes('--slow'),
  };
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
 *  measured while the panel is up, then walked again on the Görünüm and Güncelleme sections).
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
      // A control inside the scrolling content pane may lie below the fold (Hesaplar is long);
        // only sideways escape counts there. The pane is the shared Window body — U-43's rework
        // renamed the hook the old panel carried.
        const scrolls = el.closest('[data-window-body]') !== null;
        if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || (!scrolls && (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5))) {
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
  // Görünüm and Güncelleme get the same containment walk as the default section. Telefon is its
  // own window, measured with the new-work-order dialog (U-250), not as a settings tab.
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
        // A control inside the scrolling content pane may lie below the fold (Hesaplar is long);
        // only sideways escape counts there. The pane is the shared Window body — U-43's rework
        // renamed the hook the old panel carried.
        const scrolls = el.closest('[data-window-body]') !== null;
        if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || (!scrolls && (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5))) {
          outside.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24));
        }
      }
      return outside;
    }, selectors.settingsPanel);
  const inPanel = (text) => page.locator(selectors.settingsPanel).getByText(text).first();
  const menuButton = (name) =>
    page.locator(selectors.settingsPanel).getByRole('button', { name, exact: true }).first();
  await menuButton('Görünüm').click({ timeout: 4000 });
  await inPanel('Tema').waitFor({ state: 'visible', timeout: 4000 });
  // Görünüm's choices live in the Listbox's popup (U-41), not as standing buttons anymore:
  // opening the theme list is how the section proves its controls — 'Açık' is an option there.
  await page.locator(selectors.settingsPanel).getByRole('button', { name: /^Tema: / }).first().click({ timeout: 4000 });
  await page
    .locator(selectors.settingsPanel)
    .getByRole('option', { name: 'Açık', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 4000 });
  const appearanceOutside = await sectionOutside();
  // The open popup keeps the panel's Esc for itself (the list stops the key), so this close
  // leaves the panel standing.
  await page.keyboard.press('Escape');
  const menuText = (await page.locator(selectors.settingsPanel).locator('nav').last().textContent()) ?? '';
  await menuButton('Güncelleme').click({ timeout: 4000 });
  await inPanel('Şimdi kontrol et').waitFor({ state: 'visible', timeout: 4000 });
  await inPanel('Sürüm').waitFor({ state: 'visible', timeout: 4000 });
  const updateOutside = await sectionOutside();
  await page.keyboard.press('Escape');
  await page.locator(selectors.settingsPanel).waitFor({ state: 'detached', timeout: 4000 });
  if (m === null) return { ok: false, detail: 'settings panel elements not found' };
  if (updateOutside === null || appearanceOutside === null) {
    return { ok: false, detail: 'a section walk lost the panel' };
  }
  const dx = Math.abs(m.cx - m.iw / 2);
  const dy = Math.abs(m.cy - m.ih / 2);
  // The panel shares the wizard's window (U-46): 1040×680 at most, clamped to the viewport with
  // 48px/96px margins (the frame's max-width/max-height clamps).
  const wantW = Math.min(1040, m.iw - 48);
  const wantH = Math.min(680, m.ih - 96);
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
    !menuText.includes('Telefon') &&
    appearanceOutside.length === 0 &&
    updateOutside.length === 0;
  return {
    ok,
    detail: `centre +${dx.toFixed(1)}/+${dy.toFixed(1)} panel ${Math.round(m.w)}x${Math.round(m.h)} want ${wantW}x${wantH} ${
      inside ? 'inside' : 'overflows the window'
    } controls ${m.outside.length === 0 ? 'contained' : `${m.outside.length} outside: ${m.outside.slice(0, 3).join('; ')}`} menu ${
      menuText.includes('Telefon') ? 'still lists Telefon' : 'no Telefon tab'
    } sections ${updateOutside.length + appearanceOutside.length === 0 ? 'contained' : `${updateOutside.length + appearanceOutside.length} outside`} scrim ${
      m.covers ? 'covers' : 'gaps'
    } blur ${m.blurs ? 'yes' : 'no'}`,
  };
}

/** Both dialogs (U-250) at the audit's 1024×640 and 1152×720 sizes (and the rest of the plan):
 *  the window stays inside the viewport, its actions are visible, and no control overflows it. */
async function dialogWindowsCheck(target) {
  const { page, selectors } = target;
  const settled = (sel) =>
    page.waitForFunction(
      (panelSel) => {
        const panel = document.querySelector(panelSel);
        if (panel === null) return false;
        return parseFloat(getComputedStyle(panel).opacity) > 0.999 && panel.getAnimations().length === 0;
      },
      sel,
      { timeout: 4000 },
    );
  const measure = (panelSel) =>
    page.evaluate((sel) => {
      const panel = document.querySelector(sel);
      if (panel === null) return null;
      const r = panel.getBoundingClientRect();
      const visible = (el) => {
        const b = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const outside = [];
      const actions = [];
      for (const el of panel.querySelectorAll('button, input, select, textarea')) {
        if (!visible(el)) continue;
        const b = el.getBoundingClientRect();
        const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
        const scrolls = el.closest('[data-window-body]') !== null;
        if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || (!scrolls && (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5))) {
          outside.push(name);
        }
        const inView = b.bottom <= innerHeight + 0.5 && b.top >= -0.5 && b.width > 0 && b.height > 0;
        actions.push({ name, inView });
      }
      return {
        inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
        outside,
        actions,
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }, panelSel);

  await page.getByRole('button', { name: '+ Yeni iş emri', exact: true }).first().click({ timeout: 4000 });
  await page.waitForSelector(selectors.newWorkOrder, { timeout: 4000 });
  await settled(selectors.newWorkOrder);
  const work = await measure(selectors.newWorkOrder);
  const workActions = work === null ? [] : work.actions.map((action) => action.name);
  const workVisible =
    work !== null &&
    ['Aç', 'Vazgeç'].every((name) => work.actions.some((action) => action.name.includes(name) && action.inView)) &&
    work.actions.some((action) => action.name.includes('Tarif et') && action.inView);
  await page.keyboard.press('Escape');
  await page.locator(selectors.newWorkOrder).waitFor({ state: 'detached', timeout: 4000 });

  await page.getByRole('button', { name: 'Telefon', exact: true }).first().click({ timeout: 4000 });
  await page.waitForSelector(selectors.phoneWindow, { timeout: 4000 });
  await settled(selectors.phoneWindow);
  const phoneBox = page.locator(selectors.phoneWindow);
  await phoneBox.getByText('Telefon bağlı değil').waitFor({ state: 'visible', timeout: 4000 });
  await phoneBox.getByText('Yakında').waitFor({ state: 'visible', timeout: 4000 });
  const pairDisabled = await phoneBox.getByRole('button', { name: 'Eşleştir', exact: true }).first().isDisabled();
  const phone = await measure(selectors.phoneWindow);
  await page.keyboard.press('Escape');
  await page.locator(selectors.phoneWindow).waitFor({ state: 'detached', timeout: 4000 });

  if (work === null || phone === null) return { ok: false, detail: 'a dialog was not on screen' };
  const ok = work.inside && work.outside.length === 0 && workVisible && phone.inside && phone.outside.length === 0 && pairDisabled;
  return {
    ok,
    detail: `1024×640 and 1152×720 (this pass ${work.w}x${work.h} / ${phone.w}x${phone.h}) work ${
      work.inside && work.outside.length === 0 ? 'contained' : `overflow ${work.outside.slice(0, 3).join('; ')}`
    } actions ${workVisible ? workActions.slice(0, 4).join(', ') : 'missing'} phone ${
      phone.inside && phone.outside.length === 0 ? 'contained' : `overflow ${phone.outside.slice(0, 3).join('; ')}`
    } pair ${pairDisabled ? 'disabled' : 'ENABLED'}`,
  };
}

/** Docket AI's panel (U-120, U-124, U-125), measured open on the cockpit through ⌘J: the panel sits
 *  wholly inside the window, grows out of the round button — its right edge aligned with the
 *  button's, its bottom a gap above the button's top, never covering it — and no control it carries
 *  reaches past its box (L-3's rule, judged against the panel itself, the scrolling feed excepted
 *  below the fold). The composer takes the focus on open; the closed panel is inert and takes none;
 *  Esc closes it and hands the focus back to the button. The panel eases open (280ms), so the
 *  measurement waits for the running transition to settle instead of sleeping. */
async function chatPanelCheck(target) {
  const { page, selectors } = target;
  const settled = () =>
    page.waitForFunction(
      (sel) => {
        const panel = document.querySelector(sel);
        if (panel === null || panel.hasAttribute('inert')) return false;
        return parseFloat(getComputedStyle(panel).opacity) > 0.999 && panel.getAnimations().length === 0;
      },
      selectors.chatPanel,
      { timeout: 4000 },
    );
  const closed = () =>
    page.waitForFunction((sel) => document.querySelector(sel)?.hasAttribute('inert') === true, selectors.chatPanel, { timeout: 4000 });

  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+J`);
  await settled();
  const m = await page.evaluate(([panelSel, fabSel]) => {
    const panel = document.querySelector(panelSel);
    const fab = document.querySelector(fabSel);
    if (panel === null || fab === null) return null;
    const r = panel.getBoundingClientRect();
    const f = fab.getBoundingClientRect();
    const visible = (el) => {
      const b = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const outside = [];
    for (const el of panel.querySelectorAll('button, input, select, textarea')) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      // The feed scrolls: a control below its fold is not an escape, only a sideways one is.
      const scrolls = el.closest('[data-chat-feed], [data-chat-history]') !== null;
      if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || (!scrolls && (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5))) {
        outside.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24));
      }
    }
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      fabTop: f.top,
      fabRight: f.right,
      iw: innerWidth,
      ih: innerHeight,
      expanded: fab.getAttribute('aria-expanded'),
      focusInText: document.activeElement?.hasAttribute('data-chat-text') === true,
      outside,
    };
  }, [selectors.chatPanel, selectors.chatFab]);
  await page.keyboard.press('Escape');
  await closed();
  const focusBack = await page.evaluate(() => document.activeElement?.hasAttribute('data-chat-fab') === true);
  if (m === null) return { ok: false, detail: 'chat panel elements not found' };
  const inside = m.left >= -0.5 && m.top >= -0.5 && m.right <= m.iw + 0.5 && m.bottom <= m.ih + 0.5;
  const aligned = Math.abs(m.right - m.fabRight) <= 1;
  const above = m.bottom <= m.fabTop + 0.5;
  const ok = inside && aligned && above && m.expanded === 'true' && m.focusInText && m.outside.length === 0 && focusBack;
  return {
    ok,
    detail: `panel ${Math.round(m.right - m.left)}x${Math.round(m.bottom - m.top)} ${inside ? 'inside' : 'overflows the window'} right ${
      aligned ? 'aligned' : 'OFF'
    } with the button ${above ? 'above it' : 'COVERS it'} controls ${m.outside.length === 0 ? 'contained' : `${m.outside.length} outside: ${m.outside.slice(0, 3).join('; ')}`} focus ${
      m.focusInText ? 'composer' : 'LOST'
    } esc ${focusBack ? 'returns it to the button' : 'DROPS it'}`,
  };
}

/** Docket AI's full-screen reading mode (U-192 … U-198), measured right after the panel's own
 *  check on the same screen: Genişlet must cover the content area only — from the sidebar's own
 *  right edge to the window's right, from the title bar's own bottom to the window's bottom —
 *  centre a reading column at most 48 rem wide inside the area the rail leaves, keep the feed free
 *  of horizontal overflow, and stand the history rail exactly from the 64 rem viewport on (15 rem
 *  wide, the reading area beginning at its right edge). Esc leaves the full mode and then closes
 *  the panel, so the walk hands the next check the same closed standing the panel's own walk did. */
async function chatFullCheck(target) {
  const { page, selectors } = target;
  const settled = () =>
    page.waitForFunction(
      (sel) => {
        const panel = document.querySelector(sel);
        if (panel === null || panel.hasAttribute('inert')) return false;
        return parseFloat(getComputedStyle(panel).opacity) > 0.999 && panel.getAnimations().length === 0;
      },
      selectors.chatPanel,
      { timeout: 4000 },
    );
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+J`);
  await settled();
  await page.locator('[data-chat-expand]').click({ timeout: 4000 });
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.hasAttribute('data-chat-full') === true,
    selectors.chatPanel,
    { timeout: 4000 },
  );
  await settled();
  const m = await page.evaluate((panelSel) => {
    const panel = document.querySelector(panelSel);
    if (panel === null) return null;
    const rail = panel.querySelector('[data-chat-rail]');
    const feed = panel.querySelector('[data-chat-feed]');
    const nav = document.querySelector('nav[aria-label]');
    const bar = document.querySelector('[data-title-bar]');
    if (feed === null || nav === null || bar === null) return null;
    const r = panel.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const railBox = rail === null ? null : rail.getBoundingClientRect();
    const column = feed.firstElementChild;
    const col = column === null ? null : column.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      navRight: n.right,
      barBottom: b.bottom,
      iw: innerWidth,
      ih: innerHeight,
      feedOverflow: feed.scrollWidth - feed.clientWidth,
      colW: col === null ? 0 : col.width,
      colCentre: col === null ? 0 : (col.left + col.right) / 2,
      areaCentre: ((railBox === null ? r.left : railBox.right) + r.right) / 2,
      railVisible: rail !== null && getComputedStyle(rail).display !== 'none',
      railW: railBox === null ? 0 : railBox.width,
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  }, selectors.chatPanel);
  // Leave the standing closed, the way the walk found it.
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.hasAttribute('data-chat-full') === false,
    selectors.chatPanel,
    { timeout: 4000 },
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => document.querySelector(sel)?.hasAttribute('inert') === true, selectors.chatPanel, { timeout: 4000 });
  if (m === null) return { ok: false, detail: 'full-mode elements not found' };
  const edges =
    Math.abs(m.right - m.iw) <= 1 &&
    Math.abs(m.bottom - m.ih) <= 1 &&
    Math.abs(m.left - m.navRight) <= 1 &&
    Math.abs(m.top - m.barBottom) <= 1;
  const wantRail = m.iw >= 1024;
  const railOk = m.railVisible === wantRail && (!wantRail || Math.abs(m.railW - 15 * m.root) <= 1);
  const columnOk = m.colW > 0 && m.colW <= 48 * m.root + 1 && Math.abs(m.colCentre - m.areaCentre) <= 1;
  const ok = edges && railOk && columnOk && m.feedOverflow <= 0;
  return {
    ok,
    detail: `edges ${edges ? 'content area' : 'misaligned'} rail ${m.railVisible ? 'on' : 'off'}${wantRail ? '' : ' (window under 64rem)'} column ${Math.round(m.colW)}px ${
      Math.abs(m.colCentre - m.areaCentre) <= 1 ? 'centred' : 'OFF-centre'
    } overflow ${m.feedOverflow <= 0 ? 'none' : `${Math.round(m.feedOverflow)}px`}`,
  };
}

/** The title bar's Update button (U-24) and history chevrons (U-25): the bar stays a 40px strip
 *  with the wordmark at its left, and the button — the design seed fakes an available update, so
 *  it is up — sits 28px tall at the bar's right end, 16px clear of the window's right edge (the
 *  bar's own padding, so the gap belongs to the bar, not the button), outside the drag region.
 *  The two history chevrons sit on the bar's left half, 12px after the wordmark, 28×28, both
 *  no-drag. With `walk`, the button is also driven through its standings once per run: apply
 *  turns the label into a disabled percent, and the download's end turns it into the restart
 *  label. The ready click is left alone — it is the restart itself. */
async function titleBarCheck(target, walk) {
  const { page, selectors } = target;
  const m = await page.evaluate(
    ([barSel, btnSel, backSel, forwardSel]) => {
      const bar = document.querySelector(barSel);
      const btn = document.querySelector(btnSel);
      if (bar === null) return null;
      const r = bar.getBoundingClientRect();
      const wordmark = [...bar.children].find((el) => (el.textContent ?? '') === 'Docket') ?? null;
      const b = btn ? btn.getBoundingClientRect() : null;
      const cs = btn ? getComputedStyle(btn) : null;
      const navBtn = (sel) => {
        const el = sel === null ? null : document.querySelector(sel);
        if (el === null) return null;
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          left: box.left,
          top: box.top,
          bottom: box.bottom,
          w: box.width,
          h: box.height,
          noDrag: style.webkitAppRegion ?? style.getPropertyValue('-webkit-app-region'),
        };
      };
      return {
        h: r.height,
        top: r.top,
        right: r.right,
        leftHalf: r.left + r.width / 2,
        windowRight: window.innerWidth,
        wordmarkLeft: wordmark ? wordmark.getBoundingClientRect().left : null,
        wordmarkRight: wordmark ? wordmark.getBoundingClientRect().right : null,
        navBack: navBtn(backSel),
        navForward: navBtn(forwardSel),
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
    [selectors.titleBar, selectors.updateButton, selectors.navBack ?? null, selectors.navForward ?? null],
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
  const rightGap = m.windowRight - m.btn.right;
  const gapOk = Math.abs(rightGap - 16) <= 1;
  // The history pair (U-25): both 28×28, inside the bar, on the bar's left half after the
  // wordmark, back leading forward, each 12px (wordmark→back) or 8px (back→forward) apart, no-drag.
  const navMeasured = m.navBack !== null && m.navForward !== null;
  const navOk = !navMeasured
    ? false
    : Math.abs(m.navBack.w - 28) <= 0.5 &&
      Math.abs(m.navBack.h - 28) <= 0.5 &&
      Math.abs(m.navForward.w - 28) <= 0.5 &&
      Math.abs(m.navForward.h - 28) <= 0.5 &&
      m.navBack.top >= m.top - 0.5 &&
      m.navBack.bottom <= m.top + m.h + 0.5 &&
      m.navForward.top >= m.top - 0.5 &&
      m.navForward.bottom <= m.top + m.h + 0.5 &&
      m.navBack.left > (m.wordmarkRight ?? Infinity) &&
      m.navForward.left > m.navBack.left &&
      m.navForward.left < m.leftHalf &&
      Math.abs(m.navBack.left - (m.wordmarkRight ?? -Infinity) - 12) <= 0.5 &&
      m.navBack.noDrag === 'no-drag' &&
      m.navForward.noDrag === 'no-drag';
  const navNote = !navMeasured
    ? 'nav chevrons not found'
    : `nav ${m.navBack.h.toFixed(0)}px ${navOk ? 'after the wordmark' : 'misplaced'} gap ${(
        m.navBack.left - (m.wordmarkRight ?? NaN)
      ).toFixed(1)}px drag ${m.navBack.noDrag}/${m.navForward.noDrag}`;
  const ok = heightOk && wordmarkOk && btnHeightOk && inBar && gapOk && m.btn.noDrag === 'no-drag' && navOk;
  return {
    ok,
    detail: `bar ${m.h.toFixed(0)}px wordmark ${m.wordmarkLeft === null ? 'missing' : m.wordmarkLeft.toFixed(0)}px button ${m.btn.h.toFixed(0)}px ${
      inBar ? 'in the bar' : 'outside the bar'
    } right gap ${rightGap.toFixed(1)}px ${gapOk ? '(want 16)' : '(want 16, off)'} drag ${m.btn.noDrag} ${navNote} ${walkNote}`,
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
  // Its own throwaway profile too: this second launch must not see the main walk's persisted UI
  // settings (the audit's Liste screen leaves the board's view choice behind).
  const profile = freshProfile();
  const app = await launchQuietElectron({ args: [...profile.args, join(ROOT, 'dist-electron', 'main.js')], env });
  await assertProfileIsolated(app, profile.dir);
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
/** The screen walk both launches share: resize, theme, navigate, settle. The board's view choice
 *  persists per repo (U-18), so an earlier `liste` measurement would otherwise leave the Kanban
 *  hidden for a later `pano` — every screen enters from its own standing. */
function makeShow(handle) {
  const { page } = handle;
  const goto = screenNavigator(page);
  return async (screen, theme, { size }) => {
    await setWindow(handle, size, theme);
    await goto[screen]();
    if (screen === 'pano') {
      await page.getByRole('button', { name: 'Kanban' }).first().click({ timeout: 1500 });
    }
    await page.waitForTimeout(450);
  };
}

async function openApp() {
  await acquireE2eLock(ROOT);
  const handle = await launchDesignApp();
  // The plan resolves once per run, against the app's own primary display — the real numbers the
  // labels then carry.
  const sizes = await resolveSizes(handle.app);
  return {
    selectors: APP_SELECTORS,
    page: handle.page,
    sizes,
    close: () => handle.app.close(),
    show: makeShow(handle),
    // The seed manifest: the page walk reads the page's id and its order's derived code from the
    // world it is measuring, never from a typed literal.
    seed: handle.seed,
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
    /** The primary display's work area, for the checks that pick their own sizes. */
    async workArea() {
      return handle.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    },
  };
}

/** The loading skeletons' own measurement (U-26), one screen at a time in the run's skeleton
 *  pass: the screen is reached once (so the window is sized and the board's Kanban/Liste
 *  standing is the one to replay), then the page reloads so the boot loads replay under the
 *  delay (the cockpit with the sidebar's tree and account compositions beside it), and a board
 *  screen navigates after the
 *  boot content has landed so its own load replays. Each pass measures the compositions while
 *  they are up, waits the delayed replies out, and measures the holders again — the verdict
 *  compares the two. The cockpit's fold memory is cleared first: the ready sections must stand
 *  open, exactly as the composition draws them. */
async function skeletonCheck(target, screen, combo) {
  const { page } = target;
  if (combo !== undefined) await target.show(screen, combo.theme, combo.size);
  await page.evaluate(() => localStorage.removeItem('docket.cockpit.collapsed'));
  await page.reload();
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, 'dark');
  // The accounts frame starts collapsed (U-16) and its composition is part of this pass: open
  // it and let its fold settle — the holder must be measured still, mid-animation.
  const collapsed = await page
    .locator('[data-accounts-body]')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height <= 1)
    .catch(() => false);
  if (collapsed) {
    await page.getByRole('button', { name: 'Hesapları gizle / göster' }).first().click({ timeout: 4000 });
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (el === null) return false;
        return el.getBoundingClientRect().height > 1 && el.getAnimations().length === 0;
      },
      '[data-accounts-body]',
      { timeout: 4000 },
    );
  }
  if (screen !== 'kokpit') {
    // The boot content lands first; the board's own load is the one this pass catches.
    await page.waitForFunction(() => document.querySelectorAll('[data-skeleton]').length === 0, null, { timeout: 15_000 });
    const goto = screenNavigator(page);
    await goto.pano();
  }
  await page.waitForSelector('[data-skeleton]', { timeout: 5000 });
  const before = await measureSkeletons(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-skeleton]').length === 0, null, { timeout: 15_000 });
  const after = await measureSkeletonHolders(page);
  return skeletonVerdict(before, after);
}

/** The skeleton pass's own launch: the delay must sit in the environment before the app inherits
 *  it, and the main run's fast launch would leave no loading standing to measure. The host lock
 *  is the run's, taken once for the main launch — no second acquisition here. */
async function skeletonPass() {
  const priorDelay = process.env.DOCKET_API_DELAY_MS;
  process.env.DOCKET_API_DELAY_MS = String(SLOW_API_DELAY_MS);
  let handle;
  try {
    handle = await launchDesignApp();
  } finally {
    if (priorDelay === undefined) delete process.env.DOCKET_API_DELAY_MS;
    else process.env.DOCKET_API_DELAY_MS = priorDelay;
  }
  const sizes = await resolveSizes(handle.app);
  const target = { page: handle.page, selectors: APP_SELECTORS, show: makeShow(handle) };
  const combo = comboPlan(sizes).find((c) => c.size.name === 'default' && c.theme === 'dark');
  const rows = [];
  try {
    for (const screen of ['kokpit', 'pano', 'liste']) {
      try {
        rows.push({ screen, ...(await skeletonCheck(target, screen, combo)) });
      } catch (error) {
        rows.push({
          screen,
          ok: false,
          detail: `skeleton pass unreachable: ${String(error).split('\n').slice(0, 4).join(' | ')}`,
        });
      }
    }
  } finally {
    await handle.app.close();
  }
  return rows;
}

/** The accounts frame's opened cards must be seen, not merely mounted (U-26): a card's computed
 *  opacity, multiplied up its ancestors to the frame body, must be 1 — a content wrapper left at
 *  opacity 0 keeps the cards in the DOM, clickable and unseen, which no geometry rule notices. */
async function accountsOpacityCheck(target) {
  const { page } = target;
  await page.waitForSelector('nav', { timeout: 30_000 });
  const body = page.locator('[data-accounts-body]').first();
  const collapsed = await body.evaluate((el) => el.getBoundingClientRect().height <= 1).catch(() => false);
  if (collapsed) {
    await page.getByRole('button', { name: 'Hesapları gizle / göster' }).first().click({ timeout: 4000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-accounts-body]');
        return el !== null && el.getBoundingClientRect().height > 1 && el.getAnimations().length === 0;
      },
      null,
      { timeout: 4000 },
    );
  }
  // Let a reveal's rise and fade settle; both are well under this.
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => {
    const frameBody = document.querySelector('[data-accounts-body]');
    const card = frameBody?.querySelector('[data-provider-mark]');
    if (!frameBody || !card) return null;
    let opacity = 1;
    for (let el = card; el !== null && el !== frameBody.parentElement; el = el.parentElement) {
      opacity *= Number(getComputedStyle(el).opacity);
    }
    return opacity;
  });
  if (seen === null) return { ok: true, detail: 'no account cards to see' };
  return { ok: seen === 1, detail: seen === 1 ? 'account cards are fully visible' : `account card opacity ${seen}, not 1` };
}

/** The attention cards' own measurement (U-62, with U-55's dated amendment), once per run on the
 *  app target after the combos: at three fixed widths — the 1024 minimum, 1280, and the 1512
 *  reference — every cockpit attention card's project line wraps and clamps at two lines (never
 *  a single-line truncate), no card overflows its own box or the main column's right edge, and
 *  the cards of one grid row keep one height whether their names wrap or not (the ask band's
 *  card is exempt — taller by its own band, not by its name). The widths are clamped to the work
 *  area and deduped, so a display that cannot hold 1280 or 1512 walks the widths it can. */
const ATTENTION_WIDTHS = [1024, 1280, 1512];

async function attentionCardsCheck(target) {
  const { page, selectors } = target;
  const area = await target.workArea();
  const widths = [...new Set(ATTENTION_WIDTHS.map((w) => Math.min(w, area.width)))];
  const rows = [];
  for (const width of widths) {
    const height = Math.min(720, area.height);
    await target.show('kokpit', 'dark', { size: [width, height] });
    await page.waitForSelector(selectors.attentionCard, { timeout: 10_000 });
    const m = await page.evaluate(
      ([cardSel, lineSel, mainSel]) => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        const main = document.querySelector(mainSel);
        const mainRight = main === null ? null : main.getBoundingClientRect().right;
        const cards = [...document.querySelectorAll(cardSel)].filter(visible);
        return {
          n: cards.length,
          mainRight,
          cards: cards.map((card) => {
            const line = card.querySelector(lineSel);
            const cs = line === null ? null : getComputedStyle(line);
            const r = card.getBoundingClientRect();
            return {
              line: line !== null,
              clamp: cs === null ? '' : cs.webkitLineClamp,
              wraps: cs !== null && cs.whiteSpace === 'normal',
              // Horizontal clip only: the clamp's own vertical cut is the mechanism, not a defect.
              lineClips: line !== null && line.scrollWidth > line.clientWidth + 1,
              cardClips: card.scrollWidth > card.clientWidth + 1 || card.scrollHeight > card.clientHeight + 1,
              pastMain: mainRight !== null && r.right > mainRight + 0.5,
              hasAsk: card.querySelector('code') !== null,
              top: Math.round(r.top),
              h: r.height,
            };
          }),
        };
      },
      [selectors.attentionCard, selectors.attentionLine, selectors.main],
    );
    const failures = [];
    if (m.n === 0) failures.push('no attention cards rendered');
    for (const [i, c] of m.cards.entries()) {
      if (!c.line) failures.push(`card ${i + 1} has no project line`);
      if (c.clamp !== '2') failures.push(`card ${i + 1} clamps at ${c.clamp || 'nothing'}, not 2`);
      if (!c.wraps) failures.push(`card ${i + 1} does not wrap`);
      if (c.lineClips) failures.push(`card ${i + 1} project line clips sideways`);
      if (c.cardClips) failures.push(`card ${i + 1} overflows its box`);
      if (c.pastMain) failures.push(`card ${i + 1} passes the main column`);
    }
    // One height per grid row: the non-ask cards whose tops align must also align their bottoms.
    const level = new Map();
    for (const c of m.cards) {
      if (c.hasAsk) continue;
      const bucket = [...level.keys()].find((t) => Math.abs(t - c.top) <= 1) ?? c.top;
      level.set(bucket, { min: Math.min(level.get(bucket)?.min ?? Infinity, c.h), max: Math.max(level.get(bucket)?.max ?? -Infinity, c.h) });
    }
    for (const [top, { min, max }] of level) {
      if (max - min > 1) failures.push(`the row at y=${top} spans ${min.toFixed(1)}–${max.toFixed(1)}px of card heights`);
    }
    const wrapped = m.cards.filter((c) => c.line).length;
    rows.push({
      ok: failures.length === 0,
      size: `${width}x${height}`,
      detail:
        failures.length === 0
          ? `${m.n} cards, ${wrapped} project lines clamp at 2, no overflow, rows level`
          : failures.slice(0, 3).join('; '),
    });
  }
  return rows;
}

/** The page viewer's own measurement (U-75 … U-82), once per run after the combos at the three
 *  fixed widths, in both themes. The walk opens the seeded page the way a person does — the
 *  board's card for the order that carries it, the order's Sayfalar row — and measures the page
 *  screen's boxes: no horizontal overflow on the document or the main column, the header's
 *  controls level on their row whatever heights they carry, the stage and the native view's
 *  reserved rectangle inside the main column (the view itself is never audited, only its box),
 *  the comments rail below the stage while the main container sits under its two-column floor
 *  and beside it above, and no text clipped without its ellipsis. The rail's honesty pins what
 *  the seed stands for: both delivery states, the pending chip, the two versions. ‹ Geri closes
 *  each standing back to the detail, so every combo starts from a known screen. */
async function pageViewerCheck(target) {
  const { page, selectors } = target;
  const area = await target.workArea();
  const widths = [...new Set(ATTENTION_WIDTHS.map((w) => Math.min(w, area.width)))];
  // The card's code is the derived one: the manifest's number is the order's rank in code order,
  // so the code follows the world, never a typed literal.
  const code = `İE-${String(target.seed.codes['İE-0033'].number).padStart(4, '0')}`;
  const rows = [];
  for (const width of widths) {
    const height = Math.min(720, area.height);
    for (const theme of THEMES) {
      let m = null;
      try {
        await target.show('pano', theme, { size: [width, height] });
        await page.locator('nav button, main button, main a').filter({ hasText: code }).first().click({ timeout: 4000 });
        await page.waitForSelector('[data-pages-section]', { timeout: 10_000 });
        const pageRow = page.locator(`[data-page-row="${target.seed.page.id}"]`).first();
        await pageRow.waitFor({ state: 'visible', timeout: 4000 });
        // The screen stands loading until the page has loaded: the header and the reserved body
        // are the loaded standing's own hooks, so waiting them out is waiting the load out.
        await pageRow.click({ timeout: 4000 });
        await page.waitForSelector(selectors.pageHeader, { state: 'visible', timeout: 10_000 });
        await page.waitForSelector(selectors.pageStageBody, { state: 'visible', timeout: 10_000 });
        await page.waitForTimeout(450);
        m = await page.evaluate(
          ([screenSel, headerSel, stageSel, bodySel, railSel, mainSel]) => {
            const screen = document.querySelector(screenSel);
            const header = document.querySelector(headerSel);
            const stage = document.querySelector(stageSel);
            const body = document.querySelector(bodySel);
            const rail = document.querySelector(railSel);
            const main = document.querySelector(mainSel);
            if (screen === null || header === null || stage === null || body === null || rail === null || main === null) {
              return null;
            }
            const visible = (el) => {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
            };
            // The header's controls fold into visual rows when the header narrows; each row must
            // sit level — one centre line within a pixel, whatever heights the controls carry.
            const controls = [...header.querySelectorAll('button, select')]
              .filter(visible)
              .map((el) => el.getBoundingClientRect())
              .sort((a, b) => a.top - b.top);
            const headerRows = [];
            for (const r of controls) {
              const row = headerRows[headerRows.length - 1];
              if (row !== undefined && r.top <= row.bottom + 0.5) {
                row.bottom = Math.max(row.bottom, r.bottom);
                row.cys.push((r.top + r.bottom) / 2);
              } else {
                headerRows.push({ top: r.top, bottom: r.bottom, cys: [(r.top + r.bottom) / 2] });
              }
            }
            // No text clipped: the shell-wide rule's own reading, scoped to the screen the walk is on.
            const clipped = [];
            for (const el of screen.querySelectorAll('*')) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
              if (own === '' || el.scrollWidth <= el.clientWidth + 1) continue;
              const cs = getComputedStyle(el);
              if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
              if (!(cs.textOverflow === 'ellipsis' && (el.getAttribute('title') || '').includes(own.slice(0, 20)))) {
                clipped.push(own.slice(0, 24));
              }
            }
            const mr = main.getBoundingClientRect();
            const mainLeft = mr.left + main.clientLeft;
            const mainRight = mainLeft + main.clientWidth;
            const within = (r) => r.left >= mainLeft - 0.5 && r.right <= mainRight + 0.5;
            const sr = stage.getBoundingClientRect();
            const br = body.getBoundingClientRect();
            const rr = rail.getBoundingClientRect();
            const mainCs = getComputedStyle(main);
            // The container the screen's collapse breakpoints read is main itself (inline-size),
            // so its content width — padding out, like the query reads it — decides the rail's place.
            const containerW = main.clientWidth - parseFloat(mainCs.paddingLeft) - parseFloat(mainCs.paddingRight);
            const beside = containerW >= 56 * parseFloat(getComputedStyle(document.documentElement).fontSize);
            return {
              docScroll: document.documentElement.scrollWidth,
              iw: innerWidth,
              mainScroll: main.scrollWidth,
              mainClient: main.clientWidth,
              headerRows: headerRows.map((row) => Math.max(...row.cys) - Math.min(...row.cys)),
              headerControls: controls.length,
              stageIn: within(sr),
              bodyIn: within(br),
              railIn: within(rr),
              bodyH: br.height,
              bodyMin: parseFloat(getComputedStyle(body).minHeight) || 0,
              stageTop: sr.top,
              stageBottom: sr.bottom,
              stageRight: sr.right,
              railTop: rr.top,
              railLeft: rr.left,
              containerW,
              beside,
              clipped,
              delivered: rail.querySelectorAll('[data-page-comment][data-delivered="true"]').length,
              undelivered: rail.querySelectorAll('[data-page-comment][data-delivered="false"]').length,
              chip: header.querySelector('[data-page-approval-chip]')?.textContent?.trim() ?? '',
              versions: header.querySelectorAll('[data-page-version] option').length,
            };
          },
          [
            selectors.pageScreen,
            selectors.pageHeader,
            selectors.pageStage,
            selectors.pageStageBody,
            selectors.pageRail,
            selectors.main,
          ],
        );
      } catch (error) {
        rows.push({
          ok: false,
          size: `${width}x${height}`,
          theme,
          detail: `page viewer unreachable: ${String(error).split('\n')[0]}`,
        });
        continue;
      }
      // ‹ Geri is best effort: the row's verdict is the measurement, and the next combo's own
      // navigation starts from wherever the app stands.
      try {
        await page.locator(selectors.pageScreen).getByRole('button', { name: '‹ Geri' }).click({ timeout: 4000 });
        await page.waitForSelector('[data-pages-section]', { timeout: 4000 });
      } catch {
        // stays on the page screen; the next combo navigates home first
      }
      if (m === null) {
        rows.push({ ok: false, size: `${width}x${height}`, theme, detail: 'page screen elements not found' });
        continue;
      }
      const bad = [];
      if (m.docScroll > m.iw) bad.push(`the document scrolls sideways (${m.docScroll} of ${m.iw})`);
      if (m.mainScroll > m.mainClient) bad.push(`main scrolls sideways (${m.mainScroll} of ${m.mainClient})`);
      const worstRow = Math.max(0, ...m.headerRows);
      if (m.headerControls === 0) bad.push('the header carries no controls to level');
      else if (worstRow > 1) bad.push(`a header row sits ${worstRow.toFixed(1)}px off level`);
      if (!m.stageIn) bad.push('the stage passes the main column');
      if (!m.bodyIn) bad.push('the reserved box passes the main column');
      if (!m.railIn) bad.push('the rail passes the main column');
      if (m.bodyH < m.bodyMin - 0.5) {
        bad.push(`the reserved box is ${m.bodyH.toFixed(0)}px, under its ${m.bodyMin.toFixed(0)}px minimum`);
      }
      const besideOk = m.railLeft >= m.stageRight - 1 && Math.abs(m.railTop - m.stageTop) <= 1;
      const belowOk = m.railTop >= m.stageBottom - 1;
      if (m.beside && !besideOk) bad.push(`container ${Math.round(m.containerW)}px should hold the rail beside the stage`);
      if (!m.beside && !belowOk) bad.push(`container ${Math.round(m.containerW)}px should drop the rail below the stage`);
      if (m.clipped.length > 0) bad.push(`text clipped: ${m.clipped.slice(0, 3).join('; ')}`);
      if (m.versions < 2) bad.push('the version selector lists fewer than two versions');
      if (m.delivered < 1 || m.undelivered < 1) bad.push('the rail must show a delivered and an undelivered comment');
      if (!m.chip.includes('Onay bekliyor')) bad.push(`the chip reads "${m.chip}", not the pending one`);
      rows.push({
        ok: bad.length === 0,
        size: `${width}x${height}`,
        theme,
        detail:
          bad.length === 0
            ? `${m.versions} versions, chip "${m.chip}", ${m.delivered + m.undelivered} comments (${m.delivered} delivered), header level over ${m.headerControls} controls, reserved ${Math.round(m.bodyH)}px, rail ${m.beside ? 'beside' : 'below'} (container ${Math.round(m.containerW)}px), no overflow`
            : bad.slice(0, 3).join('; '),
      });
    }
  }
  return rows;
}

// --- the detail walk (U-239, #972) ---------------------------------------------------------------------
/** The work-order detail's own pass: the four named sizes — the 1024 minimum, the 1152 default,
 *  the 1280×800 preset, the 1512×982 full window — clamped to the work area as every plan size
 *  is, in both themes. The measured standing is İE-0006's running detail (the navigator's own);
 *  the two decision standings that must keep their actions on screen at 1152×720 — the approval
 *  (İE-0046) and the live permission ask (İE-0029, whose scripted agent raises the ask when the
 *  executor starts its queued stage) — are walked once per theme after the sizes. */
const DETAIL_SIZES = [
  [1024, 640],
  [1152, 720],
  [1280, 800],
  [1512, 982],
];

async function detailGeometry(target, theme, size) {
  const { page } = target;
  await target.show('detay', theme, { size });
  const m = await page.evaluate(() => {
    const main = document.querySelector('main');
    const segments = [...document.querySelectorAll('[data-detail-strip] > li')].map((li) => li.getBoundingClientRect());
    const cards = [...document.querySelectorAll('[data-decision-stack] > li')].map((card) => card.getBoundingClientRect());
    return {
      sw: main?.scrollWidth ?? 0,
      cw: main?.clientWidth ?? 0,
      mainRect: main?.getBoundingClientRect().toJSON(),
      segments,
      cards,
    };
  });
  const bad = [];
  if (m.sw > m.cw + 1) bad.push(`main scrollWidth ${m.sw} of clientWidth ${m.cw}`);
  for (let at = 1; at < m.segments.length; at += 1) {
    if (m.segments[at - 1].right > m.segments[at].left + 1) bad.push('strip segments overlap');
  }
  for (let at = 1; at < m.cards.length; at += 1) {
    const gap = m.cards[at].top - m.cards[at - 1].bottom;
    if (gap < 11 || gap > 13) bad.push(`stacked cards ${Math.round(gap)}px apart, not the 12px token`);
  }
  return {
    ok: bad.length === 0,
    size: `${size[0]}x${size[1]}`,
    theme,
    detail:
      bad.length === 0
        ? `no overflow, ${m.segments.length} segments, ${m.cards.length} cards on the 12px token`
        : bad.slice(0, 2).join('; '),
  };
}

/** One decision standing's actions must sit wholly inside the main column's box — reachable
 *  without scrolling — at the default window. The walk opens the detail the way a person does,
 *  from its top: `main` keeps whatever scroll the screen before it left (the cockpit's attention
 *  list, the board's columns, the page walk's reading), and a stale scroll would read a
 *  reachable action as escaped — or flatter a buried one — so the scroll is reset before the
 *  button is read, and the first screen is what the rule measures. */
async function decisionActionsVisible(target, theme, cardText, buttonText, { wait = 8000 } = {}) {
  const { page } = target;
  const size = [1152, 720];
  await target.show('pano', theme, { size });
  await page.locator('main button').filter({ hasText: cardText }).first().click({ timeout: 4000 });
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main !== null) main.scrollTop = 0;
  });
  const button = page
    .locator('[data-decision-stack] button')
    .filter({ hasText: buttonText })
    .first();
  await button.waitFor({ state: 'visible', timeout: wait });
  // The store's riding reads (asks, changes) land after the view and re-render the zone in
  // place; a box read in the same breath as a re-render can catch the node between trees. Let
  // the reads land, then take the box — retrying only against that race, never against the
  // assertion itself.
  await page.waitForTimeout(450);
  let box = await button.boundingBox();
  for (let at = 0; box === null && at < 3; at += 1) {
    await page.waitForTimeout(450);
    box = await button.boundingBox();
  }
  const m = await page.evaluate(() => {
    const main = document.querySelector('main');
    const rect = main?.getBoundingClientRect();
    return main === undefined || rect === undefined ? null : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  if (m === null) return { ok: false, theme, detail: 'main not found' };
  const escapes =
    box === null
      ? ['no box']
      : [
          ...(box.top < m.top - 1 ? [`top ${box.top.toFixed(0)} < ${m.top.toFixed(0)}`] : []),
          ...(box.bottom > m.bottom + 1 ? [`bottom ${box.bottom.toFixed(0)} > ${m.bottom.toFixed(0)}`] : []),
          ...(box.left < m.left - 1 ? [`left ${box.left.toFixed(0)} < ${m.left.toFixed(0)}`] : []),
          ...(box.right > m.right + 1 ? [`right ${box.right.toFixed(0)} > ${m.right.toFixed(0)}`] : []),
        ];
  return {
    ok: escapes.length === 0,
    size: '1152x720',
    theme,
    detail:
      escapes.length === 0
        ? `the ${buttonText} action sits inside the main column at 1152x720`
        : `the ${buttonText} action escapes the main column at 1152x720 (${escapes.join(', ')})`,
  };
}

async function detailCheck(target) {
  const rows = [];
  const workArea = target.workArea === undefined ? { width: 1920, height: 1080 } : await target.workArea();
  const sizes = DETAIL_SIZES.map(([w, h]) => [
    Math.min(w, workArea.width),
    Math.min(h, workArea.height),
  ]);
  for (const size of sizes) {
    for (const theme of THEMES) {
      rows.push(await detailGeometry(target, theme, size));
    }
  }
  // The two standings U-239 names: approve and permission, at the default window, both themes.
  for (const theme of THEMES) {
    rows.push(await decisionActionsVisible(target, theme, 'Swagger staging testi', 'Onayla'));
    // İE-0029's ask rises through the real scripted agent; the wait covers the dispatcher's
    // cadence and the transport handshake the smoke walk itself budgets for.
    rows.push(await decisionActionsVisible(target, theme, 'Hız sınırı', 'İzin ver', { wait: 60_000 }));
  }
  return rows;
}

// --- run ---------------------------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.target === 'prototype' && !args.path) {
  console.error('usage: layout-audit.mjs --target=prototype <path/to/index.html>');
  process.exit(2);
}
const target = args.target === 'prototype' ? await openPrototype(args.path) : await openApp();
// The report is one run's world: it starts here, fresh, and every result line lands in it as it
// is printed — the JSON mirrors the console, never judges it.
beginReport();

// The plan's real numbers, printed once so every later label can be read against them.
for (const { name, size } of target.sizes) console.log(`size: ${name} ${size[0]}x${size[1]}`);
let plan = comboPlan(target.sizes, { full: args.full });
// The count names the run's breadth before any result lands: four by default, six with --full.
console.log(`combos: ${plan.length}${args.full ? ' (--full)' : ''}`);

let failures = 0;
let lines = 0;
// The Update button's state walk runs once per run — the first cockpit combo carries it.
let walkedUpdate = false;
for (const { size: entry, theme } of plan) {
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
    // The face the screen was measured under, read back from the document: it must be the plan's,
    // or every rule below it just measured the wrong theme.
    {
      const held = await target.page
        .evaluate(() => document.documentElement.dataset.theme)
        .catch(() => null);
      const ok = held === theme;
      if (!ok) failures += 1;
      lines += 1;
      const detail = `data-theme=${held ?? 'none'}, requested ${theme}`;
      console.log(`theme: ${label} ${ok ? 'ok' : 'FAIL'} ${detail}`);
      appendCheck({ id: 'theme', screen, size: `${width}x${height}`, theme, status: ok ? 'ok' : 'FAIL', detail });
    }
    for (const r of results) {
      const status = r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAIL';
      if (status === 'FAIL') failures += 1;
      lines += 1;
      console.log(`${r.id}: ${label} ${status} ${r.detail}`);
      appendCheck({ id: r.id, screen, size: `${width}x${height}`, theme, status, detail: r.detail });
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
      appendCheck({ id: 'window', screen: '', size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
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
      appendCheck({ id: 'palette', screen, size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
    }
    if (screen === 'pano' && target.selectors.newWorkOrder) {
      let r;
      try {
        r = await dialogWindowsCheck(target);
      } catch (error) {
        r = { ok: false, detail: `dialogs unreachable: ${String(error).split('\n')[0]}` };
      }
      if (!r.ok) failures += 1;
      lines += 1;
      console.log(`dialogs: ${label} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      appendCheck({ id: 'dialogs', screen, size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
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
      appendCheck({ id: 'settings', screen, size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
    }
    // Docket AI's panel is measured open the same way, through ⌘J (the app target only: the frozen
    // prototype has no panel), and its full-screen reading mode right after it, through Genişlet.
    if (screen === 'kokpit' && target.selectors.chatPanel) {
      let r;
      try {
        r = await chatPanelCheck(target);
      } catch (error) {
        r = { ok: false, detail: `chat panel unreachable: ${String(error).split('\n')[0]}` };
      }
      if (!r.ok) failures += 1;
      lines += 1;
      console.log(`chat: ${label} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      appendCheck({ id: 'chat', screen, size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
      if (r.ok) {
        let f;
        try {
          f = await chatFullCheck(target);
        } catch (error) {
          f = { ok: false, detail: `chat full mode unreachable: ${String(error).split('\n')[0]}` };
        }
        if (!f.ok) failures += 1;
        lines += 1;
        console.log(`chat-full: ${label} ${f.ok ? 'ok' : 'FAIL'} ${f.detail}`);
        appendCheck({ id: 'chat-full', screen, size: `${width}x${height}`, theme, status: f.ok ? 'ok' : 'FAIL', detail: f.detail });
      }
    }
    if (screen === 'kokpit' && args.target === 'app' && target.selectors.accountsFrame) {
      let r;
      try {
        r = await accountsOpacityCheck(target);
      } catch (error) {
        r = { ok: false, detail: `accounts frame unreachable: ${String(error).split('\n')[0]}` };
      }
      if (!r.ok) failures += 1;
      lines += 1;
      console.log(`accounts-opacity: ${label} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
      appendCheck({ id: 'accounts-opacity', screen, size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
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
      appendCheck({ id: 'titlebar', screen, size: `${width}x${height}`, theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
    }
  }
}
// The attention cards' width walk runs once per run, after the combos — the app target only,
// never the frozen prototype.
if (args.target === 'app' && target.selectors.attentionCard) {
  let rows;
  try {
    rows = await attentionCardsCheck(target);
  } catch (error) {
    rows = [{ ok: false, size: '', detail: `attention cards unreachable: ${String(error).split('\n')[0]}` }];
  }
  for (const r of rows) {
    if (!r.ok) failures += 1;
    lines += 1;
    console.log(`attention: kokpit ${r.size} dark ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
    appendCheck({ id: 'attention', screen: 'kokpit', size: r.size, theme: 'dark', status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
  }
}
// The page viewer's width × theme walk runs once per run, beside the attention cards' — the app
// target only; the frozen prototype has no page viewer.
if (args.target === 'app' && target.selectors.pageScreen) {
  let rows;
  try {
    rows = await pageViewerCheck(target);
  } catch (error) {
    rows = [{ ok: false, size: '', theme: '', detail: `page viewer unreachable: ${String(error).split('\n')[0]}` }];
  }
  for (const r of rows) {
    if (!r.ok) failures += 1;
    lines += 1;
    console.log(`page: sayfa ${r.size} ${r.theme} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
    appendCheck({ id: 'page', screen: 'sayfa', size: r.size, theme: r.theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
  }
}
// The work-order detail's own walk (U-239) runs once per run, after the page viewer's — the app
// target only; the frozen prototype is not the Phase A screen.
if (args.target === 'app' && target.selectors.detailAsk) {
  let rows;
  try {
    rows = await detailCheck(target);
  } catch (error) {
    rows = [{ ok: false, size: '', theme: '', detail: `detail walk unreachable: ${String(error).split('\n')[0]}` }];
  }
  for (const r of rows) {
    if (!r.ok) failures += 1;
    lines += 1;
    console.log(`detail: detay ${r.size} ${r.theme} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
    appendCheck({ id: 'detail', screen: 'detay', size: r.size, theme: r.theme, status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
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
  appendCheck({ id: 'titlebar-plain', screen: '', size: '', theme: '', status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
}
await target.close();
// The skeleton pass closes the run on the app target (U-26), after the main app is down: three
// lines on their own delayed launch, sized and walked by makeShow like the main run's screens.
if (args.target === 'app' && target.selectors.skeleton) {
  for (const r of await skeletonPass()) {
    if (!r.ok) failures += 1;
    lines += 1;
    console.log(`skeleton: ${r.screen} ${r.ok ? 'ok' : 'FAIL'} ${r.detail}`);
    appendCheck({ id: 'skeleton', screen: r.screen, size: '', theme: '', status: r.ok ? 'ok' : 'FAIL', detail: r.detail });
  }
}
console.log(`${lines} checks, ${failures} FAIL`);
console.log(`report: ${REPORT_PATH}`);
process.exit(failures === 0 ? 0 : 1);
