// e2e/design-app.mjs — launches the BUILT app against a fresh design seed (e2e/seed-design.ts) and
// resizes / themes its window. Shared by the journeys, the layout audit and the gallery so the
// three drive the app identically. The caller holds the host lock (acquireE2eLock) once per run.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** Seed a throwaway data dir and return the parsed SEED manifest. */
export function seedDesign() {
  if (!existsSync(join(ROOT, 'e2e', 'seed-design.ts'))) throw new Error('e2e/seed-design.ts is missing');
  const out = execFileSync('npx', ['tsx', 'e2e/seed-design.ts'], { cwd: ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').find((l) => l.startsWith('SEED='));
  if (line === undefined) throw new Error('the design seed printed no SEED= line');
  return JSON.parse(line.slice(5));
}

/** Launch the built app on a fresh seed. */
export async function launchDesignApp() {
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('the built app is missing — run the npm script (it builds first)');
  }
  const seed = seedDesign();
  const app = await electron.launch({
    args: [join(ROOT, 'dist-electron', 'main.js')],
    env: { ...process.env, DOCKET_DATA_DIR: seed.dataDir, DOCKET_OPENCODE_BIN: seed.agentBin, DOCKET_UPDATE_FAKE: '0.9.0' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('nav', { timeout: 30_000 });
  return { app, page, seed };
}

/**
 * Text-driven navigation to each audited screen: the labels are the seed's, so every screen is
 * reached the way a person reaches it. Rejects when a label is missing (the shell does not have it yet).
 */
export function screenNavigator(page) {
  const click = (text) =>
    page.locator('nav button, main button, main a, nav a').filter({ hasText: text }).first().click({ timeout: 1500 });
  // The sidebar's Kokpit entry is gone: the cockpit is reached through the title bar's Anasayfa
  // button, and the board routes start from it exactly as they did from the nav entry.
  const home = () => page.getByRole('button', { name: 'Anasayfa' }).first().click({ timeout: 1500 });
  const goto = {
    kokpit: home,
    pano: async () => { await home(); await click('antreo-api'); },
    // The view segment is icon-only: its buttons are found by their accessible name.
    liste: async () => { await goto.pano(); await page.getByRole('button', { name: 'Liste' }).first().click({ timeout: 1500 }); },
    // The code is the seed's derived one — the prototype's İE-0014 numbers 6 (manifest in seed-design.ts).
    detay: async () => { await goto.pano(); await click('İE-0006'); },
    // The project row's target is the roadmap (U-15); the phase cards are the page's readiness
    // signal — the first entry waits the query out, later ones pass on the cached view.
    'yol-haritasi': async () => {
      await click('Antero');
      await page.locator('main section button[aria-expanded]').first().waitFor({ state: 'visible', timeout: 1500 });
    },
    // The accounts frame starts collapsed (U-16); the account view is reached through a card,
    // so the step opens the frame first — only when actually collapsed, the app instance is
    // shared across a run's screen visits.
    hesap: async () => {
      const collapsed = await page
        .locator('[data-accounts-body]')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height <= 1);
      if (collapsed) {
        await page.getByRole('button', { name: 'Hesapları gizle / göster' }).first().click({ timeout: 1500 });
      }
      // U-51/U-51a: the card opens the limits popover; its button opens the account view.
      await click('Claude Max');
      await page.getByRole('button', { name: 'Hesabı aç' }).first().click({ timeout: 1500 });
    },
  };
  return goto;
}

/** Resize the real BrowserWindow (content area, so innerWidth matches) and set the theme. The
 *  window is then moved so it lies wholly inside the primary display's work area: a size the
 *  display cannot hold (full screen on a small screen) lands at the work area's origin instead
 *  of spilling off it, and a size that fits keeps its position. */
export async function setWindow({ app, page }, [width, height], theme) {
  await app.evaluate(({ BrowserWindow, screen }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(w, h);
    const area = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    const x = Math.min(Math.max(b.x, area.x), area.x + area.width - b.width);
    const y = Math.min(Math.max(b.y, area.y), area.y + area.height - b.height);
    if (x !== b.x || y !== b.y) win.setPosition(x, y);
  }, [width, height]);
  // The theme goes through the document attribute; the app's own switch lives in Settings.
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(450);
}
