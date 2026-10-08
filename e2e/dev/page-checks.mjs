// e2e/dev/page-checks.mjs — the dev session's page checks, the UI side of the docket-dev bridge
// (#820). Where e2e/layout-rules.mjs measures the shell's own layout contract (L-1 … L-13), these
// walk the page a CDP session lands on for reachability defects a screen reader or a keyboard
// hits: controls without an accessible name, content hidden from the eye but reachable by Tab,
// targets smaller than a fingertip, and boxes that cross the viewport. The policies are pure —
// the measurements arrive from one page.evaluate, the verdicts run anywhere — so node:test proves
// each rule with fixtures, the layout-rules.test.mjs pattern.
//
// PC-2 is the pilot's own case: a pane collapsed to zero height whose buttons stayed focusable.
// Hiding is legitimate only together with `inert`, which removes the content from the tab order.

export const PAGE_CHECK_IDS = ['PC-1', 'PC-2', 'PC-3', 'PC-4'];

/** The smallest interactive target, in CSS px. */
export const MIN_TARGET_PX = 24;

const result = (id, ok, detail) => ({ id, ok, detail });
const EDGE = 0.5;

// --- the policies (pure) ------------------------------------------------------------------------------

/** PC-1: every interactive control needs an accessible name; blank after trim is a failure. */
export const pc1Failures = (rows) => rows.filter((row) => row.name.trim() === '');

/** PC-2: a focusable element inside a hidden ancestor fails unless the ancestor is also inert. */
export const pc2Failures = (rows) => rows.filter((row) => row.cause !== null && !row.inert);

/** PC-3: an interactive target smaller than the minimum in either dimension. */
export const pc3Failures = (rows, minPx = MIN_TARGET_PX) =>
  rows.filter((row) => row.width < minPx - EDGE || row.height < minPx - EDGE);

/** PC-4: a visible box that crosses the viewport's edges; a box flush with them passes. */
export const pc4Failures = (rows) =>
  rows.filter(
    (row) =>
      row.left < -EDGE || row.top < -EDGE || row.right > row.vw + EDGE || row.bottom > row.vh + EDGE,
  );

/** The verdict row per check id, in the layout rules' own { id, ok, detail } shape. */
export function verdictsFromMeasurements(m) {
  const nameless = pc1Failures(m.unnamed);
  const hidden = pc2Failures(m.hiddenReachable);
  const small = pc3Failures(m.smallTargets);
  const crossing = pc4Failures(m.crossing);
  return [
    result(
      'PC-1',
      nameless.length === 0,
      nameless.length === 0
        ? `${m.unnamed.length} interactive control(s) measured, all named`
        : `${nameless.length} unnamed: ${nameless.slice(0, 3).map((row) => `<${row.tag}>`).join(', ')}`,
    ),
    result(
      'PC-2',
      hidden.length === 0,
      hidden.length === 0
        ? `${m.hiddenReachable.length} focusable in hidden context(s) measured, none reachable`
        : `${hidden.length} reachable while hidden: ${hidden.slice(0, 3).map((row) => `${row.desc} (${row.cause})`).join('; ')}`,
    ),
    result(
      'PC-3',
      small.length === 0,
      small.length === 0
        ? `${m.smallTargets.length} interactive target(s) at least ${MIN_TARGET_PX}x${MIN_TARGET_PX}`
        : `${small.length} under ${MIN_TARGET_PX}px: ${small.slice(0, 3).map((row) => `${row.desc} ${Math.round(row.width)}x${Math.round(row.height)}`).join('; ')}`,
    ),
    result(
      'PC-4',
      crossing.length === 0,
      crossing.length === 0
        ? `${m.crossing.length} box(es) measured, none crosses the viewport`
        : `${crossing.length} crossing: ${crossing.slice(0, 3).map((row) => `${row.desc} [${Math.round(row.left)},${Math.round(row.top)} ${Math.round(row.right)},${Math.round(row.bottom)} of ${row.vw}x${row.vh}]`).join('; ')}`,
    ),
  ];
}

// --- the measurement (one page.evaluate) ---------------------------------------------------------------

/** Runs in the page. The accessible-name computation is the pragmatic approximation browsers'
 *  own algorithms converge on from the DOM: aria-label, aria-labelledby's text, an image's alt,
 *  a field's value/placeholder or its label, the title, then the text content. */
const COLLECT = `(() => {
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const describe = (el) =>
    (el.getAttribute('aria-label') || el.id && '#' + el.id || el.tagName.toLowerCase()).slice(0, 40);
  const nameOf = (el) => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (text.trim() !== '') return text;
    }
    const label = el.getAttribute('aria-label');
    if (label !== null && label.trim() !== '') return label;
    if (el instanceof HTMLImageElement) return el.alt ?? '';
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) return el.value ?? '';
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const wrapLabel = el.closest('label');
    const labelText = (forLabel ?? wrapLabel)?.textContent ?? '';
    if (labelText.trim() !== '') return labelText;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder !== null && placeholder.trim() !== '') return placeholder;
    const title = el.getAttribute('title');
    if (title !== null && title.trim() !== '') return title;
    return el.textContent ?? '';
  };

  const interactive = [...document.querySelectorAll(INTERACTIVE)];
  const unnamed = interactive
    .filter((el) => visible(el))
    .map((el) => ({ tag: el.tagName.toLowerCase(), name: nameOf(el) }))
    .filter((row) => row.name.trim() === '');

  const hiddenReachable = [];
  for (const el of document.querySelectorAll(FOCUSABLE)) {
    let cause = null;
    let inert = false;
    for (let node = el; node !== null && node instanceof Element; node = node.parentElement) {
      if (node.inert === true) inert = true;
      if (cause === null) {
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        if ((r.height <= 0 || r.width <= 0) && node !== el) cause = 'ancestor-zero-height';
        else if (cs.visibility === 'hidden' && node !== el) cause = 'visibility-hidden';
        else if (node.getAttribute('aria-hidden') === 'true' && node !== el) cause = 'aria-hidden';
      }
    }
    if (cause !== null) hiddenReachable.push({ desc: describe(el), cause, inert });
  }

  const smallTargets = interactive
    .filter((el) => visible(el))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { desc: describe(el), width: r.width, height: r.height };
    });

  const inScrollContainer = (el) => {
    for (let node = el.parentElement; node !== null && node instanceof Element; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll') return true;
    }
    return false;
  };
  const crossing = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || inScrollContainer(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
      crossing.push({ desc: describe(el), left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight });
    }
  }

  return { unnamed, hiddenReachable, smallTargets, crossing };
})()`;

/** Measures the page once and returns the four row sets the policies read. */
export async function measurePageChecks(page) {
  return page.evaluate(COLLECT);
}

/** One walk: measurements in, verdict rows out (the layout rules' own shape). */
export async function runPageChecks(page) {
  return verdictsFromMeasurements(await measurePageChecks(page));
}

/** The permission asks the page currently offers, both UI sides at once: the query result the
 *  page's own store lives on (the exact `permissions.open` answer the app renders from) and the
 *  ask rows the detail pane currently shows — so a session can hold both against
 *  `store.read open_asks` and catch the layer that disagrees. */
export async function uiOpenAsks(page) {
  const domAskRows = await page.evaluate(() => document.querySelectorAll('[data-detail-ask] li').length);
  const query = await page.evaluate(() =>
    window.docket === undefined ? null : window.docket.query({ type: 'permissions.open' }),
  );
  return { query, domAskRows };
}
