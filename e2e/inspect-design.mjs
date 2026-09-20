// e2e/inspect-design-once.mjs — one-off: drives a real Chromium against the OD raw preview and
// reports PRECISE layout facts per page (overflow, error leaks, spacing rhythm outliers, font
// state, measure) — no screenshot interpretation. Deleted after the critique round.
// Usage: node e2e/inspect-design-once.mjs [port]
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '61424';
const BASE = `http://127.0.0.1:${PORT}/api/projects/docket-3a1c/raw`;
const PAGES = [
  'board.html', 'overview.html', 'usage.html', 'roadmap-yol.html',
  'detail-plan-bekliyor.html', 'detail-kapandi.html', 'detail-izin-bekliyor-dokum.html',
  'modal-ws-ayar.html', 'modal-app-ayar.html',
];

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });

const audit = () =>
  page.evaluate(() => {
    const out = {};
    // 1) horizontal overflow anywhere that doesn't opt into clipping
    out.overflow = [];
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (el.scrollWidth - el.clientWidth > 1 && cs.overflowX === 'visible' && el.clientWidth > 0) {
        out.overflow.push(`${el.tagName}.${String(el.className).split(' ').slice(0, 3).join('.')} +${el.scrollWidth - el.clientWidth}px`);
      }
    });
    out.overflow = out.overflow.slice(0, 8);
    // 2) raw error leaks (developer words on the surface)
    out.leaks = [];
    const RE = /fatal|unparseable|Traceback|EPERM|ENOENT|stderr|Error:/i;
    document.querySelectorAll('main *').forEach((el) => {
      if (el.children.length === 0 && RE.test(el.textContent ?? '') && (el.textContent ?? '').trim().length < 200) {
        const cs = getComputedStyle(el);
        out.leaks.push(`[${el.tagName}.${String(el.className).split(' ').slice(0, 2).join('.')}] ${el.textContent.trim().slice(0, 90)} | color=${cs.color} font=${cs.fontFamily.split(',')[0]} size=${cs.fontSize}`);
      }
    });
    out.leaks = out.leaks.slice(0, 6);
    // 3) spacing rhythm: distinct vertical gaps inside flowing containers (flag non-4px-grid values)
    const gaps = new Map();
    document.querySelectorAll('main section, main ul, main div').forEach((parent) => {
      if (parent.children.length < 3) return;
      const kids = [...parent.children].filter((k) => {
        const cs = getComputedStyle(k);
        return cs.position === 'static' && k.clientHeight > 8;
      });
      if (kids.length < 3) return;
      for (let i = 1; i < kids.length; i++) {
        const prev = getComputedStyle(kids[i - 1]);
        const cur = getComputedStyle(kids[i]);
        const gap = (parseFloat(cur.marginTop) || 0) + (parseFloat(prev.marginBottom) || 0);
        const pd = parseFloat(getComputedStyle(parent).rowGap || getComputedStyle(parent).gap) || 0;
        const total = Math.round((gap || pd) * 10) / 10;
        if (total > 0) gaps.set(total, (gaps.get(total) ?? 0) + 1);
      }
    });
    out.gaps = [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([v, n]) => `${v}px ×${n}${v % 4 !== 0 ? '  ← off-grid' : ''}`);
    // 4) measure: widest text-only leaf
    let widest = null;
    document.querySelectorAll('main p, main div, main span, main li').forEach((el) => {
      if (el.children.length === 0 && (el.textContent ?? '').trim().length > 60) {
        const w = el.getBoundingClientRect().width;
        if (!widest || w > widest.w) widest = { w: Math.round(w), text: (el.textContent ?? '').trim().slice(0, 50) };
      }
    });
    out.widestText = widest;
    // 5) font truth
    out.fonts = {
      body: getComputedStyle(document.body).fontFamily.split(',').slice(0, 2).join(','),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`).slice(0, 6),
    };
    return out;
  });

for (const p of PAGES) {
  await page.goto(`${BASE}/${p}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const r = await audit();
  console.log(`\n===== ${p} =====`);
  if (r.overflow.length) console.log('  overflow:', r.overflow.join(' | '));
  else console.log('  overflow: none');
  if (r.leaks.length) r.leaks.forEach((l) => console.log('  LEAK  ' + l));
  console.log('  gaps:', r.gaps.length ? r.gaps.join(' · ') : '—');
  if (r.widestText) console.log(`  widest text: ${r.widestText.w}px "${r.widestText.text}"`);
  console.log(`  fonts: body=${r.fonts.body} loaded=[${r.fonts.loaded.join(', ')}]`);
}

// targeted reads: the appbar CTA caret oddity + ForgeSection error row anatomy
await page.goto(`${BASE}/board.html`, { waitUntil: 'networkidle' });
const cta = await page.evaluate(() => {
  const b = [...document.querySelectorAll('header button')].find((x) => (x.textContent ?? '').includes('Yeni iş emri'));
  return b ? b.innerHTML.slice(0, 220) : 'not found';
});
console.log('\n===== appbar CTA markup =====\n' + cta);
const forge = await page.evaluate(() => {
  const el = [...document.querySelectorAll('main *')].find((x) => /unparseable/.test(x.textContent ?? '') && x.children.length === 0);
  if (!el) return 'no leak node';
  const card = el.closest('section, div');
  const cs = getComputedStyle(el);
  return `node=${el.tagName}.${el.className} | fs=${cs.fontSize} lh=${cs.lineHeight} color=${cs.color}\nparent chain: ${(() => { let c = el, out = []; for (let i = 0; i < 4 && c; i++) { c = c.parentElement; out.push(`${c?.tagName}.${String(c?.className).split(' ').slice(0, 2).join('.')}`); } return out.join(' > '); })()}`;
});
console.log('===== forge leak anatomy =====\n' + forge);

await browser.close();
console.log('\ninspect done');
