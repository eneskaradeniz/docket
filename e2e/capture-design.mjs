// e2e/capture-design.mjs — the full-surface design capture (design atelier, 2026-09-20).
// Same harness as ui.mjs (seeded temp db, DOCKET_E2E, pinned theme) but instead of specs it DUMPS
// the live DOM + live CSS of every designed face: screens, detail states, live/stopped drives, the
// plan editor, every modal, roadmap (rich/bos/draft dialogs), usage (rich/bos), the budget gate,
// and the light theme. Emits <name>.html + app.css + manifest.json (assembly + gallery input).
// Run: npm run build && node e2e/capture-design.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = process.argv[2] ?? '/tmp/docket-design-capture';
mkdirSync(OUT, { recursive: true });

const seedOut = execFileSync('npx', ['tsx', 'e2e/seed.ts'], { cwd: ROOT, encoding: 'utf8' });
const dbLine = seedOut.trim().split('\n').find((l) => l.startsWith('DB='));
if (!dbLine) throw new Error('seed failed: no DB= line');
const DB = dbLine.slice(3);

const app = await electron.launch({
  args: [join(ROOT, 'dist-electron', 'main.js')],
  env: { ...process.env, DOCKET_DB_PATH: DB, DOCKET_E2E: '1', NODE_ENV: 'production' },
});
const page = await app.firstWindow();
await page.emulateMedia({ colorScheme: 'dark' });
await page.evaluate(() => localStorage.setItem('docket.theme', 'dark'));
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(900);

