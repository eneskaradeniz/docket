// e2e/assemble-design.mjs — assembles the design package from a capture run: rewrites each
// dumped page (fonts → self-hosted @fontsource files, inject app-nav.js + data-back), emits the
// nav script, the font package and the manifest-driven gallery.
// Usage: node e2e/assemble-design.mjs <captureDir> <outDir>
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IN = resolve(process.argv[2] ?? '/tmp/docket-design-capture2');
const OUT = resolve(process.argv[3] ?? join(IN, 'package'));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(IN, 'manifest.json'), 'utf8'));
// the shots-once rerun pushed modal-app-ayar twice — the LAST entry wins, names stay unique
const seen = new Set();
const pages = manifest.filter((e) => (seen.has(e.name) ? false : seen.add(e.name)));
mkdirSync(join(OUT, 'styles'), { recursive: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });
copyFileSync(join(IN, 'app.css'), join(OUT, 'styles/app.css'));
// the compiled css still carries the app's own @font-face rules — vite-hashed file refs that 404
// outside Electron and shadow the self-hosted package; the fontsource fonts.css owns all faces
{
  const p = join(OUT, 'styles/app.css');
  let css = readFileSync(p, 'utf8').replace(/@font-face\s*\{[^}]*\}\s*/g, '');
  writeFileSync(p, css);
}

