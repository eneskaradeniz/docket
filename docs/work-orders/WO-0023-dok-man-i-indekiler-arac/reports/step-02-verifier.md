Tüm kanıtlar toplandı — backtick girişleri mevcut ve GitHub anchor'larıyla tam olarak eşleşiyor (eski grep'lerim sadece hatalı tasarlanmıştı). Doğrulama tamamlandı.

## WO-0023 Adım 2 — Doğrulayıcı Raporu (TOC doğrulaması + değiştirilen dosyalar)

**Sonuç: GEÇTİ.** PR #25'in head'i `5792f87295a729cb442ba23dac1d9c4fb4792e46` konumunda, 332 TOC girişinin tümü, o dosya için **GitHub'ın kendi işlenmiş HTML'i** (contents API'si, `Accept: application/vnd.github.html+json` — PR görünümüyle aynı oluşturucu) aracılığıyla çıkarılan gerçek anchor id'leri ile doğrulandı. Bozuk bağlantı yok.

### Nelerin kontrol edildiği

- **Kapsam**: `git diff b7b560f..5792f87` — tam olarak 44 dosya, tamamı `docs/**/*.md`, +538/−0. Herhangi bir kod/test/config dosyasına dokunulmadı.
- **Kapsam**: head konumunda 45 adet `docs/` altındaki `.md` dosyası mevcut; sadece `docs/tech-debt.md` değiştirilmedi — doğrulanmış şekilde atlandı: yalnızca bir H1'e (`docs/tech-debt.md:1`) sahip, `##`/`###` başlığı yok, kod bloğu (fence) yok → boş bir TOC anlamsız olurdu.
- **Yapı (44/44 dosya)**: `## İçindekiler` hemen H1'den sonra yer alıyor (önek belgesi olan dosyalarda önek belgesinden sonra — ör. `docs/PRODUCT.md:3`; `docs/work-orders/WO-0023-dok-man-i-indekiler-arac/order.md:16`), başlık sırası tam olarak eşleşiyor, `###` girişleri 2 boşlukla girintili (`docs/work-orders/WO-0007-electron-shell-scaffold/plan.md:8-9`), giriş sayısı == başlık sayısı (yalnızca H1 + TOC'nin kendisi hariç), kendi kendini listeleme durumu yok.
- **DOĞRULAMA — bağlantı geçerliliği**: her başlık için kod bloklarına duyarlı yeniden hesaplama, daha sonra her slug'ın **o başlık** için GitHub'ın anchor id'si ile konumsal eşitlik karşılaştırması (yalnızca küme üyeliği değil). 332/332 çözümlendi; 44 dosyanın 41'i konumsal olarak hizalandı; hizalanmayan 2 dosya (WO-0022/WO-0023 order.md, aşağıya bakın) doğrudan id setine karşı kontrol edildi — tüm slug'lar mevcut, her biri doğru başlığa işaret ediyor.
- **Plan örneklemesi**: ters tik başlıkları — `docs/adr/ADR-0011-repository-conventions-and-mechanical-enforcement.md:7` `#decision--claudemd-carries-rules-not-reasons`; `docs/work-orders/WO-0007-electron-shell-scaffold/plan.md:10` `#3-srcdev-maintsx--delete-electron-is-the-sole-entry`, `:16` `#boundary-check-changes-scriptscheck-boundariesmjs` — hepsi GitHub ile tam olarak eşleşiyor (nokta/yorum noktası/slash/ok/em-dash→`--` işleme doğru). Türkçe karakterler — WO-0022/WO-0023 order.md dosyalarındaki `##`/`###` başlıkları İngilizce'dir; Türkçe metin yalnızca H1'lerde bulunur ve GitHub'ın kendi Turkish H1 anchor'ları (ör. `#wo-0023--doküman-i̇çindekiler-aracı`) başlık altına alma (slug) kurallarını doğrulamaktadır. Herhangi bir TOC girişinde büyük harf Türkçe karakter bulunmuyor, bu nedenle İ→combining-dot durumu tetiklenmemiştir.
- **Idempotency (yapı gereği)**: her dosyanın mevcut başlıklarından yeniden türetme, mevcut TOC'yi başlık+slug+sıra+girinti açısından bire bir üretir → ikinci çalıştırma boş bir diff ile sonuçlanır.
- **Ekler denetimi**: 42/44 diff yalnızca TOC satırlarıdır (boş / `## İçindekiler` / giriş satırları). İstisnalar, bu dala yeni eklenen WO-0023'ün kendi `order.md` + `plan.md` dosyalarıdır (dosyanın tamamı "eklenen" olarak görünür) — bir kusur değil.
- **Yan notlar**: TOC blokları dışında `](#…)` bağlantısı yok (WO-0023 `plan.md:16,22` üzerindeki iki eşleşme, formatı tanımlayan geri işaretli kod parçalarıdır). Yinelenen başlıklar yok → `-1/-2` sonek yolu kullanılmamıştır. PR #25: her iki kontrol de (`GitGuardian`, `check`) GEÇTİ, birleştirilebilir durumda.

