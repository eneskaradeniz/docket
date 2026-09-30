// e2e/layout-rules.mjs — the L-1 … L-12 measurements of docs/v2/ui.md → "Verifying the shell".
// Pure DOM measurement, no pixel diff. Each rule takes a Playwright `page`, the run context
// ({ screen, width, height, theme }) and the target's selector map, and returns
// { id, ok, detail }. A selector the target does not have makes the rule report
// `skipped: no hook <name>` (ok stays true) — a missing hook must be visible, not a silent pass,
// and the rule set stays identical between the frozen prototype and the app.
//
// A selector is a CSS string, or { css, text } to pick the first match whose text contains `text`.

export const RULE_IDS = ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7', 'L-8', 'L-9', 'L-10', 'L-11', 'L-12'];

/** The audit size plan: the window's minimum, its default, and full screen — nothing between.
 *  The first two are numbers; full screen is `'display'`, resolved to the primary display's work
 *  area at run time so the window is exactly as large as the real screen allows. */
export const SIZE_PLAN = [
  { name: 'minimum', size: [1024, 640] },
  { name: 'default', size: [1152, 720] },
  { name: 'fullscreen', size: 'display' },
];

/** One planned size against a work area: `'display'` becomes the area itself, a number is clamped
 *  down to it — so even the minimum and the default never spill off a small display. */
export const sizeFromPlan = (planned, workArea) =>
  planned === 'display'
    ? [workArea.width, workArea.height]
    : [Math.min(planned[0], workArea.width), Math.min(planned[1], workArea.height)];

/** The plan resolved for one work area: each name paired with its concrete [w, h]. */
export const sizesForWorkArea = (workArea) =>
  SIZE_PLAN.map(({ name, size }) => ({ name, size: sizeFromPlan(size, workArea) }));

/** Resolve the plan against the primary display's work area of a live app, read in the Electron
 *  main process — the only place the real screen is known. */
export async function resolveSizes(app) {
  const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
  return sizesForWorkArea(workArea);
}
export const THEMES = ['dark', 'light'];
export const SCREENS = ['kokpit', 'pano', 'liste', 'detay', 'yol-haritasi', 'hesap'];

/** The combinations a run walks: the resolved sizes paired with the themes to measure them in.
 *  The default is the four the operator's own screen exercises, in the fixed order — dark at
 *  every size, light at the default window (the size the operator uses); `full` restores the
 *  complete 3 × 2 matrix in the every-theme-then-next-size order the runs have always walked,
 *  for a release run or after a token/theme change. */
export const comboPlan = (sizes, { full = false } = {}) =>
  full
    ? THEMES.flatMap((theme) => sizes.map((size) => ({ size, theme })))
    : sizes.flatMap((size) => (size.name === 'default' ? THEMES : ['dark']).map((theme) => ({ size, theme })));

/** Per-screen main-column cap in px; `null` means "the board uses the full main width". */
const MAIN_CAP = { kokpit: 1200, detay: 1280, 'yol-haritasi': 960, hesap: 960, pano: null, liste: null };

const skipped = (id, name) => ({ id, ok: true, skipped: true, detail: `skipped: no hook ${name}` });
const result = (id, ok, detail) => ({ id, ok, detail });

// Runs inside the page. One resolver so every rule reads selectors the same way.
const RESOLVE = `
  const resolve = (sel) => {
    if (sel == null) return null;
    const css = typeof sel === 'string' ? sel : sel.css;
    const text = typeof sel === 'string' ? undefined : sel.text;
    const all = [...document.querySelectorAll(css)];
    return text === undefined ? all[0] ?? null : all.find((el) => (el.textContent || '').includes(text)) ?? null;
  };
  const content = (el) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
`;

/** Evaluate `body` (a function-body string using `resolve`, `content`, `arg`) in the page. */
const inPage = (page, body, arg) =>
  page.evaluate(`(() => { const arg = ${JSON.stringify(arg ?? null)}; ${RESOLVE} ${body} })()`);

