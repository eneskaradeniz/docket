// e2e/layout-rules.mjs — the L-1 … L-9 measurements of docs/v2/ui.md → "Verifying the shell".
// Pure DOM measurement, no pixel diff. Each rule takes a Playwright `page`, the run context
// ({ screen, width, height, theme }) and the target's selector map, and returns
// { id, ok, detail }. A selector the target does not have makes the rule report
// `skipped: no hook <name>` (ok stays true) — a missing hook must be visible, not a silent pass,
// and the rule set stays identical between the frozen prototype and the app.
//
// A selector is a CSS string, or { css, text } to pick the first match whose text contains `text`.

export const RULE_IDS = ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7', 'L-8', 'L-9'];

export const SIZES = [
  [1024, 640],
  [1280, 800],
  [1920, 1080],
  [2560, 1440],
];
export const THEMES = ['dark', 'light'];
export const SCREENS = ['kokpit', 'pano', 'liste', 'detay', 'yol-haritasi', 'hesap'];

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

const l6 = async (page, ctx, sel) => {
  if (!sel.accountsBody) return skipped('L-6', 'accountsBody');
  if (ctx.height >= 640) return result('L-6', true, `height ${ctx.height} >= 640, not applicable`);
  const h = await inPage(page, `const el = resolve(arg); return el ? el.getBoundingClientRect().height : null;`, sel.accountsBody);
  if (h === null) return result('L-6', false, 'accounts body not found');
  return result('L-6', h <= 1, `accounts body height ${h.toFixed(1)} at window height ${ctx.height}`);
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

const l9 = async (page, ctx, sel) => {
  if (ctx.screen !== 'kokpit' || ctx.width !== 1280 || ctx.height !== 800) {
    return result('L-9', true, 'only checked on the cockpit at 1280x800');
  }
  if (!sel.closedHeading) return skipped('L-9', 'closedHeading');
  const m = await inPage(page, `const el = resolve(arg); return el ? { top: el.getBoundingClientRect().top, ih: innerHeight } : null;`, sel.closedHeading);
  if (!m) return result('L-9', false, '"Son kapananlar" heading not found');
  return result('L-9', m.top < m.ih, `heading top ${m.top.toFixed(0)} of window ${m.ih}`);
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
