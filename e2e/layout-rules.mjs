// e2e/layout-rules.mjs — the L-1 … L-15 measurements of docs/v2/ui.md → "Verifying the shell".
// Pure DOM measurement, no pixel diff. Each rule takes a Playwright `page`, the run context
// ({ screen, width, height, theme }) and the target's selector map, and returns
// { id, ok, detail }. A selector the target does not have makes the rule report
// `skipped: no hook <name>` (ok stays true) — a missing hook must be visible, not a silent pass,
// and the rule set stays identical between the frozen prototype and the app.
//
// A selector is a CSS string, or { css, text } to pick the first match whose text contains `text`.

export const RULE_IDS = ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7', 'L-8', 'L-9', 'L-10', 'L-11', 'L-12', 'L-13', 'L-14', 'L-15'];

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

/** The screens whose sections fill the main column (U-54): every top-level section's right edge
 *  must sit within FILL_TOLERANCE_PX of the main column's content-box right edge. The board is
 *  not among them — it keeps its own reading, the full main width. */
const FILL_SCREENS = new Set(['kokpit', 'detay', 'yol-haritasi', 'hesap']);
/** How far short of the main column's right edge a filling section may end (U-54's letter: 8 px). */
const FILL_TOLERANCE_PX = 8;

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

// L-1 reads the sidebar against the live scale (L-1b amends L-1a, 2026-10-05, U-53): the sidebar
// is 16.5 rem, so its pixel width follows the root clamp — 264 px at the clamp's 100 % floor,
// 330 px at 125 % — instead of a fixed number. L-1's own readings stay: the left edge is 0, the
// width is the same on every screen, and it never narrows (the clamp only grows it).
const l1 = async (page, ctx, sel) => {
  if (!sel.sidebar) return skipped('L-1', 'sidebar');
  const m = await inPage(
    page,
    `const el = resolve(arg); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, width: r.width, fs: getComputedStyle(document.documentElement).fontSize };`,
    sel.sidebar,
  );
  if (!m) return result('L-1', false, 'sidebar element not found');
  const rem = parseFloat(m.fs);
  const want = 16.5 * rem;
  const ok = rem > 0 && Math.abs(m.left) <= 0.5 && Math.abs(m.width - want) <= 0.5;
  return result('L-1', ok, `left ${m.left.toFixed(1)} width ${m.width.toFixed(1)} want 16.5rem × ${rem.toFixed(3)} = ${want.toFixed(1)}`);
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

// L-5's fill half (L-5a amends L-5, 2026-10-05, U-54): on the four data screens every top-level
// section reaches the main column's content-box right edge, measured with animations disabled —
// a moving element's bounding box corrupts the reading (the width prototype's first round read
// the cockpit's scan bar as %102 fill). A deliberately narrow surface (U-54's list) keeps its own
// cap and is asserted against it instead of the edge. The board keeps L-5's own reading: the
// full main width.
const l5 = async (page, ctx, sel) => {
  if (!sel.main) return skipped('L-5', 'main');
  if (!FILL_SCREENS.has(ctx.screen)) {
    const m = await inPage(
      page,
      `const main = resolve(arg); if (!main) return null;
      const widths = [...main.children].map((c) => c.getBoundingClientRect().width).filter((w) => w > 0);
      return { widest: Math.max(0, ...widths), avail: content(main) };`,
      sel.main,
    );
    if (!m) return result('L-5', false, 'main element not found');
    return result('L-5', m.widest >= m.avail - 1, `board width ${m.widest.toFixed(0)} of main ${m.avail.toFixed(0)}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const m = await inPage(
    page,
    `const main = resolve(arg); if (!main) return null;
    const cs = getComputedStyle(main);
    const right = main.getBoundingClientRect().right - parseFloat(cs.paddingRight);
    // Top-level sections: the screen wrapper inside main, then its own visible children.
    const kids = [...main.children].flatMap((wrapper) => [...wrapper.children]);
    const out = [];
    for (const el of kids) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cs2 = getComputedStyle(el);
      out.push({
        name: (el.querySelector('h1,h2')?.textContent || el.tagName.toLowerCase()).trim().slice(0, 24),
        right: r.right,
        width: r.width,
        cap: cs2.maxWidth,
      });
    }
    return { right, out };`,
    sel.main,
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (!m) return result('L-5', false, 'main element not found');
  const bad = [];
  for (const kid of m.out) {
    if (kid.cap !== 'none') {
      // A deliberately narrow surface keeps its own cap (U-54's list) — assert against the cap.
      const capPx = parseFloat(kid.cap);
      if (!(kid.width <= capPx + 0.5)) bad.push(`"${kid.name}" exceeds its narrow cap ${kid.cap}`);
      continue;
    }
    const short = m.right - kid.right;
    if (short > FILL_TOLERANCE_PX) bad.push(`"${kid.name}" ends ${short.toFixed(1)}px short of the main column's edge`);
  }
  return result(
    'L-5',
    bad.length === 0,
    bad.length === 0
      ? `${m.out.length} sections fill to the main column's right edge (±${FILL_TOLERANCE_PX}px, reduced motion)`
      : bad.slice(0, 3).join('; '),
  );
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

// L-12: every visible account badge (U-21's "account badge", the provider mark) draws what its
// provider's def records and stays inside its row. The badge names its provider
// (`data-provider`) and the neutral glyph marks itself (`data-mark="neutral"`), so the rule reads
// the id against the builtin mark sets: a provider with a mark must draw that mark — one svg with
// a non-empty path, and the neutral glyph means the marks did not resolve; a markless provider
// (P-25a) must draw the neutral glyph and never a path it does not own; an id in neither set is
// an unknown provider id in the audit seed — seed data the world must not carry, not a
// without-standing the badge may render. The badge's box lies within the nearest row container
// (button, li, a, header, label) that carries it, L-3's containment notion measured on the badge
// itself. The sidebar's cards sit in the accounts frame's collapsed body, so the rule opens the
// frame for the measurement when it is closed and puts it back the way it found it (L-6's dance).

// The mark sets come from the shared module the marks test pins against the defs — never a copy
// typed here. The module is dependency-free so this plain-node audit can import it.
const { MARKED_PROVIDER_IDS, MARKLESS_PROVIDER_IDS } = await import(
  '../src/infrastructure/providers/defs/provider-mark-sets.ts'
);
export const L12_MARK_SETS = Object.freeze({
  marked: new Set(MARKED_PROVIDER_IDS),
  nullMark: new Set(MARKLESS_PROVIDER_IDS),
});

/** One badge's L-12 verdict: the values measured in the page in, the rule's failure strings out.
 *  Pure, so the fixture tests prove every standing without a page. */
export const l12BadgeFailures = (badge, sets) => {
  const out = [];
  const path = badge.path.trim();
  if (sets.marked.has(badge.provider)) {
    if (badge.neutral) out.push(`marked provider ${badge.provider} drew the neutral glyph`);
    else if (path === '') out.push(`marked provider ${badge.provider} drew no mark path`);
  } else if (sets.nullMark.has(badge.provider)) {
    if (path !== '') out.push(`markless provider ${badge.provider} drew a path it does not own`);
    else if (!badge.neutral) out.push(`markless provider ${badge.provider} drew neither the neutral glyph nor a path`);
  } else {
    out.push(`unknown provider id in the audit seed: ${badge.provider === '' ? '(no id)' : badge.provider}`);
  }
  if (badge.outsideRow) out.push('badge outside its row');
  return out;
};

const l12 = async (page, ctx, sel) => {
  if (!sel.accountMark) return skipped('L-12', 'accountMark');
  let opened = false;
  if (sel.accountsFrame && sel.accountsBody) {
    const h = await inPage(page, `const el = resolve(arg); return el ? el.getBoundingClientRect().height : null;`, sel.accountsBody);
    if (h !== null && h <= 1) {
      const toggle = page.locator(sel.accountsFrame).locator('button[aria-expanded]').first();
      await toggle.click();
      await page.waitForFunction(
        (bodySel) => {
          const body = document.querySelector(bodySel);
          if (body === null) return false;
          return body.getBoundingClientRect().height > 1 && body.getAnimations().length === 0;
        },
        sel.accountsBody,
        { timeout: 4000 },
      );
      opened = true;
    }
  }
  const m = await inPage(
    page,
    `const badges = [...document.querySelectorAll(arg)];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const out = [];
    let counted = 0;
    for (const el of badges) {
      if (!visible(el)) continue;
      counted += 1;
      out.push({
        provider: el.getAttribute('data-provider') ?? '',
        path: el.querySelector('svg path')?.getAttribute('d') ?? '',
        neutral: el.getAttribute('data-mark') === 'neutral',
        outsideRow: (() => {
          const row = el.closest('button, li, a, header, label');
          if (row === null) return false;
          const r = el.getBoundingClientRect();
          const b = row.getBoundingClientRect();
          return r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
        })(),
      });
    }
    return { counted, out };`,
    sel.accountMark,
  );
  const failures = m.out.flatMap((badge) => l12BadgeFailures(badge, L12_MARK_SETS)).slice(0, 3);
  if (opened) {
    const toggle = page.locator(sel.accountsFrame).locator('button[aria-expanded]').first();
    await toggle.click();
    await page.waitForFunction(
      (bodySel) => {
        const body = document.querySelector(bodySel);
        if (body === null) return false;
        return body.getBoundingClientRect().height <= 1 && body.getAnimations().length === 0;
      },
      sel.accountsBody,
      { timeout: 4000 },
    );
  }
  if (m.counted === 0) return result('L-12', true, 'no visible account badges');
  return result(
    'L-12',
    failures.length === 0,
    failures.length === 0 ? `${m.counted} badges carry their provider's recorded mark inside the row` : failures.join('; '),
  );
};


// L-13: no audited screen shows a problem state. A rendered `error.*` label is content standing in
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

/** Problem keys the walk owes their screen as a known standing: a cause inside a file under
 *  interactive redesign (the detail and live panes) is listed in the issue's PR body instead of
 *  fixed here. Each entry names the screen and the keys it owes, cited to the redesign that
 *  removes it — the map is empty while no screen owes a standing. */
export const L13_KNOWN_STANDINGS = {};

const PROBLEM_ENTRIES = problemLabelEntries(TR, EN);

const l13 = async (page, ctx) => {
  const known = L13_KNOWN_STANDINGS[ctx.screen] ?? [];
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
  if (hits.length === 0) return result('L-13', true, 'no problem text on the screen');
  const knownHits = hits.filter((hit) => known.includes(hit.key));
  const fresh = hits.filter((hit) => !known.includes(hit.key));
  if (fresh.length > 0) {
    return result(
      'L-13',
      false,
      `${fresh.length} problem text${fresh.length === 1 ? '' : 's'}: ${fresh
        .map((hit) => `${hit.key} "${hit.text}" <${hit.tag}>`)
        .slice(0, 3)
        .join('; ')}`,
    );
  }
  return result('L-13', true, `known standing: ${knownHits.map((hit) => hit.key).join(', ')}`);
};

// L-14: while the detail's live pane is showing, `main` never scrolls horizontally. A streaming
// run's unbreakable text (long absolute paths, long commands) widens the pane's grids through
// intrinsic min-content sizing, and `main` is itself the horizontal scroller (its overflow-y
// forces overflow-x to auto) — so L-2, which reads the document, cannot see the spill; the scroll
// must be read on `main` itself, and only while the pane's hook is present and visible.
const l14 = async (page, ctx, sel) => {
  const missing = ['main', 'livePane'].find((k) => !sel[k]);
  if (missing) return skipped('L-14', missing);
  const m = await inPage(
    page,
    `const main = resolve(arg.main), live = resolve(arg.live);
    if (!main) return null;
    if (!live) return { pane: false };
    const r = live.getBoundingClientRect();
    const cs = getComputedStyle(live);
    const showing = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    return showing ? { pane: true, sw: main.scrollWidth, cw: main.clientWidth } : { pane: false };`,
    { main: sel.main, live: sel.livePane },
  );
  if (!m) return result('L-14', false, 'main element not found');
  if (!m.pane) return result('L-14', true, 'no live pane showing');
  return result('L-14', m.sw <= m.cw, `main scrollWidth ${m.sw} of clientWidth ${m.cw}`);
};

// L-15: an ask's unbreakable command never widens the surfaces that carry it. The seed's one ask
// rides a real queued run — the dispatcher raises it on its own cadence, first tick 5 s in — and
// it lands on two surfaces: the cockpit's attention row and the asking order's own detail, where
// the ask column ([data-detail-ask]) stands beside the live pane whose ask card carries the same
// command. The walk's own detay (İE-0006) never shows an ask, so the rule — measured on the
// cockpit, where the ask row lands first — waits the ask out, reads `main`'s scroll there, then
// follows the ask row's own title into the asking order's detail and reads `main` again, ending
// home so the walk's cockpit labels stay honest for the checks that follow. Geometry alone cannot
// tell the ask column's containment from luck — its texts stay short until a real run asks with a
// long one — so the rule also pins the shrink hooks the boxes between an ask's text and the
// column must carry: the ask list and every ask row may shrink below their content, the live
// pane's own lesson measured where an ask actually lives. A target whose ask command carries no
// unbroken run (the frozen prototype's short one) is not this rule's subject.
const ASK_HEAD = 'dotnet ef database update';
const ASK_WITNESS_MIN = 150;

const l15 = async (page, ctx, sel) => {
  if (ctx.screen !== 'kokpit') return result('L-15', true, 'only checked on the cockpit');
  const missing = ['main', 'detailAsk'].find((k) => !sel[k]);
  if (missing) return skipped('L-15', missing);
  // The wait is J-1's budget: the ask is the rule's subject, so its absence is a FAIL, not a skip.
  const up = await page
    .waitForFunction(
      (head) => [...document.querySelectorAll('main code')].some((el) => (el.textContent ?? '').includes(head)),
      ASK_HEAD,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!up) return result('L-15', false, `the seeded ask ("${ASK_HEAD}…") did not appear on the cockpit within 30 s`);
  const cockpit = await inPage(
    page,
    `const main = resolve(arg); if (!main) return null;
    const code = [...document.querySelectorAll('main code')].find((el) => (el.textContent || '').includes(${JSON.stringify(ASK_HEAD)}));
    return code ? { sw: main.scrollWidth, cw: main.clientWidth, len: code.textContent.trim().length } : null;`,
    sel.main,
  );
  if (!cockpit) return result('L-15', false, 'the ask row vanished before it could be measured');
  if (cockpit.len < ASK_WITNESS_MIN) {
    return result('L-15', true, `this target's ask carries no unbroken command (${cockpit.len} chars)`);
  }
  // The asking order's title button is the ask row's own door into its detail.
  const button = await page
    .evaluateHandle(
      (head) => {
        const code = [...document.querySelectorAll('main code')].find((el) => (el.textContent ?? '').includes(head));
        const row = code?.closest('div[class*="rounded-card"]');
        return row?.querySelector('button') ?? null;
      },
      ASK_HEAD,
    )
    .then((handle) => handle.asElement());
  if (button === null) return result('L-15', false, 'the ask row carries no title button to open its work order');
  await button.click({ timeout: 4000 });
  // The asks card is the ask column's first child once an ask of this work order is open on it.
  await page.waitForFunction(
    (colSel) => {
      const col = document.querySelector(colSel);
      if (col === null) return false;
      const card = col.firstElementChild;
      return card !== null && card.querySelector('ul li') !== null;
    },
    sel.detailAsk,
    { timeout: 5000 },
  );
  const detail = await inPage(
    page,
    `const main = resolve(arg.main), col = resolve(arg.col);
    if (!main || !col) return null;
    const card = col.firstElementChild;
    const ul = card?.querySelector('ul') ?? null;
    const rows = ul === null ? [] : [...ul.children];
    return {
      sw: main.scrollWidth, cw: main.clientWidth,
      listShrinks: ul !== null && ul.classList.contains('min-w-0'),
      rowsShrink: rows.length > 0 && rows.every((li) => li.classList.contains('min-w-0')),
      rows: rows.length,
    };`,
    { main: sel.main, col: sel.detailAsk },
  );
  // Home again, so the walk's cockpit labels stay honest for the checks that follow the rules.
  await page.getByRole('button', { name: 'Anasayfa' }).first().click({ timeout: 4000 });
  if (!detail) return result('L-15', false, "the asking detail's ask column did not measure");
  const bad = [];
  if (cockpit.sw > cockpit.cw) bad.push(`cockpit main scrollWidth ${cockpit.sw} of ${cockpit.cw}`);
  if (detail.sw > detail.cw) bad.push(`detail main scrollWidth ${detail.sw} of ${detail.cw}`);
  if (!detail.listShrinks) bad.push('the ask list cannot shrink below its content');
  if (!detail.rowsShrink) bad.push(`${detail.rows} ask row(s) cannot shrink below their content`);
  return result(
    'L-15',
    bad.length === 0,
    bad.length === 0
      ? `cockpit and the asking detail contained; ${detail.rows} ask row(s) shrinkable`
      : bad.join('; '),
  );
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
  ['L-13', l13],
  ['L-14', l14],
  ['L-15', l15],
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

// --- the skeletons' own measurement (U-26) -----------------------------------------------------------
// Unlike the L rules, these run mid-load: the audit's --slow pass calls them while the delayed
// replies are still in flight, then again once the content has replaced the compositions. The
// holder is tagged on the first pass so the second pass can find the same element after the
// composition is gone.

/** How far the holder's height may move when the real content lands (U-26: same paddings and
 *  row heights, so nothing jumps). */
export const SKELETON_HEIGHT_TOLERANCE_PX = 8;

/** Measure every visible `[data-skeleton]` composition (U-26): each must sit inside its holder
 *  and, L-3's notion, inside every clipping ancestor horizontally; the holder is tagged
 *  `data-skeleton-holder` and its height recorded, so the second pass can see whether the
 *  content that replaces the composition moves it. Pure DOM measurement, no waiting. */
export async function measureSkeletons(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const out = [];
    for (const el of document.querySelectorAll('[data-skeleton]')) {
      if (!visible(el)) continue;
      const holder = el.parentElement;
      if (holder === null) continue;
      holder.setAttribute('data-skeleton-holder', '');
      const r = el.getBoundingClientRect();
      const h = holder.getBoundingClientRect();
      // L-3's horizontal containment: past the right edge of a clipping ancestor is a defect.
      let left = 0;
      let right = innerWidth;
      for (let p = holder; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === 'visible') continue;
        const pr = p.getBoundingClientRect();
        left = Math.max(left, pr.left);
        right = Math.min(right, pr.right);
      }
      out.push({
        blocks: el.querySelectorAll('[data-skeleton-block]').length,
        holderHeight: h.height,
        insideHolder: r.left >= h.left - 0.5 && r.right <= h.right + 0.5 && r.bottom <= h.bottom + 0.5,
        contained: r.left >= left - 0.5 && r.right <= right + 0.5,
      });
    }
    return out;
  });
}