const l1 = async (page, ctx, sel) => {
  if (!sel.sidebar) return skipped('L-1', 'sidebar');
  const m = await inPage(
    page,
    `const el = resolve(arg); if (!el) return null;
    const r = el.getBoundingClientRect(); return { left: r.left, width: r.width, iw: innerWidth };`,
    sel.sidebar,
  );
  if (!m) return result('L-1', false, 'sidebar element not found');
  const want = m.iw >= 1000 ? 240 : 208;
  const ok = Math.abs(m.left) <= 0.5 && Math.abs(m.width - want) <= 0.5;
  return result('L-1', ok, `left ${m.left.toFixed(1)} width ${m.width.toFixed(1)} want 0/${want}`);
};

const l2 = async (page) => {
  const m = await inPage(page, `return { sw: document.documentElement.scrollWidth, iw: innerWidth };`);
  return result('L-2', m.sw <= m.iw, `scrollWidth ${m.sw} innerWidth ${m.iw}`);
};

// Horizontal containment only: the main column scrolls vertically by design, so an element below
// the fold is not a defect, while one past the right edge of its clipping ancestor is.
const l3 = async (page, ctx, sel) => {
  const bad = await inPage(
    page,
    `const scroller = resolve(arg.scroller);
    const out = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    for (const el of document.querySelectorAll('button, a[href], a[data-nav], input, select, textarea')) {
      if (!visible(el) || (scroller && scroller.contains(el))) continue;
      const r = el.getBoundingClientRect();
      let left = 0, right = innerWidth;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === 'visible') continue;
        const pr = p.getBoundingClientRect();
        left = Math.max(left, pr.left); right = Math.min(right, pr.right);
      }
      if (r.left < left - 0.5 || r.right > right + 0.5) {
        out.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ' vs ' + Math.round(left) + ',' + Math.round(right) + ']');
      }
    }
    return out;`,
    { scroller: sel.kanbanScroller ?? null },
  );
  return result('L-3', bad.length === 0, bad.length === 0 ? 'all controls contained' : `${bad.length} outside: ${bad.slice(0, 3).join('; ')}`);
};

const l4 = async (page) => {
  const bad = await inPage(
    page,
    `const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (own === '' || el.scrollWidth <= el.clientWidth + 1) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      const ok = cs.textOverflow === 'ellipsis' && (el.getAttribute('title') || '').includes(own.slice(0, 20));
      if (!ok) out.push(own.slice(0, 24) + ' (' + el.scrollWidth + '>' + el.clientWidth + (cs.textOverflow === 'ellipsis' ? ', no title' : ', no ellipsis') + ')');
    }
    return out;`,
  );
  return result('L-4', bad.length === 0, bad.length === 0 ? 'no unmarked truncation' : `${bad.length} truncated: ${bad.slice(0, 3).join('; ')}`);
};

const l5 = async (page, ctx, sel) => {
  if (!sel.main) return skipped('L-5', 'main');
  const cap = MAIN_CAP[ctx.screen];
  const m = await inPage(
    page,
    `const main = resolve(arg); if (!main) return null;
    const widths = [...main.children].map((c) => c.getBoundingClientRect().width).filter((w) => w > 0);
    return { widest: Math.max(0, ...widths), avail: content(main) };`,
    sel.main,
  );
  if (!m) return result('L-5', false, 'main element not found');
  if (cap === null) {
    return result('L-5', m.widest >= m.avail - 1, `board width ${m.widest.toFixed(0)} of main ${m.avail.toFixed(0)}`);
  }
  return result('L-5', m.widest <= cap + 0.5, `content ${m.widest.toFixed(0)} cap ${cap}`);
};