// ===== fonts: the app's OWN @fontsource files, verbatim (no Google dependency, no metric drift)
let fontsCss = '';
for (const [pkg, family, weights] of [
  ['manrope', 'Manrope', [400, 500, 600, 700, 800]],
  ['ibm-plex-mono', 'IBM Plex Mono', [400, 500, 600]],
]) {
  for (const w of weights) {
    let css = readFileSync(join(ROOT, 'node_modules', '@fontsource', pkg, `${w}.css`), 'utf8');
    for (const m of css.matchAll(/url\(["']?\.\/files\/([^"')]+)["']?\)/g)) {
      copyFileSync(join(ROOT, 'node_modules', '@fontsource', pkg, 'files', m[1]), join(OUT, 'fonts', m[1]));
    }
    css = css.replace(/url\(["']?\.\/files\//g, 'url("../fonts/');
    fontsCss += css + '\n';
  }
}
writeFileSync(join(OUT, 'styles/fonts.css'), fontsCss);

// ===== the one shared navigation layer: board cards → detail pages, esc/back → board, appbar
// segments → the representative screen page, dialogs close by their own affordances, the settings
// menu walks its panels. Convenience chrome for review — pages stay verbatim captures.
writeFileSync(
  join(OUT, 'app-nav.js'),
  `(function () {
  var MAP = [
    ['Yeni iş emri örneği', 'detail-plan-yok.html'],
    ['Plan bekliyor', 'detail-plan-bekliyor.html'],
    ['İzin bekliyor', 'detail-izin-bekliyor.html'],
    ['Uygulama sürüyor', 'detail-uygulama-suruyor.html'],
    ['Kapandı', 'detail-kapandi.html'],
    ['Ajan arşivi', 'detail-ajan-arsivi.html'],
    ['Yol yetim', 'detail-yetim.html'],
    ['Kapı işi A', 'detail-butce-kapisi.html']
  ];
  var SEG = { 'Pano': 'board.html', 'Yol Haritası': 'roadmap-yol.html', 'Kullanım': 'usage.html', 'Genel bakış': 'overview.html' };
  var MENU = { 'Modeller': 'modal-app-ayar.html', 'İstem şablonları': 'modal-app-ayar-sablonlar.html', 'Genel': 'modal-app-ayar-genel.html' };
  function go(h) { location.href = h; }
  var back = document.body.getAttribute('data-back');
  document.querySelectorAll('[data-wo-id]').forEach(function (card) {
    var t = card.textContent || '';
    for (var i = 0; i < MAP.length; i++) {
      if (t.indexOf(MAP[i][0]) !== -1) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', function (h) { return function () { go(h); }; }(MAP[i][1]));
        break;
      }
    }
  });
  document.querySelectorAll('button[aria-label="← İş emirleri"]').forEach(function (b) {
    b.addEventListener('click', function () { go(back || 'board.html'); });
  });
  document.querySelectorAll('header [role="group"] button').forEach(function (b) {
    var t = (b.textContent || '').trim();
    if (SEG[t]) b.addEventListener('click', function () { go(SEG[t]); });
  });
  var chip = document.querySelector('header button.irow');
  if (chip && (chip.textContent || '').indexOf('▾') !== -1) chip.addEventListener('click', function () { go('dropdown-ws-secici.html'); });
  // workspace rows (dropdown + full list) lead to that workspace's board page
  var WSBOARD = { 'e2e': 'board.html', 'yol': 'board-yol.html', 'uyarı': 'board-uyari.html', 'kapı': 'board-kapi.html' };
  document.querySelectorAll('button').forEach(function (b) {
    var t = (b.textContent || '').trim();
    for (var k in WSBOARD) {
      if (t.indexOf(k) === 0) { b.addEventListener('click', function (h) { return function () { go(h); }; }(WSBOARD[k])); break; }
    }
    if (/Tümünü gör/.test(t)) b.addEventListener('click', function () { go('modal-ws-listesi.html'); });
  });
  var st = document.querySelector('button[aria-label="Ayarlar"]');
  if (st) st.addEventListener('click', function () { go('modal-app-ayar.html'); });
  // dialogs: the ✕/Vazgeç affordances close; a click OUTSIDE the dialog (Radix's overlay is
  // pointer-events:none under the scroll lock, so the event lands on the root) returns too
  document.querySelectorAll('[role="dialog"]').forEach(function (d) {
    d.querySelectorAll('button').forEach(function (b) {
      var a = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      if (/kapat|vazgeç/i.test(a)) b.addEventListener('click', function () { go(back || 'board.html'); });
    });
  });
  document.addEventListener('click', function (e) {
    if (!back || !document.querySelector('[role="dialog"]')) return;
    var t = e.target instanceof Element ? e.target : document.documentElement;
    if (t.closest('[role="dialog"]') || t.closest('header')) return;
    go(back);
  });
  document.querySelectorAll('[data-settings-menu] button').forEach(function (b) {
    var t = (b.textContent || '').trim();
    if (MENU[t]) b.addEventListener('click', function () { go(MENU[t]); });
  });
  // the health section's head toggles between the collapsed and the captured-open page
  var hbtn = document.querySelector('[data-overview-health] > button');
  if (hbtn) hbtn.addEventListener('click', function () {
    go(/health-open\.html$/.test(location.href) ? 'overview.html' : 'overview-health-open.html');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && back) go(back); });
})();
`,
);

// ===== pages
const FONTLINK = '<link rel="stylesheet" href="styles/fonts.css">';
for (const { name, back } of pages) {
  let h = readFileSync(join(IN, `${name}.html`), 'utf8');
  h = h.replace(/<script type="module"[^>]*><\/script>\s*/, '');
  h = h.replace(/<link rel="stylesheet"[^>]*>/, `${FONTLINK}\n    <link rel="stylesheet" href="styles/app.css">`);
  h = h.replace(/<link rel="preconnect"[^>]*>\s*<link rel="preconnect"[^>]*>\s*/g, ''); // previous uploads' Google links die here
  h = h.replace('<head>', `<head>\n    <title>Docket · ${name}</title>`);
  if (back) h = h.replace(/<body([^>]*)>/, `<body$1 data-back="${back}">`);
  h = h.replace('</body>', '<script src="app-nav.js" defer></script>\n</body>');
  writeFileSync(join(OUT, `${name}.html`), h);
}

// ===== gallery — manifest-driven, grouped by section in capture order
const sections = [];
for (const e of pages) {
  let s = sections.find((x) => x.name === e.section);
  if (!s) sections.push((s = { name: e.section, items: [] }));
  s.items.push(e);
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const item = (e) =>
  `<a href="${e.name}.html" style="display:flex;align-items:baseline;gap:10px;border:1px solid var(--color-hairline);border-radius:7px;padding:10px 12px;"><span style="font-size:13px;font-weight:500;color:var(--color-ink);">${esc(e.title)}</span><span style="font-family:var(--font-mono);font-size:11px;color:var(--color-inkdim);margin-left:auto;">${e.name}.html</span></a>`;
const section = (s) =>
  `<h2 class="readout" style="margin:26px 0 10px;">${esc(s.name)} · ${s.items.length}</h2><div style="display:flex;flex-direction:column;gap:8px;">${s.items.map(item).join('')}</div>`;
writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html>
<html lang="tr" data-theme="dark">
<head>
  <meta charset="utf-8">
  <title>Docket — Tasarım Atölyesi</title>
  ${FONTLINK}
  <link rel="stylesheet" href="styles/app.css">
</head>
<body>
  <main style="max-width:680px;margin:0 auto;padding:56px 24px 80px;">
    <div class="readout" style="margin-bottom:10px;">Docket · Tasarım Atölyesi</div>
    <h1 style="font-size:20px;font-weight:600;letter-spacing:-0.01em;margin-bottom:10px;">Birebir port — ${pages.length} sayfa</h1>
    <p style="color:var(--color-inkdim);font-size:13px;line-height:1.65;margin-bottom:6px;">
      Gerçek uygulamanın DOM'u ve derlenmiş CSS'i, E2E seed dünyası üzerinde yakalandı; fontlar
      uygulamanın kendi dosyalarıyla self-host. Kartlar tıklanır (detaya gider),
      <code style="font-family:var(--font-mono);font-size:12px;background:var(--color-raised);padding:1px 6px;border-radius:4px;">esc</code> geri döner,
      üst şerit sekmeleri ekranlar arası geçer, diyaloglar kendi ✕/Vazgeç'i ve zemin tıklamasıyla
      kapanır — hepsi inceleme için eklenmiş gezinme takozu; sayfaların kendisi birebir yakalama.
    </p>
    <p style="color:var(--color-inkdim);font-size:12px;line-height:1.6;margin-bottom:8px;">
      Not: sekmeler her sayfada temsilî sayfaya gider (ör. Yol Haritası → zengin 'yol' dünya yüzü).
      Onaylanan her cila turu bir WO olarak <code style="font-family:var(--font-mono);font-size:12px;background:var(--color-raised);padding:1px 6px;border-radius:4px;">src/ui</code>'a portlanır; final karar uygulama içi manuel turda alınır.
    </p>
    ${sections.map(section).join('\n    ')}
  </main>
</body>
</html>
`,
);
console.log(`assembled ${pages.length} pages → ${OUT}`);