### Kontrol listesi

| Kontrol | Sonuç |
|---|---|
| Kapsam: yalnızca docs/ .md değiştirildi (+538/−0) | ✅ geçti |
| Kapsam: tech-debt.md atlama gerekçesi (başlık yok) | ✅ geçti |
| TOC mevcut + her dosyada H1/önek belgesinden sonra yerleşim | ✅ 44/44 |
| Her TOC slug'ı gerçek bir GitHub anchor'ı (332 giriş) | ✅ 332/332 |
| Slug doğru *başlığa* işaret ediyor (sadece herhangi bir başlığa değil) | ✅ |
| Türkçe + em-dash + ters tik/özel durum örneklemesi | ✅ |
| ### girinti, sıra, kendi kendini hariç tutma | ✅ |
| Idempotency (yeniden türetme == mevcut TOC) | ✅ |
| Bozuk/ekstra anchor bağlantısı yok | ✅ |
| PR #25 head sha == doğrulanmış commit; CI yeşil | ✅ |

### Belirsizlikler / engelleyici olmayan notlar

- **Setext artefaktı (önceden var olan, TOC değil)**: WO order.md şablonundaki `In scope:` / `Out of scope:` satırlarından sonra gelen boş `-` maddeleri, GitHub'da ek H2'ler (GFM setext altı çizgisi, id'ler `#in-scope`/`#out-of-scope`) olarak işlenir — WO-0022/WO-0023 order.md hizalamasındaki 10'a karşı 8 sapmasının nedeni budur. Ekstra anchor'lar TOC slug'ları ile çakışmıyor; hiçbir bağlantı etkilenmiyor. `## Scope` altındaki boş maddelerin giderilmesi (örneğin `-` yerine `- (none)` yazılması) için gelecekte teknik borç (tech-debt) adayı olabilir — bu çalışmanın kapsamı dışında.
- Yineleyicinin çalıştırma betiği atılır olarak `/tmp` altında tutuldu, depoya (repo) işlenmedi — plana göre.

### ÇIKTI — değiştirilen dosyalar (44, commit `5792f87`, PR #25)

`docs/PRODUCT.md`; `docs/adr/` ADR-0001…ADR-0011 (11); `docs/probes/cc-surface/findings.md`, `docs/probes/cc-surface/raw/q8-survey.md`; `docs/work-orders/TEMPLATE.md`; order.md: WO-0001, WO-0002, WO-0003, WO-0005, WO-0006, WO-0007, WO-0008, WO-0009, WO-0010, WO-0011, WO-0012, WO-0013, WO-0014, WO-0015, WO-0016, WO-0017, WO-0018, WO-0019, WO-0020, WO-0021, WO-0022, WO-0023; plan.md: WO-0002, WO-0007, WO-0008, WO-0010, WO-0022, WO-0023; `WO-0008-session-runner/verify-drive.md`. (WO-0023'ün order.md + plan.md dosyaları aynı zamanda bu dalda yeni eklenmiş dosyalardır.)