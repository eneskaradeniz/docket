# Tema sistemi: Sistem / Açık / Karanlık — WO-0040

> Bu plan 2026-08-24'te tur-1 (tema sistemi) için onaylandı. Tur-2 — Ray dökümünde araç ailesi
> renkleri (exec/write/remote) — ayrı bir operatör talebi olarak aynı gün geldi ve order.md'in
> Scope/Notes bölümlerinde kayıtlı; planın kendisi tur-1'i anlatmaya devam eder.

## Context

Docket bugün dark-only (ADR-0012 mütakip, lacivert `#0e1520` konsol). Operatör üç modlu bir tema sistemi istedi — **Sistem** (OS'u izler, varsayılan), **Açık** (beyaz), **Karanlık** (siyah) — seçici Ayarlar modalında Dil section'ının altında. Mockup seçenekleri sunuldu; operatör onayı alındı (2026-08-24):

- **Karanlık = katmanlı siyah** (sayfa saf siyah, kartlar bir tık açık — kart idiomu korunur)
- **Açık = saf beyaz + border** (zemin ve kart #ffffff, ayırımı hairline taşır)
- **Seçici = Ayarlar modalı** (Segmented, WO-0035 dil seçicisinin birebir deseni; header toggle YOK)

Kod tarafı buna hazır: `src/index.css`'teki tek Tailwind v4 `@theme` bloğu (`src/index.css:15-31`) 10 renk token'ı tanımlıyor, `src/ui`'da sıfır hardcoded renk (354 token kullanımı, 43 dosya). Tema geçişi = token custom property'lerini override etmek. Kalıcılık kararı zaten var: `src/core/app-settings.ts:4` — *"theme stays renderer-local localStorage because it is presentation only"* — yani port/DB değişikliği YOK, **`src/core`'a dokunulmuyor**.

Governance: ADR-0007'nin orijinal kararı tam da bu tasarımıydı (light/dark/system + semantik token'lar); 2026-08-21 ek notu theming'i öldürmüştü ("dark-only"). ADR'ler değiştirilmez, eklenir → **2026-08-24 tarihli ek not** theming'i operatör kararıyla canlandırıyor. Karanlık palet lacivertten siyaha değiştiği için mevcut karanlık görünüm de dönüşecek — bilinen ve onaylı sonuç.

## Paletler

| Token | Karanlık (katmanlı siyah) | Açık (saf beyaz) |
|---|---|---|
| `--color-bg` | `#000000` | `#ffffff` |
| `--color-surface` | `#0a0a0a` | `#ffffff` |
| `--color-raised` | `#171717` | `#f2f2f0` |
| `--color-hairline` | `#262626` | `#e3e3e0` |
| `--color-ink` | `#f2f2f2` | `#191917` |
| `--color-inkdim` | `#8f8f8f` | `#6e6e69` |

Aksanlar karanlıkta değişmez (`#f5b544/#4cc38a/#6ca0ce/#e5484d`); açıkta metin kontrastı ~4.9–5.4:1 sağlayan varyantlar: **signal `#9a6700` · proceed `#1a7f37` · info `#0969da` · error `#cf222e`** (mevcut signal beyaz üstünde ~1.9:1 ile okunmaz — varyant şart). Lamba/glow'lar `color-mix` ile token'dan türediği için otomatik uyar.

## Uygulama adımları (sıra: her adım typecheck-yeşil)

### 1. WO doc — `docs/work-orders/WO-0040-tema-secici/order.md`
`TEMPLATE.md` deseni (WO-0035 gibi): Objective / Context / Scope / Acceptance criteria / Stop-and-ask gates. Stop-and-ask kapıları: açık aksan hex'leri + açık tema ekran görüntüleri (operatör incelemesi).

### 2. CSS — `src/index.css`
- **`@theme` (:15-31):** karanlık değerler yukarıdaki siyah paletle değişir. `@theme` = JS'siz/attr'siz varsayılan → karanlık kullanıcıda ilk-boyama flaşı olmaz.
- **Açık override — mevcut `@layer base` içine, `:root { color-scheme: dark }` (:34-36) hemen sonrasına:**
  ```css
  :root[data-theme='light'] {
    color-scheme: light;
    --color-bg: #ffffff;  --color-surface: #ffffff;  --color-raised: #f2f2f0;
    --color-hairline: #e3e3e0;  --color-ink: #191917;  --color-inkdim: #6e6e69;
    --color-signal: #9a6700;  --color-proceed: #1a7f37;
    --color-info: #0969da;  --color-error: #cf222e;
  }
  ```
  **Kritik:** override düz CSS olarak `@layer base`'te olmalı — layer sırası (theme < base) kazanır + specificity (`:root[data-theme]` 0,2,0 > `:root` 0,1,0). İkinci bir `@theme` bloğu KULLANILMAZ (selector scoping desteklemez, kırılgan olur). Utility'ler `var(--color-*)`'e derlendiği için tek blok tüm 354 kullanımı + hljs paletini çevirir; opacity formları (`bg-surface/85`) `color-mix`'e derlenir, onlar da uyar.
- **Stray sabitler token'a bağlanır:** `:61` scrollbar hover `#3a4a63` → `color-mix(in srgb, var(--color-inkdim) 25%, var(--color-hairline))`; `:440` `.steprow.owner` `#33445f` → `color-mix(in srgb, var(--color-inkdim) 35%, var(--color-hairline))`; `:328-342` dört glow `rgba(...)` stop'u → `color-mix(in srgb, var(--color-signal|info|proceed|error) %, transparent)` (karanlıkta piksel-eşdeğer, açıkta uyar).
- **Başlık yorumu (:10-14):** "Dark-only by ruling" → üç mod + WO-0040 + ADR-0007 2026-08-24 eki özetlenir.

### 3. Labels — `src/ui/data/labels/tr.ts` / `en.ts`
`UI` bloğuna, `langTr`'nin hemen ardına: `theme: 'Tema'/'Theme'`, `themeSystem: 'Sistem'/'System'`, `themeLight: 'Açık'/'Light'`, `themeDark: 'Karanlık'/'Dark'`. `const en: Labels` derleme kapısı + `labels.test.ts` parite testi iki bundle'ı zorlar.

### 4. ThemeProvider — yeni `src/ui/data/theme.tsx`
`locale.tsx`'in birebir aynası (yorum disiplini dahil), **propsuz** (port yok):
- `type ThemeMode = 'system' | 'light' | 'dark'`, `type ResolvedTheme = 'light' | 'dark'`
- localStorage anahtarı `'docket.theme'`; `readMirror`/`writeMirror` try/catch korumalı
- İlk boyama SENKRON: `useState(() => readMirror() ?? 'system')` initializer'ında `applyTheme(resolveTheme(...))` → `document.documentElement.dataset.theme = resolved`
- `resolveTheme(mode, systemDark)` saf fonksiyon (export; `resolveSystemLocale` precedente binaen unit test yok — UI kodu çalıştırarak doğrulanır)
- `mode === 'system'` iken `matchMedia('(prefers-color-scheme: dark)')` `change` dinleyicisi → OS değişince CANLI yeniden çözümler (abonelik yalnız Sistem'de)
- `setMode` optimistik uygular + mirror yazar (locale precedente); provider asla throw atmaz
- Export'lar: `ThemeProvider`, `useTheme(): { mode, resolved, setMode }` (provider'sız render → CSS varsayılanı karanlık)

### 5. Mount — `src/renderer/index.tsx`
`LocaleProvider` içine, `ErrorBoundary` üzerine: `<ThemeProvider>` (iki provider'ın sırası önemli değil; portlu olan dışta kalır).

### 6. Seçici — `src/ui/chrome/AppSettingsModal.tsx`
DİL `</section>`'ı (:90) ile sürüm `<p>`'si (:92) arasına, DİL deseninin birebir kopyası: `<section>` + 11px uppercase `UI.theme` etiketi + `<Segmented value={mode} onValueChange={setMode} options=[system/light/dark]>`. `useTheme()` hook'u. Başlık yorumları güncellenir: `AppSettingsModal.tsx:1-5` ("Theme is gone (dark-only)" → WO-0040 seçici eklendi) ve `AppShell.tsx:4` (aynı şekilde).

### 7. Electron main — `electron/main.ts` (~:88-102)
`BrowserWindow`'a `backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff'` — renderer boyamadan önceki pencere dolgusu OS'a uysun (açık OS'ta siyah flaş olmasın). Main'de karanlık varsayan başka şey yok (doğrulandı).

### 8. E2E — `e2e/ui.mjs`
- **Determinizm pini:** her `firstWindow()` sonrası `await page.emulateMedia({ colorScheme: 'dark' })` — 4 launch noktası (:42, :1433, :1565, :1587). Böylece mevcut spec'ler + `:1203`'teki `rgb(76, 195, 138)` pini (proceed karanlıkta değişmediği için) dokunulmadan kalır. `emulateMedia` bu Playwright/Electron çiftinde tutarsız çıkarsa fallback: `addInitScript` ile `localStorage.setItem('docket.theme','dark')` + `reload()` (locale spec'inin `localStorage.clear()` numarasının tersi) — çalışmazsa stop-and-ask.
- **Yeni spec** (locale spec'lerinin yanına, :1605 sonrası): Ayarlar → Açık → `data-theme='light'` + `getComputedStyle(body).backgroundColor === 'rgb(255, 255, 255)'` + mirror `'light'` + ekran görüntüsü `docs/ui-shots/board-light@980.png` (operatör incelemesi); Karanlık → `'dark'`; Sistem + `emulateMedia({ colorScheme: 'light' })` canlı flip → attr `'light'` (tıklamasız takip kanıtı); sonunda karanlığa geri çevir + Escape.

### 9. Dokümantasyon kapanışı
- **ADR-0007 eki** (`docs/adr/ADR-0007-localisation-and-theming.md` sonuna): 2026-08-24, WO-0040 — theming canlandı; üç mod + siyah/beyaz paletler; kalıcılık orijinal gövdeden farklı olarak localStorage (yalnız GUI renk çizer; presentation-only, window-state gibi makine-yerel — `app-settings.ts` kararı; port/DB yok, locale DB satırında kalır); mekanizma yine semantik-token; açık aksan varyantları; ADR-0012 sözleşmesi themesiz-dokunulmaz.
- **ROADMAP.md :318-320:** DEAD maddesi teslim edildiye çevrilir.
- **docs/tech-debt.md:** (a) native pencere dolgusu OS'u izler — açık seçili + karanlık OS'ta ilk kare OS renkli (low); (b) glow güçleri (%18/16/10/14) lacivert için ayarlandı, beyazda aynı sayılar (low, operatör ayarı sonra); (c) `index.html:7-12` Google Fonts linkleri (kullanılmayan Plex Sans + @fontsource duplikasyonu) — kapsam dışı notu.

## Doğrulama

1. `npm run dev` — karanlık varsayılan siyah paletde; lacivert kalıntısı yok (scrollbar, `.steprow.owner`, bir glow'un computed stilinde).
2. Ayarlar → Tema: **Açık** tüm uygulamayı çevirir (board, DOSYA detay, dialoglar, hljs kod blokları, focus ring, scrollbar) — ekran görüntüleri operatöre sunulur (checkpoint kapısı). **Karanlık** geri. **Sistem** OS'a eş.
3. Sistem canlı takip: uygulama açıkken macOS Görünüm ayarı değiştirilir → yeniden başlatmadan uyar.
4. Yeniden başlatma kalıcılığı: Açık seçili → kapat/aç → açık açılır; `docket.theme` silinir + karanlık OS → karanlık açılır (Sistem).
5. Aksan kontrastı beyaz üstünde ~4.5:1+ (spot kontrol).
6. `npm run test:ui` — tüm suite + yeni spec yeşil; `board-light@980.png` gözden geçirilir.
7. CI dörtlüsü: `npm run typecheck && npm test && npm run build && npm run check:boundaries`.
8. Açık OS'ta açılış: pencere beyaz dolguyla açılır (siyah flaş yok).

**Operatör checkpoint akışı:** implement → operatör uygulamada her iki temayı kontrol eder (özellikle: beyazda backdrop-blur header, glow yıkamaları — kabul/ayar kararı operatörün) → onay → testler + code review + final rapor. Commit yalnız onaydan sonra.

## Riskler

- **İlk-boyama flaşı:** CSS varsayılanı karanlık; açık-OS Sistem kullanıcısı renderer modülü çalışana dek karanlık boyayabilir (locale'in ~100ms kalıntısıyla aynı sınıf — WO-0035 Notes'ta kayıtlı yaklaşım; mühendislikle aşılmaz, kaydedilir). index.html inline script fallback'i bilinirlikte, bilinçli olarak kapsam dışı.
- **Beyazda backdrop-blur header** (`bg-surface/85`): beyaz-üstünde-beyaz'da blur görünmez, %15 şeffaftan içerik sızar — hairline kenar ayrımı taşır; yanlış okunursa tek satırlık açık `--color-surface` çözümü (`#fafaf8`) ekran görüntüsü turunda operatöre sunulur, sessizce yapılmaz.
- **Glow yıkamaları beyazda:** koyu-ayarlı yüzdeler amberi çamur tonuna çevirebilir — ekran görüntüsü stop-and-ask kapısı; light güç ayarı tech-debt kaçamağı.
- **`emulateMedia` bu Electron çiftinde denenmedi** — fallback spec'li (yukarıda); ikisi de tutmazsa stop-and-ask.
- **`rgb(76, 195, 138)` pini (:1203):** yalnız "karanlık proceed değişmedi + harness pini" nedeniyle geçerli — pin satırları yük taşıyor; WO Notes'ta belirtilir ki kimse "sadeleştirirken" silmesin.

## Kapsam dışı

Port/DB değişikliği, CLI, light-tuned glow güçleri, index.html font temizliği, token ötesi yüzey bazlı light cilası, tema geçiş animasyonu (konsol anında çevirir).
