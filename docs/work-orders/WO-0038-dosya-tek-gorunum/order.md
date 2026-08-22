---
id: WO-0038
title: DOSYA — tek görünüm (SADE/DETAY ölür), oturum kartları, bağlamsal kanıt, plan editörü
workspace: docket
status: closed
mode: direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0038 — DOSYA: iş emri ekranı baştan (tek görünüm)

## Objective

Operatörün radikal yönlendirmesi (2026-08-22, mockup turu + uygulamada tur turları): **SADE/DETAY
ikili görünümü tamamen kalkar** — mod yok, sekme yok, raf yok; iş emri ekranı tek kayar bir DOSYA'dır.
Aynı günün öteki kararları: Belgeler göster/gizle satırlarına iner (duvar ölür), büyük plan kartları
32px satırlara iner, **Kanıt kalıcı vitrini ölür** (kanıt bağlamsal olur: kapanış kartının kontrol
listesi + kapılı eylemin anlık sebep satırı), oturumlar **kart** olur (özet + aç/kapa terminal —
aç/kapa, eski SADE/DETAY ayrımının yeni evidir), plan editörü dürüst bir sahneleme modeline kavuşur
(Vazgeç/Bitti/Onayla) ve rol seçimi döngüsel tıklamadan açılır menüye döner.

## Context (uygulanmış gerçeklik)

- Silinenler: `view-mode.tsx`, `Substrip.tsx`, `DetailBody.tsx`, `useDetailLayout.ts`,
  `PlanApprovalCards.tsx`, `AuditTable.tsx`, pane-chrome PhaseLine'u, ChatTranscript 'sade' varyantı.
- Yenileri: `PlanSection.tsx` (satırlar + editör + rol seçici), `SessionCards.tsx` (kartlar),
  DocRow (DetailSections içinde), başlık bandı (DetailStrip: sol sıra lambası omurgası + faz +
  adım çizgisi + başlık tooltip'i), EvidencePanel kapanış kartına taşındı.
- Ray sözleşmesi: editör açıkken `Vazgeç · Bitti` (Onayla yok, ⏎=Bitti); Bitti sonrası NORMAL ray
  (`İtiraz · Düzenle · Onayla`); İtiraz sahneyi temizler; boş adım = sahne özelliği (input kırmızı
  kenar + ray satır adını söyler + Onayla yok).
- Oturum kartı özeti = **eser manşeti** (plan→'N adımlık plan önerdi', inceleme→verdict,
  adım/serbest→son cümlenin ilk 140 karakteri). Faz 2 (LLM'e özet yazdırma + `SessionRef.summary`)
  yalnız bu manşetler yetersiz kalırsa — kayıtlı yükseltme yolu.
- **Olay + koruma** (2026-08-22): WO-0038'in ilk instrument koşulu onaysız pending adımı mount'ta
  otomatik sürmüştü (getWorkOrderSteps fence'i onaysız da 'pending' döndürür). Düzeltme iki katman:
  StepPane plan aşamasında asla render edilmez + pipeline `planApprovedFor` koruması
  (SessionStore portu; adım/inceleme sürüşleri kapalı kapıda error olayıyla reddedilir, runner
  spawn olmadan — GUI ve CLI dahil). DB temizlendi; yedek:
  `docket.db.bak-20260822-wo0038-incident`.

## Acceptance criteria

1. Hiçbir yüzeyde SADE|DETAY anahtarı, Akış|Kayıt sekmesi veya 1080 rafı yok — E2E.
2. Başlık bandı: sol lamba omurgası sıra durumunu taşır; başlık tooltip'te tam metin — E2E.
3. Plan: 'Plan hazır' readout + satırlar; editör: Vazgeç/Bitti rayı, rol seçici menü, tooltip'li
   ▲▼✕, soluk kenar kontrolleri, sahneleme (Bitti düzenlemeleri korur, Vazgeç atar, İtiraz temizler)
   — E2E.
4. Belgeler: `İş emri (order.md) · N bölüm` satırları; açılınca tavanlı gövde + scroll — E2E.
5. Oturum kartları: tek buton (başlık+özet) iki yönde aç/kapa; özet eser manşeti; canlı kart
   kendiliğinden açık — E2E.
6. Kanıt: sayfada kalıcı bölüm yok; tüm adımlar bitince kapanış kartında kontrol listesi — E2E.
7. Onaysız adım/inceleme sürüşü pipeline'da reddedilir (error olayı, runner spawn'sız) — core test.
8. ADR-0013 + ADR-0005/0012 ekleri, CLAUDE.md maddeleri, tech-debt (TD-020/034/040 kapanır; penceresiz
   sohbet TD'si açılır), ROADMAP güncel; CI yeşil (typecheck ×2, test, build, boundaries, test:ui).

## Evidence required

- plan_approval: (mode: direct — waived; operator onaylı mockup + uygulama turları)
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: reviewer report, `path:line` pointers resolve at head sha
- closure: merged, `ROADMAP.md` updated (commit sha)

## Notes

- Zaman çizelgesi (Zaman) bölümü ertelendi: detay görünümünde olay listesi veri olarak bağlı değil
  (wo_event yalnız DB'de); gerekirse ayrı iş emri.
- ChatTranscript penceresizdir (memo + 800 satır tavan); sanallaştırma kayıtlı borç.

## Closure

Merged PR #44 (`cdb6261`, 2026-08-22) with WO-0037 (one branch, one PR — the same-day tour made
them inseparable). The full arc: mockup tour over the operator's real WO-0001 → in-app iteration
rounds (session cards, artifact headlines, plan editor staging + role picker, doc rows, the
Kanıt ruling) → the incident (unapproved auto-step-drive: root-caused to this order's first
instrument condition + the store's pre-approval 'pending' rows; fixed two-layer — UI guard +
`planApprovedFor` in the pipeline/port, 5 core tests; DB cleaned with a backup) → the E2E rewrite
(which surfaced the deleted-WO fold leak → `forgetWo`). Reviewer agent: no blockers; every
should-fix/note applied in the review commit. CI green (check + GitGuardian); E2E 43/43, 503
unit tests, both typechecks, boundaries clean. Deferred: the Zaman section (no event data wired
to the detail view) and Faz 2 of the özet (agent-written `SessionRef.summary`) — recorded in Notes
and tech-debt.

_Closed 2026-08-22 at cdb6261._
