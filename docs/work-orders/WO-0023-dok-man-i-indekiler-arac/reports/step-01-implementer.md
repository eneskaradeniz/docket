Çalışma ağacı temiz, kazınmış tüm değişiklikler silindi. Adım tamamlandı — uygulayıcı, plan gereği PR'da duruyor.

## Neler değişti

- Otomatik olarak bir `## İçindekiler` (içindekiler tablosu) **45 `docs/**/*.md` dosyasından 44'üne** eklendi, hemen her H1 başlığından sonra eklenmiştir (YAML frontmatter bulunan 23 WO/şablon dosyasında frontmatter'ın ardından). TOC (içindekiler) girdileri, kod bloklarının dışındaki `##`/`###` başlıklarından üretildi; `###` girdileri tek seviye girintilidir; TOC asla kendini listelemez.
- Anchor'lar github-slugger kurallarını izler **GitHub'ın gerçekte nasıl render ettiği gibi**, ampirik olarak GitHub'ın kendi `POST /markdown` render API'si aracılığıyla sabitlenmiştir — küçük harfe çevirme, noktalama işaretleri/ters tikler/uzun çizgilerin kaldırılması, boşlukların tireye dönüştürülmesi, kopyalar için `-1` sonekleri (corpus'ta yok).
- Jeneratör idempotent'tir (ikinci çalıştırma = boş diff) ve mevcut bir `## İçindekiler` bölümünü yerinde değiştirir; bu nedenle Docket'ın sonraki `## Closure note` eklemeleri güvenlidir. `order.md`/`plan.md` ayrıştırıcıları (`src/core/order-md.ts`, `src/core/plan-steps.ts`) konumdan bağımsız olduğundan, eklenen bölüm onları etkilemez.
- PR, daha önce izlenmeyen WO-0023 `order.md` + `plan.md` dosyalarını da kaydeder (plan_approval kanıtı).
- **Takip edilen dosyalarda 449 ekleme, 0 silme** — kod, test veya config'e dokunulmadı.

## Değişen dosyalar (ÇIKTI — 44)

- `docs/PRODUCT.md`
- `docs/adr/`: ADR-0001 … ADR-0011 (11 dosya)
- `docs/probes/cc-surface/findings.md`, `docs/probes/cc-surface/raw/q8-survey.md`
- `docs/work-orders/`: TEMPLATE.md, 22× `order.md` (WO-0001…WO-0023), 6× `plan.md` (WO-0002, 0007, 0008, 0010, 0022, 0023), 1× `verify-drive.md` (WO-0008)
- Yeni eklenen: `docs/work-orders/WO-0023-dok-man-i-indekiler-arac/order.md` + `plan.md`
- **Atlandı:** `docs/tech-debt.md` — hiç `##`/`###` başlığı yok (yalnızca H1 + tablo); boş bir TOC anlamsız olurdu.

## Doğrulama (DOĞRULAMA — implementer katında)

- Her değişen dosyadaki her TOC bağlantısı, aynı dosyanın GitHub tarafından render edilmiş anchor'larıyla karşılaştırıldı (`POST /markdown` üzerinden çıkarıldı): **44/44 dosya, 0 uyuşmazlık** — Türkçe karakterli dosyalar (WO-0022/WO-0023 order.md), kod bloğu içine alınmış başlık dosyaları (findings.md) ve ters tik/uzun çizgi başlıkları (ADR-0011, WO-0007 plan.md) dahil.
- Kanıt: **PR #25** — https://github.com/eneskaradeniz/docket/pull/25, head `5792f87295a729cb442ba23dac1d9c4fb4792e46`, dal `wo-0023-docs-toc`.

## Doğrulayıcı için endişeler

- **Plan sapması — `İçindekiler` anchor'u:** plan `#içindekiler` olduğunu varsaymıştı; GitHub aslında `i` + U+0307 (birleştirme noktası, JS `.toLowerCase()` davranışı) ile `#i̇çindekiler` üretir. DOĞRULAMA kazanır — bağlantılar GitHub'ın gerçekte yayınladığı şeyle eşleşiyor; doğrulayıcı, PR render'ında TOC başlığına tıkladığında bunu görecek.
- **Setext başlık quirk'i:** WO-0022/WO-0023 `order.md` dosyalarında `In scope:` / `Out of scope:` satırlarından sonra boş bir `-` satırı gelir — CommonMark bunları H2 altı çizgi olarak ele alır, bu nedenle GitHub `#in-scope` / `#out-of-scope` şeklinde gerçek anchor'lar render eder. Bunlar TOC'de **kasıtlı olarak listelenmemiştir** (iş emri: yalnızca `##`/`###` satırları). Bu aynı zamanda Docket'ın order.md şablonundaki gizli bir render quirk'idir — olası bir gelecek WO; burada düzeltilmesi, belge içeriğini değiştirmek anlamına gelecektir.
- **Beton betik yolu:** plan betiği `/tmp` altında istedi, ancak güvenlik çiti uygulayıcı yazmalarını repo kök dizini ile sınırlıyor (WO-0019 sınıflandırıcısı, TD-029 ailesi) — betik, izlenmeyen bir repo-içi `.w23-toc/` dizininde çalıştı ve commit'ten önce **silindi**; yalnızca `docs/` commit edildi.
- CI, yalnızca docs değişikliklerinden etkilenmemelidir; ancak bu PR, kontrolün işaretleyeceği yeni izlenmeyen dosyaları (WO-0023 dizini) ekler.