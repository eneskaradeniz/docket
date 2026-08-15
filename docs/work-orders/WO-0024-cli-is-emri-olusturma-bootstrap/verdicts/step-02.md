# Mimari inceleme — WO-0024 adım 2 (doğrulayıcı raporu)

## Bağımsız yeniden doğrulama — her iddia çoğaltıldı

| Rapor iddiası | Yeniden çalıştırdım/m Checked | Sonuç |
|---|---|---|
| `npm test` 377/377 (34 yeni) | kendim çalıştırdım | ✅ 377/377 geçti; `create.test.ts`'de 34 test saydım (13+11+7+3); öncül 343 ile tutarlı |
| `npm run typecheck` (her iki tsconfig) | kendim çalıştırdım | ✅ temiz |
| `npm run check:boundaries` 8/8 | kendim çalıştırdım | ✅ temiz |
| `npm run build` | kendim çalıştırdım | ✅ temiz |
| Yeni bağımlılık yok | `git diff --stat package.json package-lock.json` | ✅ boş |
| `create.ts` saf | okundu + grep | ✅ yalnızca tür içe aktarma (`create.ts:12`), 0 markalı kurucu, `node:` belirticisi yok; markalama yalnızca genişletilmiş kompozisyon kökünde (`index.ts`, `rid` kullanımı) |
| Sandbox yapıtları `/tmp/wo0024-verify.3Dub` | listelendi + okundu | ✅ hepsi mevcut ve eşleşiyor: 86 KB db, GUI şekilli `WO-0001-sandbox-deneme/order.md` (`status: draft`, `mode: plan`, `review_mode: gates`, `tracks`, `depends_on`), çok depolu db, `docs` karar deposunda iki WO |
| Satır işaretçileri (`index.ts:279`, `index.ts:304`, `create.ts:12`) | okundu | ✅ tam olarak eşleşiyor |

## Bulgu #1'in benden bağımsız olarak doğrulanması

Doğrulayıcı "yeni erişilebilen, önceden var olan mağaza hatasını" kapsam dışı olarak bildirir. Kod üzerinden tam mekanizmayı doğruladım: `nextWorkOrderNumber` **karar deposu dizinine** göre numaralandırır (boş → `WO-0001`, `decision-store.ts:49-56`), ancak `work_order.id TEXT PRIMARY KEY` veritabanı genelinde benzersizdir (`schema.ts:23`), ve `store/index.ts:652` order.md dosyasını yazmadan **önce** 666. satırdaki insert işlemi gerçekleştirir — bu nedenle ikinci çalışma alanının ilk WO'su UNIQUE hatasıyla karşılaşır ve yetim bir `WO-0001-…` dizini bırakır. Gerçek, önceden var olan (WO-0015'ten doğma), GUI tarafında da aynı port üzerinden erişilebilir ve kapsam sınırı "store/port katmanlarına dokunma"nın doğru bir şekilde uygulanmasıdır. Doğrulayıcı bunu doğru bir şekilde düzeltmedi. Sandbox'ımda yeniden üretme denemem, doğrudan doğruya ADR-0002 yazma engelini tetikledi — sağlam bırakıldığı için memnunum.

## Kapanışa taşınacak kaygılar (bu karar için engelleyici değil)

1. **Bulgu #1'in "bir TD girişi öner" ifadesi harekete geçirilmedi.** Tech-debt diff'i yalnızca TD-032'yi (dürüstçe bölünmüş: önyükleme yarıdı ödendi, `--policy ask` açık bırakıldı) değiştirir. PR/closure adımında, yeni tespit edilen numaralandırma/PK çakışma hatası için somut bir tech-debt girişi eklenmelidir — aksi takdirde öneri kaybolur. Closure kanıtı, bir commit sha ile tech-debt'nin güncellendiğini göstermeyi gerektirir.
2. **Çalışma yine `main` dalında commit edilmemiş durumda** (değiştirilen: `index.ts`, ROADMAP, tech-debt; izlenmeyen: `create.ts`, testler, WO doc). `pr_open` + `ci_green` kanıtları hala beklemede — implementer'in bu karardan sonraki bir sonraki hamlesi commit → branch → PR'dır. Adım 2'yi bir doğrulama aşaması olarak etkilemez, ancak kapanış için kalan iş budur.

## Karar

Adımın amacı — testleri, sınırları ve uçtan uca sandbox çalışmasını doğrulamak — karşılandı ve üstüne Nile raporun kendisi alçakgönüllü; bağımsız yeniden çalıştırmalarla her iddia çoğaltıldı, yapıtlar mevcut ve eşleşiyor ve tek gerçek bulgu dürüstçe kapsamlandırıldı ve kod yoluyla onaylandı. Rapor, TD girişi takibini PR adımına erteleyerek devam etmeyi hak ediyor.

KARAR: devam

_(the architect did not give a clear VERDICT — surfaced for the operator)_