// L-6 reads the accounts frame's geometry (U-16): on a short window the body must be collapsed,
// and whenever the body is collapsed the frame is the header row plus symmetric padding — no
// dead space below the header. The header row must also sit identically in both states: the same
// top offset and the same row height expanded and collapsed, so expanding only adds the body
// below and the header never moves. The frame is toggled through its own control and put back
// collapsed, so a run leaves the frame the way it found it.
const l6 = async (page, ctx, sel) => {
  if (!sel.accountsBody) return skipped('L-6', 'accountsBody');
  const h = await inPage(page, `const el = resolve(arg); return el ? el.getBoundingClientRect().height : null;`, sel.accountsBody);
  if (h === null) return result('L-6', false, 'accounts body not found');
  if (h > 1) {
    if (ctx.height >= 640) return result('L-6', true, `height ${ctx.height} >= 640, not applicable`);
    return result('L-6', false, `accounts body height ${h.toFixed(1)} at window height ${ctx.height}`);
  }
  if (!sel.accountsFrame) return skipped('L-6', 'accountsFrame');
  const GEOMETRY = `
    const frame = resolve(arg); if (!frame) return null;
    const f = frame.getBoundingClientRect();
    const header = frame.firstElementChild.getBoundingClientRect();
    return { top: header.top - f.top - frame.clientTop,
             bottom: f.bottom - header.bottom - (f.height - frame.clientHeight - frame.clientTop),
             rowH: header.height };`;
  const collapsed = await inPage(page, GEOMETRY, sel.accountsFrame);
  if (collapsed === null) return result('L-6', false, 'accounts frame not found');
  const symmetric = Math.abs(collapsed.top - collapsed.bottom) <= 1;
  const toggle = page.locator(sel.accountsFrame).locator('button[aria-expanded]').first();
  const bodySettled = (open) =>
    page.waitForFunction(
      ([bodySel, open]) => {
        const body = document.querySelector(bodySel);
        if (body === null) return false;
        const grown = body.getBoundingClientRect().height > 1;
        return grown === open && body.getAnimations().length === 0;
      },
      [sel.accountsBody, open],
      { timeout: 4000 },
    );
  await toggle.click();
  await bodySettled(true);
  const expanded = await inPage(page, GEOMETRY, sel.accountsFrame);
  await toggle.click();
  await bodySettled(false);
  if (expanded === null) return result('L-6', false, 'accounts frame not found expanded');
  const parity = Math.abs(expanded.top - collapsed.top) <= 1 && Math.abs(expanded.rowH - collapsed.rowH) <= 1;
  const ok = symmetric && parity;
  return result(
    'L-6',
    ok,
    `collapsed padding top ${collapsed.top.toFixed(1)} bottom ${collapsed.bottom.toFixed(1)}; header top ${collapsed.top.toFixed(1)}→${expanded.top.toFixed(1)} rowH ${collapsed.rowH.toFixed(1)}→${expanded.rowH.toFixed(1)}`,
  );
};

const l7 = async (page, ctx, sel) => {
  if (ctx.screen !== 'detay') return result('L-7', true, 'not the detail screen');
  const missing = ['main', 'detailAsk', 'livePane'].find((k) => !sel[k]);
  if (missing) return skipped('L-7', missing);
  const m = await inPage(
    page,
    `const main = resolve(arg.main), ask = resolve(arg.ask), live = resolve(arg.live);
    if (!main || !ask || !live) return null;
    return { w: content(main), askBottom: ask.getBoundingClientRect().bottom, liveTop: live.getBoundingClientRect().top };`,
    { main: sel.main, ask: sel.detailAsk, live: sel.livePane },
  );
  if (!m) return result('L-7', false, 'detail pane elements not found');
  if (m.w >= 900) return result('L-7', true, `main ${m.w.toFixed(0)} >= 900, side by side allowed`);
  return result('L-7', m.liveTop >= m.askBottom - 1, `main ${m.w.toFixed(0)} live top ${m.liveTop.toFixed(0)} ask bottom ${m.askBottom.toFixed(0)}`);
};

