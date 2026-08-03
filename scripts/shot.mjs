// Dev-only: capture the six fixture states for the WO-0002 verification evidence.
// Drives the running Vite dev server with the cached Playwright Chromium (no download).
import { chromium } from 'playwright-core';

const EXEC =
  '/Users/eneskaradeniz/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = 'docs/work-orders/WO-0002-ui-prototype/screenshots';

const DOCKET = ['WO-1001', 'WO-1002', 'WO-1003', 'WO-1004'];
const DATEAPP = ['WO-1005', 'WO-1006'];
const NAMES = {
  'WO-1001': '1-stopped-asking',
  'WO-1002': '2-failed-ci',
  'WO-1003': '3-missing-evidence',
  'WO-1004': '4-closure-open',
  'WO-1005': '5-multitrack',
  'WO-1006': '6-ci-exempt',
};

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

const openDetail = async (id) => {
  await page.locator(`[data-wo-id="${id}"]`).click();
  await page.getByText('← Board').waitFor();
  await page.waitForTimeout(150);
};
const backToBoard = async () => {
  await page.getByText('← Board').click();
  await page.locator('[data-wo-id]').first().waitFor();
};
const switchWorkspace = async (name) => {
  await page.getByRole('button', { name }).click();
  await page.waitForTimeout(120);
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('[data-wo-id]').first().waitFor();
await page.screenshot({ path: `${OUT}/0-board-docket.png`, fullPage: true });

for (const id of DOCKET) {
  await openDetail(id);
  await page.screenshot({ path: `${OUT}/${NAMES[id]}.png`, fullPage: true });
  await backToBoard();
}

await switchWorkspace('DateApp');
await page.screenshot({ path: `${OUT}/0-board-dateapp.png`, fullPage: true });

for (const id of DATEAPP) {
  await openDetail(id);
  await page.screenshot({ path: `${OUT}/${NAMES[id]}.png`, fullPage: true });
  await backToBoard();
}

await browser.close();
console.log(`screenshots written to ${OUT}/`);
