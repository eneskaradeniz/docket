// e2e/audit-design-once.mjs — one-off: measures EVERY atelier page for layout defects the operator
// asked about (the hanging Yenile being the confirmed specimen): lone actions under headings,
// off-grid vertical gaps, left-edge misalignment, stray type sizes, pressured truncation, sibling
// overlaps — plus a text outline per page. DOM measurements, never screenshots.
// Usage: node e2e/audit-design-once.mjs [port]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '61424';
const BASE = `http://127.0.0.1:${PORT}/api/projects/docket-3a1c/raw`;
const PAGES = JSON.parse(readFileSync('/tmp/docket-design-capture2/manifest.json', 'utf8')).map((e) => `${e.name}.html`);

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });

const audit = () =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    const out = { lone: [], gaps: [], xedges: [], sizes: [], trunc: [], overlap: [], outline: [], headerOrder: [], headerSkew: [] };

    // ---- WO-0083: the header chrome is audited too — order line + vertical-center mismatches
    const header = document.querySelector('header');
    if (header) {
      const hr = header.getBoundingClientRect();
      const headerCy = hr.top + hr.height / 2;
      const cluster = header.querySelector('header .ml-auto') ?? header;
      const labels = [...cluster.querySelectorAll(':scope > *')].map((k) =>
        (k.getAttribute('aria-label') ?? k.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 16) || k.tagName,
      );
      out.headerOrder = labels.join(' › ');
      header.querySelectorAll('*').forEach((el) => {
        if (el.children.length > 0) return;
        if (el.closest('.sr-only')) return; // visually-hidden announcers — geometry is meaningless
        const r = el.getBoundingClientRect();
        if (r.height === 0) return;
        if (r.top < hr.bottom - 1 || r.bottom > hr.top + hr.height + 1) return; // overlays below/above the bar
        const cy = r.top + r.height / 2;
        if (Math.abs(cy - headerCy) > 2) {
          const label = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 14);
          out.headerSkew.push(`"${label}" merkezi ${(cy - headerCy).toFixed(1)}px kayık`);
        }
      });
      out.headerSkew = [...new Set(out.headerSkew)].slice(0, 5);
    }

    // ---- outline (headings, rendered case) + section order
    main.querySelectorAll('h1,h2,h3,.readout').forEach((h) => {
      const t = (h.textContent ?? '').trim();
      if (t) out.outline.push(t.slice(0, 44));
    });
    out.outline = [...new Set(out.outline)].slice(0, 14);

    // ---- lone actions: a short button sitting on its OWN row, under a heading
    const headings = [...main.querySelectorAll('h1,h2,h3,.readout')];
    main.querySelectorAll('button').forEach((b) => {
      const t = (b.textContent ?? '').trim();
      if (!t || t.length > 16 || b.closest('[role="dialog"]')) return;
      const r = b.getBoundingClientRect();
      if (r.width === 0) return;
      const head = headings.find((h) => {
        const hr = h.getBoundingClientRect();
        return hr.top < r.top && r.top - hr.bottom < 34 && Math.abs(hr.left - r.left) < 900;
      });
      if (!head) return;
      // alone on the row = no visible sibling sharing its vertical band
      const sibs = [...(b.parentElement?.children ?? [])].filter((s) => s !== b && s.getBoundingClientRect().height > 0);
      const alone = !sibs.some((s) => {
        const sr = s.getBoundingClientRect();
        return sr.top < r.bottom && sr.bottom > r.top;
      });
      if (alone) out.lone.push(`"${(head.textContent ?? '').trim().slice(0, 20)}" başlığının altında tek başına: "${t}"`);
    });
    out.lone = [...new Set(out.lone)].slice(0, 6);

    // ---- off-grid VERTICAL gaps: flex-col rowGap or margins between stacked block siblings
    const tally = new Map();
    const flag = (v) => {
      if (v <= 0 || v % 4 === 0) return;
      const k = `${Math.round(v * 10) / 10}px`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    };
    main.querySelectorAll('div,ul,section').forEach((parent) => {
      const cs = getComputedStyle(parent);
      const kids = [...parent.children].filter((k) => {
        const ks = getComputedStyle(k);
        return ks.position === 'static' && k.getBoundingClientRect().height > 4 && ks.display !== 'none';
      });
      if (kids.length < 2) return;
      const col = cs.display.includes('flex') && cs.flexDirection === 'column';
      const grid = cs.display.includes('grid');
      if (col || grid) flag(parseFloat(cs.rowGap));
      else {
        for (let i = 1; i < kids.length; i++) {
          const a = getComputedStyle(kids[i - 1]);
          const b = getComputedStyle(kids[i]);
          if (a.display.includes('flex') && !a.display.includes('column')) continue; // row: gap is horizontal
          flag((parseFloat(b.marginTop) || 0) + (parseFloat(a.marginBottom) || 0));
        }
      }
    });
    out.gaps = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, n]) => `${v}×${n}`);

    // ---- left-edge misalignment among card-ish blocks
    const xs = new Map();
    main.querySelectorAll('div,section,ul').forEach((el) => {
      const cs = getComputedStyle(el);
      const hasEdge = cs.borderTopWidth !== '0px' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      if (!hasEdge) return;
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 24) return;
      const x = Math.round(r.left);
      xs.set(x, (xs.get(x) ?? 0) + 1);
    });
    const dom = [...xs.entries()].sort((a, b) => b[1] - a[1]);
    if (dom.length > 1 && dom[0][1] >= 2) {
      const wrong = dom.slice(1).filter(([x, n]) => Math.abs(x - dom[0][0]) > 6 && n === 1);
      out.xedges = wrong.slice(0, 4).map(([x]) => `sol kenar ${x}px (baskın ${dom[0][0]}px)`);
    }

    // ---- type sizes actually rendered
    const sizes = new Set();
    main.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0 && (el.textContent ?? '').trim()) sizes.add(getComputedStyle(el).fontSize);
    });
    out.sizes = [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(' ');

    // ---- pressured truncation: ellipsised text whose row still has free room to its right
    main.querySelectorAll('.truncate, [class*="truncate"]').forEach((el) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const r = el.getBoundingClientRect();
      const row = el.parentElement?.getBoundingClientRect();
      if (!row) return;
      const free = row.right - r.right;
      if (free > r.width * 0.4) out.trunc.push(`"${(el.textContent ?? '').trim().slice(0, 30)}" kırpılmış ama sağda ${Math.round(free)}px boş`);
    });
    out.trunc = [...new Set(out.trunc)].slice(0, 4);

    // ---- sibling overlaps (visible, non-overlay)
    main.querySelectorAll('div,section').forEach((parent) => {
      const kids = [...parent.children].filter((k) => {
        const ks = getComputedStyle(k);
        return ks.position === 'static' && k.getBoundingClientRect().height > 4;
      });
      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[i + 1].getBoundingClientRect();
        const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (dy > 4) out.overlap.push(`${kids[i].tagName}(${(kids[i].textContent ?? '').trim().slice(0, 14)}) ↰ ${(kids[i + 1].textContent ?? '').trim().slice(0, 14)}`);
      }
    });
    out.overlap = [...new Set(out.overlap)].slice(0, 4);
    return out;
  });

for (const p of PAGES) {
  await page.goto(`${BASE}/${p}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const r = await audit();
  const findings = [];
  if (r.lone.length) findings.push(`TEK EYLEM: ${r.lone.join(' · ')}`);
  if (r.gaps.length) findings.push(`dikey boşluk: ${r.gaps.join(' ')}`);
  if (r.xedges.length) findings.push(r.xedges.join(' · '));
  if (r.trunc.length) findings.push(`kırpma: ${r.trunc.join(' · ')}`);
  if (r.overlap.length) findings.push(`ÇAKIŞMA: ${r.overlap.join(' · ')}`);
  console.log(`\n### ${p.replace('.html', '')}`);
  console.log(`  yapı: ${r.outline.join(' › ')}`);
  if (r.headerOrder) console.log(`  appbar: ${r.headerOrder}`);
  if (r.headerSkew.length) findings.push(`APPBAR MERKEZ: ${r.headerSkew.join(' · ')}`);
  console.log(`  punto: ${r.sizes}`);
  findings.forEach((f) => console.log(`  ⚠ ${f}`));
}

await browser.close();
console.log('\naudit done');
