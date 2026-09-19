// Runtime belt under the compile-time braces (WO-0035). The REAL completeness gate is `const en:
// Labels` — a missing key fails typecheck. These tests catch a future refactor that loses the type
// link (e.g. a bundle rebuilt by hand, a spread that silently drops members) and pin the formatter
// expectations both locales are built on.
import { describe, expect, it } from 'vitest';
import { en, LABEL_BUNDLES, tr } from './index';

describe('locale bundles (WO-0035)', () => {
  it('en mirrors every tr member key with the same member kind', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    for (const key of Object.keys(tr)) {
      expect(typeof en[key as keyof typeof en]).toBe(typeof tr[key as keyof typeof tr]);
    }
  });

  it('the UI object mirrors key-for-key', () => {
    expect(Object.keys(en.UI).sort()).toEqual(Object.keys(tr.UI).sort());
  });

  it('bundles are keyed by exactly the Locale union', () => {
    expect(Object.keys(LABEL_BUNDLES).sort()).toEqual(['en', 'tr']);
  });

  it('cost format flips its decimal separator per locale', () => {
    expect(tr.formatUsd(6.27)).toBe('$6,27');
    expect(en.formatUsd(6.27)).toBe('$6.27');
  });

  it('duration units localize', () => {
    expect(tr.UI.formatDuration(65_000)).toBe('1dk 5sn');
    expect(en.UI.formatDuration(65_000)).toBe('1m 5s');
  });

  it('the chip countdown speaks the day tier; the count + warn body localize (WO-0060)', () => {
    expect(tr.UI.limitCountdown(42_000)).toBe('42sn');
    expect(tr.UI.limitCountdown(58 * 60_000)).toBe('58dk');
    expect(tr.UI.limitCountdown(4 * 3_600_000 + 12 * 60_000)).toBe('4s 12dk');
    expect(tr.UI.limitCountdown(2 * 86_400_000 + 3 * 3_600_000)).toBe('2g 3s');
    expect(tr.UI.limitCountdown(-5)).toBe('0sn'); // the crossing race clamps to one last frame
    expect(en.UI.limitCountdown(4 * 3_600_000 + 12 * 60_000)).toBe('4h 12m');
    expect(en.UI.limitCountdown(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h');
    expect(tr.UI.appbarRunningCount(1)).toBe('1 sürüyor');
    expect(tr.UI.appbarRunningCount(2)).toBe('2 sürüyor');
    expect(en.UI.appbarRunningCount(1)).toBe('1 running');
    expect(tr.UI.appbarLimitWarn).toBe('limit yaklaşıyor');
    expect(en.UI.appbarLimitWarn).toBe('limit approaching');
    expect(tr.UI.appbarLimitAria('14:32')).toBe("Kullanım limiti doldu — 14:32'de sıfırlanır");
    expect(en.UI.appbarLimitAria('14:32')).toBe('Usage limit reached — resets at 14:32');
  });

  it('month abbreviations localize', () => {
    // 17:15Z stays inside August in every timezone (±14h) — the month, not the hour, is the assertion
    expect(tr.formatDateTime('2026-08-15T17:15:00Z')).toContain('Ağu');
    expect(en.formatDateTime('2026-08-15T17:15:00Z')).toContain('Aug');
  });

  it('the budget warn line carries the locale’s money voice + the known-spend basis (WO-0047)', () => {
    // The honesty qualifier rides the Known variants only; both figures in, both rendered.
    expect(tr.UI.budgetWarnLineKnown(4.2, 5)).toContain('$4,20');
    expect(tr.UI.budgetWarnLineKnown(4.2, 5)).toContain('bilinen harcama');
    expect(tr.UI.budgetWarnLine(4.2, 5)).not.toContain('bilinen harcama');
    expect(en.UI.budgetWarnLineKnown(4.2, 5)).toContain('$4.20');
    expect(en.UI.budgetWarnLineKnown(4.2, 5)).toContain('known spend');
  });

  it('the roadmap head meta carries the money voice + the known qualifier (WO-0049)', () => {
    expect(tr.UI.roadmapHeadMeta(1, 4, 2, 14.02)).toBe('1/4 faz tamam · 2 açık iş emri · $14,02');
    expect(tr.UI.roadmapHeadMetaKnown(1, 4, 2, 14.02)).toContain('bilinen $14,02');
    expect(en.UI.roadmapHeadMeta(1, 4, 2, 14.02)).toContain('$14.02');
    expect(en.UI.roadmapHeadMetaKnown(1, 4, 2, 14.02)).toContain('known $14.02');
  });

  it('fazLabel renders the id’s own number verbatim, never an ordinal (WO-0049)', () => {
    expect(tr.fazLabel('f0')).toBe('FAZ 0');
    expect(tr.fazLabel('f4')).toBe('FAZ 4');
    expect(tr.fazLabel('onboarding')).toBe('FAZ ONBOARDING');
    expect(en.fazLabel('f4')).toBe('PHASE 4');
  });

  it('the ✦ draft block pins the mockup words — one mechanism, the card voice (WO-0050)', () => {
    expect(tr.UI.roadmapDraftAction).toBe('✦ Üret / İçe aktar');
    expect(tr.UI.roadmapDraftStart).toBe('Taslağı başlat');
    expect(tr.UI.roadmapDraftIdentity).toBe('MİMAR — TASLAK');
    expect(tr.UI.roadmapDraftRunning).toBe('taslak sürüyor');
    expect(tr.UI.roadmapDraftSourceLine(9)).toBe('kaynak: 9 belge');
    expect(tr.UI.roadmapDraftSourceLine(0)).toBe('kaynak: hedef notu');
    expect(tr.UI.roadmapDraftCardSummary(4, 11, 1, 'docs')).toBe(
      '4 faz · 11 görev · 1 bağımlılık zinciri — onaylanınca docs/roadmap.md olarak karar deposuna yazılır; commit operatörün.',
    );
    expect(tr.UI.roadmapDraftCardSummary(2, 5, 0, 'docs')).not.toContain('bağımlılık');
    expect(tr.UI.roadmapDraftFazMeta(4, 'api')).toBe('4 görev · api');
    expect(tr.UI.roadmapDraftFazMeta(3, '')).toBe('3 görev');
    expect(en.UI.roadmapDraftAction).toBe('✦ Generate / Import');
    expect(en.UI.roadmapDraftIdentity).toBe('ARCHITECT — DRAFT');
  });

  it('the unknown arms stay informative — never an error-toned word (WO-0069)', () => {
    expect(tr.UI.evidenceUnknown).toBe('doğrulanamadı — bakılamadı');
    expect(tr.UI.ciUnknown).toBe('CI durumu bilinmiyor');
    expect(tr.UI.evdVerificationMiss).toContain('çözülemedi');
    expect(en.UI.evidenceUnknown).toContain('could not');
    expect(en.UI.ciUnknown).toBe('CI state unknown');
    expect(en.UI.evdVerificationMiss).toContain('did not resolve');
  });

  it('the ✦ source-channel block pins the rev-3 words — one block, one row language, names first (WO-0051)', () => {
    // The store line — borderless, one number; the exception doubles it (rev 3 karar 2).
    expect(tr.UI.roadmapDraftStoreLine('docs', 9, 9)).toBe('docs/ · 9 belge — tümü dahil');
    expect(tr.UI.roadmapDraftStoreLine('docs', 90, 20)).toBe('docs/ · 20 / 90 belge');
    expect(tr.UI.roadmapDraftScanning('docs')).toBe('docs/ taranıyor…');
    expect(tr.UI.roadmapDraftNoDocs('docs')).toBe('docs/ içinde belge yok — taslak hedef notundan üretilir.');
    expect(tr.UI.roadmapDraftGroupLabel('docs', '')).toBe('docs/');
    expect(tr.UI.roadmapDraftGroupLabel('docs', 'adr')).toBe('docs/adr/');
    expect(tr.UI.roadmapDraftGroupCount(16)).toBe('16 belge');
    expect(tr.UI.roadmapDraftExclude).toBe('dışla');
    expect(tr.UI.roadmapDraftInclude).toBe('↩ geri al');
    expect(tr.UI.roadmapDraftMoreAll(8)).toBe('+8 belge — tümü dahil');
    // The picked channel — the word ONCE, in the head; no per-row tag exists (rev 3 karar 1).
    expect(tr.UI.roadmapDraftPickedSubhead(2)).toBe('ek belgeler · 2');
    expect(tr.UI.roadmapDraftDocPick).toBe('+ Belge ekle');
    expect(tr.UI.roadmapDraftExploreChip).toBe('Serbest keşif');
    expect(tr.UI.roadmapDraftExploreInfo).toContain('token harcar');
    // the composition kaynak line — the pane's live readout and the card's döküm identity line
    expect(tr.UI.roadmapDraftSourceCompose(11, 1, false)).toBe('kaynak: 11 belge · 1 ek');
    expect(tr.UI.roadmapDraftSourceCompose(5, 0, true)).toBe('kaynak: 5 belge · keşif');
    expect(tr.UI.roadmapDraftSourceCompose(0, 0, false)).toBe('kaynak: hedef notu');
    expect(en.UI.roadmapDraftExploreChip).toBe('Free exploration');
    expect(en.UI.roadmapDraftSourceCompose(11, 1, false)).toBe('source: 11 document(s) · 1 added');
  });

  it('the overview surface pins the turn words + the unlinked reason (WO-0072)', () => {
    expect(tr.UI.overviewTitle).toBe('Genel bakış');
    expect(tr.UI.overviewTurnArchitect).toBe('Mimarın sırası');
    expect(tr.UI.overviewTurnOperator).toBe('Senin sıran');
    expect(tr.UI.overviewTurnImplementer).toBe('Uygulayıcının sırası');
    expect(tr.UI.overviewTurnVerifier).toBe('Doğrulayıcının sırası');
    expect(tr.UI.overviewDebtsTitle).toBe('Açık borçlar');
    expect(tr.UI.overviewReadyTitle).toBe('Başlamaya hazır');
    expect(tr.UI.overviewDebtUnlinked).toBe('bağlı iş emri yok');
    expect(tr.debtIdLabel('TD-016')).toBe('TD-016');
    expect(en.UI.overviewTitle).toBe('Overview');
    expect(en.UI.overviewTurnOperator).toBe('Your turn');
    expect(en.UI.overviewTurnVerifier).toBe("The verifier's turn");
    expect(en.UI.overviewDebtUnlinked).toBe('no linked work order');
    expect(en.debtIdLabel('TD-016')).toBe('TD-016');
  });
});
