// WO-0100 — the app's icon assets, generated from the SVG sources in build/ (plan §2; direction C "Kuyruk", operator re-pick 2026-09-23 — §16).
// Run on demand (`npm run icons`), never on build; the outputs are committed.
//
// Source per size (the one rule this script encodes):
//   16 px    -> build/tile-small16.svg (colored; whole-pixel geometry) or build/tray16.svg (template)
//   <= 32 px -> build/tile-small.svg (colored) or build/tray.svg (template @2x)
//   >= 48 px -> build/logo.svg (the padded 1024 tile)
//
// Emits: build/icon.png (1024), build/icons/NxN.png (Linux set), build/icon.icns (macOS, via iconutil),
// build/icon.ico, build/trayTemplate.png + build/trayTemplate@2x.png (black + alpha), build/tray.png +
// build/tray.ico (colored tray for Windows/Linux).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');

const SOURCES = {
  logo: readFileSync(join(buildDir, 'logo.svg'), 'utf8'),
  tileSmall: readFileSync(join(buildDir, 'tile-small.svg'), 'utf8'),
  tileSmall16: readFileSync(join(buildDir, 'tile-small16.svg'), 'utf8'),
  tray: readFileSync(join(buildDir, 'tray.svg'), 'utf8'),
  tray16: readFileSync(join(buildDir, 'tray16.svg'), 'utf8'),
};

const SMALL_MAX = 32;

/** Rasterize one SVG source to a square image of `size` px (resvg's RenderedImage). */
function rasterize(svg, size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' });
  const image = resvg.render();
  if (image.width !== size || image.height !== size) {
    throw new Error(`render: expected ${size}x${size}, got ${image.width}x${image.height}`);
  }
  return image;
}

function render(svg, size) {
  return rasterize(svg, size).asPng();
}

/** The colored app icon at `size`, following the size rule. */
function appIcon(size) {
  if (size === 16) return render(SOURCES.tileSmall16, 16);
  return render(size <= SMALL_MAX ? SOURCES.tileSmall : SOURCES.logo, size);
}

function write(rel, buf) {
  const path = join(buildDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(`[icons] ${rel}`);
}

/** A multi-frame .ico; png-to-ico keeps each given PNG as its own frame (no resampling). */
function ico(sizes) {
  return pngToIco(sizes.map((s) => appIcon(s)));
}

/** A template image must be black + alpha only; fail loudly if a pixel carries color. */
function template(svg, size, name) {
  const image = rasterize(svg, size);
  const data = image.pixels;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0)) {
      throw new Error(`${name}: non-black pixel at byte ${i}`);
    }
  }
  return image.asPng();
}

// 1. The master PNG + the Linux set.
write('icon.png', appIcon(1024));
for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) write(`icons/${s}x${s}.png`, appIcon(s));

// 2. Windows .ico: 16/24/32 from the small tile, 48/64/128/256 from the padded tile.
write('icon.ico', await ico([16, 24, 32, 48, 64, 128, 256]));

// 3. Menubar template (macOS): @1x from its own 16-box geometry, @2x from the 32-box one.
write('trayTemplate.png', template(SOURCES.tray16, 16, 'trayTemplate.png'));
write('trayTemplate@2x.png', template(SOURCES.tray, 32, 'trayTemplate@2x.png'));

// 4. Colored tray (Windows/Linux, where a white glyph would vanish on a light taskbar).
write('tray.png', render(SOURCES.tileSmall, 32));
write('tray.ico', await ico([16, 24, 32]));

// 5. macOS .icns via iconutil; the iconset is a scratch directory, removed afterwards.
if (process.platform === 'darwin') {
  const iconset = join(buildDir, 'icon.iconset');
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset);
  for (const base of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${base}x${base}.png`), appIcon(base));
    writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), appIcon(base * 2));
  }
  try {
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' });
    console.log('[icons] icon.icns');
  } finally {
    rmSync(iconset, { recursive: true, force: true });
  }
} else {
  console.log('[icons] icon.icns skipped: iconutil is macOS-only');
}
