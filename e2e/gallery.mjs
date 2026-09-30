// e2e/gallery.mjs — the operator's-eyes gallery: for every screen in the run's combinations, a
// screenshot of the built app next to the rev-8 reference PNG, written to
// e2e/.out/gallery/index.html. It does not block a merge; it exists so the architect and the
// operator compare the two by looking. The combinations follow the default plan — dark at every
// size, light at the default window; `--full` (FULL=1 for the npm script) restores all six.
//
// Screens the app cannot reach yet (labels missing from the current shell) get an "unreachable"
// tile instead of an app image, so the grid still shows what the reference expects there.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, launchDesignApp, screenNavigator, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { SCREENS, comboPlan, resolveSizes } from './layout-rules.mjs';

const REF_DIR = process.env.DOCKET_REV8_REF ?? join(homedir(), 'source', 'docket-tasarim', 'rev8', 'ref');
const OUT = join(ROOT, 'e2e', '.out', 'gallery');
mkdirSync(join(OUT, 'app'), { recursive: true });
await acquireE2eLock(ROOT);

const full = process.argv.includes('--full') || process.env.FULL === '1';
const handle = await launchDesignApp();
const goto = screenNavigator(handle.page);
// The plan resolves against the app's own display: full screen is the real work area, so the
// app tiles carry this machine's numbers and pair with a reference only where one of the same
// size exists (the 1024x640 set).
const sizes = await resolveSizes(handle.app);
const tiles = [];

for (const { size: entry, theme } of comboPlan(sizes, { full })) {
  const [width, height] = entry.size;
  await setWindow(handle, entry.size, theme);
  for (const screen of SCREENS) {
    const name = `${screen}-${width}x${height}-${theme}`;
    let app = null;
    try {
      await goto[screen]();
      await handle.page.waitForTimeout(450);
      await handle.page.screenshot({ path: join(OUT, 'app', `${name}.png`) });
      app = `app/${name}.png`;
    } catch (error) {
      console.log(`unreachable ${name}: ${String(error).split('\n')[0]}`);
    }
    const ref = join(REF_DIR, `${name}.png`);
    tiles.push({ name, screen, size: `${width}x${height}`, theme, app, ref: existsSync(ref) ? pathToFileURL(ref).href : null });
  }
}
await handle.app.close();

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const img = (src, alt) => (src ? `<img loading="lazy" src="${src}" alt="${esc(alt)}">` : `<div class="none">${esc(alt)}: no image</div>`);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Docket shell gallery</title>
<style>
  body{margin:0;padding:16px;font:14px system-ui,sans-serif;background:#111;color:#ddd}
  h2{margin:28px 0 8px;font-size:15px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
  figure{margin:0}figcaption{font:12px ui-monospace,monospace;color:#999;margin-bottom:4px}
  img{width:100%;height:auto;border:1px solid #333;background:#000}
  .none{border:1px dashed #555;padding:40px 8px;text-align:center;color:#999}
</style></head><body>
<h1>Docket shell gallery</h1>
<p>Left: the built app. Right: rev-8 reference. ${tiles.length} tiles.</p>
${tiles
  .map(
    (t) => `<h2>${esc(t.name)}</h2><div class="pair"><figure><figcaption>app</figcaption>${img(t.app, 'app')}</figure><figure><figcaption>rev 8</figcaption>${img(t.ref, 'reference')}</figure></div>`,
  )
  .join('\n')}
</body></html>
`;
writeFileSync(join(OUT, 'index.html'), html);
console.log(`gallery: ${join(OUT, 'index.html')} (${tiles.filter((t) => t.app).length}/${tiles.length} app screenshots)`);