/** The second pass, after the compositions are gone: every tagged holder's height now, to
 *  compare against the recorded one — and the tags are cleared, so a later measurement starts
 *  clean. Pure DOM measurement, no waiting. */
export async function measureSkeletonHolders(page) {
  return page.evaluate(() => {
    const out = [];
    for (const holder of document.querySelectorAll('[data-skeleton-holder]')) {
      out.push(holder.getBoundingClientRect().height);
      holder.removeAttribute('data-skeleton-holder');
    }
    return out;
  });
}

/** Pure: compare the two passes. Every composition must have been contained, and every holder
 *  must sit still within the tolerance. Returns { ok, detail } in the rules' own shape. */
export function skeletonVerdict(before, after) {
  if (before.length === 0) return { ok: false, detail: 'no skeleton composition appeared' };
  const stray = before.filter((m) => !m.insideHolder || !m.contained).length;
  const blocks = before.reduce((sum, m) => sum + m.blocks, 0);
  if (stray > 0) {
    return { ok: false, detail: `${before.length} compositions, ${blocks} blocks, ${stray} outside their holder or screen` };
  }
  if (after.length !== before.length) {
    return { ok: false, detail: `${before.length} holders measured, ${after.length} found again` };
  }
  const deltas = before.map((m, i) => after[i] - m.holderHeight);
  const worst = Math.max(...deltas.map(Math.abs));
  if (worst > SKELETON_HEIGHT_TOLERANCE_PX) {
    const moves = before
      .map((m, i) => `${m.holderHeight.toFixed(0)}→${after[i].toFixed(0)}`)
      .join(' ');
    return { ok: false, detail: `${before.length} compositions, ${blocks} blocks contained, holder moved ${worst.toFixed(1)}px (tolerance ${SKELETON_HEIGHT_TOLERANCE_PX}) [${moves}]` };
  }
  return {
    ok: true,
    detail: `${before.length} compositions, ${blocks} blocks contained; holder Δ ${deltas.map((d) => d.toFixed(1)).join('/')}px`,
  };
}