const MANIFEST = [];
const dump = async (name, title, section, back = null) => {
  await page.waitForTimeout(600);
  const css = await page.evaluate(() => {
    let out = '';
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) out += rule.cssText + '\n';
      } catch {
        /* no cross-origin sheets in the packaged app */
      }
    }
    return out;
  });
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  writeFileSync(join(OUT, `${name}.html`), html);
  writeFileSync(join(OUT, 'app.css'), css);
  MANIFEST.push({ name, title, section, back });
  console.log(`  ✓ ${name} (${html.length}B)`);
};
const openDetail = async (title) => {
  await page.locator('[data-wo-id]', { hasText: title }).first().click();
  await page.waitForTimeout(650);
};
const back = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
};
const stopAllDrives = async () => {
  for (let i = 0; i < 4; i++) {
    const btn = page.getByRole('button', { name: 'Durdur', exact: true });
    if ((await btn.count()) === 0) return;
    await btn.first().click();
    await page.waitForTimeout(700);
  }
};
const switchWs = async (_from, to) => {
  const cur = ((await page.locator('header button').first().textContent()) ?? '').replace(/[▾▎]/g, '').trim();
  if (cur === to) return; // a reload resets the boot workspace — never assume the caller's `from`
  await page.locator('header button').first().click();
  await page.waitForTimeout(300);
  const seeAll = page.getByRole('button', { name: /Tümünü gör/ });
  if ((await seeAll.count()) > 0) await seeAll.first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: new RegExp(to) }).first().click();
  await page.waitForTimeout(600);
};
const openWsEdit = async () => {
  await page.locator('header button').first().click();
  await page.waitForTimeout(400);
  const seeAll = page.getByRole('button', { name: /Tümünü gör/ });
  if ((await seeAll.count()) > 0) {
    await seeAll.first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('div').filter({ hasText: 'e2e' }).last().locator('button[aria-label="Çalışma alanı ayarları"]').last().click();
  await page.waitForTimeout(500);
};
const segment = async (label) => {
  await page.locator('header [role="group"] button', { hasText: label }).first().click();
  await page.waitForTimeout(650);
};

// ===== A · ekran + detay durumları (ws e2e, dark) =====
await dump('board', 'Pano', 'Ekranlar');
await openDetail('Yeni iş emri örneği');
await dump('detail-plan-yok', 'Detay — plansız (çıplak Plan iste)', 'Detay durumları', 'board.html');
await page.getByRole('button', { name: /Plan iste|Sürdür/ }).first().click();
await page.waitForTimeout(800);
await dump('detail-calisiyor', 'Detay — sürüş çalışıyor (mavi + Durdur)', 'Canlı & kapı', 'board.html');
await page.getByRole('button', { name: 'Durdur', exact: true }).click();
await page.waitForTimeout(1000);
await dump('detail-durduruldu', 'Detay — durduruldu (Sürdür teklifi)', 'Canlı & kapı', 'board.html');
await back();
await openDetail('Plan bekliyor');
await dump('detail-plan-bekliyor', 'Detay — plan kararı (İtiraz/Onayla bandı)', 'Detay durumları', 'board.html');
await page.locator('[data-plan-cards]').getByRole('button', { name: 'Düzenle' }).click();
await page.waitForTimeout(350);
await dump('detail-plan-editor', 'Detay — plan editörü (Bitti·Vazgeç + satırlar)', 'Detay durumları', 'board.html');
await page.locator('[data-plan-cards]').getByRole('button', { name: 'Vazgeç' }).click();
await page.waitForTimeout(250);
await back();
await openDetail('İzin bekliyor');
await dump('detail-izin-bekliyor', 'Detay — izin bekliyor (amber + ask kartı)', 'Detay durumları', 'board.html');
await page.locator('[data-pane-log-toggle]').first().click();
await page.waitForTimeout(350);
await dump('detail-izin-bekliyor-dokum', 'Detay — döküm açık (sohbet grameri)', 'Detay durumları', 'board.html');
await back();
await openDetail('Uygulama sürüyor');
await dump('detail-uygulama-suruyor', 'Detay — kapatılabilir (kanıtlı kapanış kartı)', 'Detay durumları', 'board.html');
await page.locator('button[data-step-toggle="1"]').click();
await page.waitForTimeout(400);
await dump('detail-rapor-acik', 'Detay — adım raporu açık (owner satır)', 'Detay durumları', 'board.html');
await page.locator('button[data-step-toggle="1"]').click();
await page.waitForTimeout(250);
await back();
await openDetail('Kapandı');
await dump('detail-kapandi', 'Detay — kapandı (yeşil + oturum kartları)', 'Detay durumları', 'board.html');
await page.locator('[data-session-toggle]').first().click();
await page.waitForTimeout(350);
await dump('detail-kapandi-kart-acik', 'Detay — oturum kartı açık', 'Detay durumları', 'board.html');
await back();
await openDetail('Ajan arşivi');
await page.locator('[data-session-toggle]').first().click();
await page.waitForTimeout(450);
await dump('detail-ajan-arsivi', 'Detay — ajan görev satırlı arşiv kartı', 'Detay durumları', 'board.html');
await back();

// ===== B · modallar (ws e2e) =====
await page.getByRole('button', { name: /yeni iş emri/i }).first().click();
await page.waitForTimeout(400);
await dump('modal-yeni-is-emri', 'Modal — yeni iş emri', 'Modallar', 'board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await openDetail('Plan bekliyor');
await page.locator('button[aria-label="İş emrini düzenle"]').first().click();
await page.waitForTimeout(350);
await dump('modal-wo-duzenle', 'Modal — iş emrini düzenle', 'Modallar', 'board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await back();
await openDetail('Rapor turu');
await page.locator('button[aria-label="Sil"]').first().click();
await page.waitForTimeout(350);
await dump('modal-sil', 'Modal — silme onayı (Geri alınamaz)', 'Modallar', 'board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await back();
await page.locator('header button').first().click();
await page.waitForTimeout(350);
await dump('dropdown-ws-secici', 'Açılır — çalışma alanı seçici', 'Modallar', 'board.html');
await page.getByRole('button', { name: /Tümünü gör/ }).first().click();
await page.waitForTimeout(450);
await dump('modal-ws-listesi', 'Modal — tüm çalışma alanları', 'Modallar', 'board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button[aria-label="Ayarlar"]').first().click();
await page.waitForTimeout(450);
await dump('modal-app-ayar', 'Modal — genel ayarlar (Modeller·Genel)', 'Modallar', 'board.html');
await page.locator('[data-settings-menu] button', { hasText: 'İstem şablonları' }).first().click();
await page.waitForTimeout(400);
await dump('modal-app-ayar-sablonlar', 'Modal — ayarlar · İstem şablonları', 'Modallar', 'board.html');
await page.locator('[data-settings-menu] button', { hasText: 'Genel' }).first().click();
await page.waitForTimeout(400);
await dump('modal-app-ayar-genel', 'Modal — ayarlar · Genel', 'Modallar', 'board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await openWsEdit();
await dump('modal-ws-ayar', 'Modal — çalışma alanı ayarları (880px)', 'Modallar', 'board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ===== C · öteki çalışma alanları: kullanım, genel bakış, yol, bütçe, taslak =====
await switchWs('e2e', 'kullanim');
await segment('Kullanım');
await dump('usage', 'Kullanım — dolu defter (uyarı eşiği)', 'Ekranlar');
await switchWs('kullanim', 'bos');
await segment('Kullanım');
await dump('usage-bos', 'Kullanım — boş yüz', 'Ekranlar');
await switchWs('bos', 'e2e');
await segment('Genel bakış');
await dump('overview', 'Genel bakış', 'Ekranlar');
// the health section's OPEN face (the static page cannot expand — the nav switches pages instead)
await page.locator('[data-overview-health] > button').first().click();
await page.waitForTimeout(350);
await dump('overview-health-open', 'Genel bakış — sağlık ayrıntısı açık', 'Ekranlar');
await switchWs('e2e', 'yol');
await segment('Pano');
await dump('board-yol', 'Pano — yol haritası bağlı iş emirleri', 'Ekranlar');
await segment('Yol Haritası');
await dump('roadmap-yol', 'Yol Haritası — 5 faz (tamam·koşuyor·bloke)', 'Ekranlar');
await segment('Pano');
await openDetail('Yol yetim');
await dump('detail-yetim', 'Detay — yetim görev bağlantısı (degrade çip)', 'Detay durumları', 'board-yol.html');
await back();
await switchWs('yol', 'uyarı');
await dump('board-uyari', 'Pano — bütçe uyarı satırı', 'Ekranlar');
await switchWs('uyarı', 'kapı');
await dump('board-kapi', 'Pano — limit doldu satırı', 'Ekranlar');
await openDetail('Kapı işi A');
await page.waitForTimeout(1100);
await dump('detail-butce-kapisi', 'Detay — bütçe kapısı ret kartı', 'Canlı & kapı', 'board-kapi.html');
await back();
await switchWs('kapı', 'taslak');
await segment('Yol Haritası');
await dump('roadmap-bos', 'Yol Haritası — yok yüzü + ✦ kapısı', 'Ekranlar');
await page.getByRole('button', { name: /Üret \/ İçe aktar/ }).first().click();
await page.waitForTimeout(450);
await dump('roadmap-taslak-dialog', 'Taslak diyaloğu — boş depo yüzü', 'Taslak', 'roadmap-bos.html');
await page.locator('[role="dialog"]').getByRole('button', { name: 'Vazgeç' }).first().click();
await page.waitForTimeout(300);
await switchWs('taslak', 'taslak-kirli');
await segment('Yol Haritası');
await dump('roadmap-taslak-kirli', 'Taslak — okunamayan taslak kartı', 'Taslak');
await switchWs('taslak-kirli', 'taslak-depo');
await segment('Yol Haritası');
await page.getByRole('button', { name: /Üret \/ İçe aktar/ }).first().click();
await page.waitForTimeout(500);
await dump('roadmap-taslak-depo-dialog', 'Taslak diyaloğu — belge kanalları (gruplu tarama)', 'Taslak', 'roadmap-bos.html');
await page.locator('[role="dialog"]').getByRole('button', { name: 'Vazgeç' }).first().click();
await page.waitForTimeout(250);

// ===== D · açık tema (ws e2e) =====
await page.evaluate(() => localStorage.setItem('docket.theme', 'light'));
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(900);
await switchWs('taslak-depo', 'e2e');
await segment('Pano');
await dump('light-board', 'Açık tema — pano', 'Açık tema');
await openDetail('Kapandı');
await dump('light-detail-kapandi', 'Açık tema — kapandı detayı', 'Açık tema', 'light-board.html');
await back();
await openWsEdit();
await dump('light-modal-ws-ayar', 'Açık tema — ws ayarları', 'Açık tema', 'light-board.html');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await app.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(MANIFEST, null, 1));
console.log(`done → ${OUT} (${MANIFEST.length} pages)`);