const l8 = async (page, ctx, sel) => {
  if (ctx.screen !== 'pano') return result('L-8', true, 'not the Kanban view');
  const missing = ['kanbanScroller', 'kanbanWrap'].find((k) => !sel[k]);
  if (missing) return skipped('L-8', missing);
  const m = await inPage(
    page,
    `const sc = resolve(arg.sc), wrap = resolve(arg.wrap); if (!sc || !wrap) return null;
    return { over: sc.scrollWidth > sc.clientWidth, snap: getComputedStyle(sc).scrollSnapType,
             fade: getComputedStyle(wrap, '::after').content };`,
    { sc: sel.kanbanScroller, wrap: sel.kanbanWrap },
  );
  if (!m) return result('L-8', false, 'kanban elements not found');
  if (!m.over) return result('L-8', true, 'columns fit, no scroller needed');
  const ok = m.snap !== 'none' && m.fade !== 'none' && m.fade !== 'normal';
  return result('L-8', ok, `overflowing; snap ${m.snap}; fade ${m.fade}`);
};

// L-9 lives at the full-screen size only: the smaller windows accept the closed-list heading
// below the fold, so they report the rule as not applicable instead of measuring it.
const l9 = async (page, ctx, sel) => {
  if (ctx.screen !== 'kokpit' || ctx.sizeName !== 'fullscreen') {
    return result('L-9', true, 'only checked on the cockpit at the full-screen size');
  }
  if (!sel.closedHeading) return skipped('L-9', 'closedHeading');
  const m = await inPage(page, `const el = resolve(arg); return el ? { top: el.getBoundingClientRect().top, ih: innerHeight } : null;`, sel.closedHeading);
  if (!m) return result('L-9', false, '"Son kapananlar" heading not found');
  return result('L-9', m.top < m.ih, `heading top ${m.top.toFixed(0)} of window ${m.ih}`);
};

// L-10: body content is left-aligned — the screen's content wrapper starts at the main column's
// left padding edge, never centred inside it. The wrapper is main's widest child; a centred
// wrapper sits right of the edge, a left-aligned one touches it.
const l10 = async (page, ctx, sel) => {
  if (!sel.main) return skipped('L-10', 'main');
  const m = await inPage(
    page,
    `const main = resolve(arg); if (!main) return null;
    const cs = getComputedStyle(main);
    const edge = main.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
    const kids = [...main.children].filter((c) => c.getBoundingClientRect().width > 0);
    if (kids.length === 0) return { edge, left: null };
    const widest = kids.reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a));
    return { edge, left: widest.getBoundingClientRect().left };`,
    sel.main,
  );
  if (!m) return result('L-10', false, 'main element not found');
  if (m.left === null) return result('L-10', true, 'main holds no content');
  return result('L-10', Math.abs(m.left - m.edge) <= 1, `wrapper left ${m.left.toFixed(1)} main padding edge ${m.edge.toFixed(1)}`);
};

// L-11: in every open Kanban column each card spans the header row's width — the same left and
// right edges within a pixel — so the lane reads as one block, not a wide title over narrow cards.
const l11 = async (page, ctx, sel) => {
  if (ctx.screen !== 'pano') return result('L-11', true, 'not the Kanban view');
  const missing = ['kanbanColHead', 'kanbanCard'].find((k) => !sel[k]);
  if (missing) return skipped('L-11', missing);
  const m = await inPage(
    page,
    `const heads = [...document.querySelectorAll(arg.head)];
    const cards = [...document.querySelectorAll(arg.card)];
    const bad = [];
    let worst = 0;
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.width === 0) continue;
      const head = card.closest('section')?.querySelector(arg.head);
      if (!head) continue;
      const h = head.getBoundingClientRect();
      const d = Math.max(Math.abs(r.left - h.left), Math.abs(r.right - h.right));
      worst = Math.max(worst, d);
      if (d > 1) bad.push((card.textContent || '').trim().slice(0, 16) + ' Δ' + d.toFixed(1) + 'px');
    }
    return { heads: heads.length, cards: cards.length, worst, bad: bad.slice(0, 3) };`,
    { head: sel.kanbanColHead, card: sel.kanbanCard },
  );
  if (m.cards === 0) return result('L-11', true, `no cards to measure (${m.heads} columns)`);
  const ok = m.bad.length === 0;
  return result(
    'L-11',
    ok,
    ok
      ? `${m.cards} cards edge-to-edge with their header row`
      : `cards sit up to ${m.worst.toFixed(1)}px inside their header's edges: ${m.bad.join('; ')}`,
  );
};

// L-12: no audited screen shows a problem state. A rendered `error.*` label is content standing in
// for a query that failed against the design seed — a wrong id, a query the state cannot answer, a
// stale problem never cleared — so the walk treats its text as a defect, named by screen. The texts
// are keyed by the app's own label bundles (both locales), never re-typed here.
const { TR } = await import('../src/presentation/labels/tr.ts');
const { EN } = await import('../src/presentation/labels/en.ts');

/** Every `error.*` key with its copy in both locales, straight from the bundles. Pure. */
export const problemLabelEntries = (tr, en) =>
  Object.keys(tr)
    .filter((key) => key.startsWith('error.'))
    .map((key) => ({ key, tr: tr[key], en: en[key] ?? tr[key] }));

/** The entry a visible text renders, when it equals one in either locale; null when it does not.
 *  Surrounding whitespace is nothing a screen shows, so it is trimmed first — anything else makes
 *  the text a different string. Pure. */
export const matchProblemText = (text, entries) => {
  const seen = text.trim();
  return entries.find((entry) => entry.tr === seen || entry.en === seen) ?? null;
};

/** Problem keys the walk owes their screen as a known standing: the detail and live panes are
 *  under an interactive redesign, and a cause inside their frozen files is listed in the issue's
 *  PR body instead of fixed here. Each name cites the redesign that removes it — the set is empty
 *  again the moment that lands. */
export const L12_KNOWN_STANDINGS = {
  detay: [],
};

const PROBLEM_ENTRIES = problemLabelEntries(TR, EN);

const l12 = async (page, ctx) => {
  const known = L12_KNOWN_STANDINGS[ctx.screen] ?? [];
  const hits = await inPage(
    page,
    `const texts = new Map();
    for (const entry of arg) { texts.set(entry.tr, entry); texts.set(entry.en, entry); }
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const matched = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      const full = (el.textContent || '').trim();
      const hit = texts.get(own) ?? texts.get(full);
      if (hit) matched.push({ el, key: hit.key, text: own || full, tag: el.tagName.toLowerCase() });
    }
    // A wrapper whose whole text is the label still matched alongside the element that holds it;
    // only the innermost element names the finding.
    return matched
      .filter((m) => !matched.some((other) => other !== m && m.el.contains(other.el)))
      .map(({ key, text, tag }) => ({ key, text, tag }));`,
    PROBLEM_ENTRIES,
  );
  if (hits.length === 0) return result('L-12', true, 'no problem text on the screen');
  const knownHits = hits.filter((hit) => known.includes(hit.key));
  const fresh = hits.filter((hit) => !known.includes(hit.key));
  if (fresh.length > 0) {
    return result(
      'L-12',
      false,
      `${fresh.length} problem text${fresh.length === 1 ? '' : 's'}: ${fresh
        .map((hit) => `${hit.key} "${hit.text}" <${hit.tag}>`)
        .slice(0, 3)
        .join('; ')}`,
    );
  }
  return result('L-12', true, `known standing: ${knownHits.map((hit) => hit.key).join(', ')}`);
};

const RULES = [
  ['L-1', l1],
  ['L-2', l2],
  ['L-3', l3],
  ['L-4', l4],
  ['L-5', l5],
  ['L-6', l6],
  ['L-7', l7],
  ['L-8', l8],
  ['L-9', l9],
  ['L-10', l10],
  ['L-11', l11],
  ['L-12', l12],
];

/** Run every rule for one screen/size/theme; a throwing rule is reported as FAIL, not a crash. */
export async function runRules(page, ctx, selectors) {
  const out = [];
  for (const [id, rule] of RULES) {
    try {
      out.push(await rule(page, ctx, selectors));
    } catch (error) {
      out.push(result(id, false, `rule threw: ${String(error).split('\n')[0]}`));
    }
  }
  return out;
}
