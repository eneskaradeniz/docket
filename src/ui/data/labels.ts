// Tüm sabit arayüz metni burada (AC1: bileşenlerde gömlü metin yok).
// Domain enum'ları görüntü dizgelerine eşlenir; dinamik parçalar (kontrol adı, kapı) veriden gelir.
// ADR-0007: arayüz dili Türkçe'dir (WO-0013). en/tr seçici M3.5'te gelir.
import type {
  AbsentReason,
  ActionIntent,
  BoardBucket,
  BoardColumn,
  CardAction,
  CardActionKind,
  CardReason,
  EvidenceKind,
  EvidenceStatus,
  SessionRef,
  SessionRole,
  SourceKind,
  StepStatus,
  CostSummary,
  StageId,
  TrackStage,
  TrackMergeAction,
  WorkOrderId,
} from '../../core/types';
import type { LiveSessionStatus, SimplePhase } from '../../core/runner';
import type { WoPhase } from '../../core/derive';
import type { ProviderErrorCode } from '../../core/runner';

// Eski 3-sütunlu tahta (BoardColumn) — uyumluluk için kalır; yeni tahta BUCKET_* kullanır.
export const COLUMN_LABELS: Record<BoardColumn, string> = {
  your_turn: 'Sıra sende',
  running: 'Çalışıyor',
  external: 'Harici',
};

export const COLUMN_HELP: Record<BoardColumn, string> = {
  your_turn: 'Seni bekliyor',
  running: 'Bir oturum çalışıyor',
  external: 'Harici sistem bekleniyor',
};

// Yeni iki kovalı tahta (WO-0013).
export const BUCKET_LABELS: Record<BoardBucket, string> = {
  up: 'Sıra sende',
  working: 'Çalışıyor',
  closed: 'Kapalı',
};

export const BUCKET_HELP: Record<BoardBucket, string> = {
  up: 'Seni bekleyenler',
  working: 'Bir oturum çalışıyor',
  closed: 'Tamamlananlar',
};

export const ROLE_LABELS: Record<SessionRole, string> = {
  implementer: 'Uygulayıcı',
  architect: 'Mimar',
  verifier: 'Doğrulayıcı',
};

export const STAGE_LABELS: Record<StageId, string> = {
  written: 'Yazıldı',
  plan_requested: 'Plan istendi',
  plan_ready: 'Plan hazır',
  architect_approval: 'Mimar onayı',
  implementation: 'Uygulama',
  verification: 'Doğrulama',
  architect_audit: 'Mimar denetimi',
  closure: 'Kapanış',
  closed: 'Kapalı',
};

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  plan_approval: 'plan onayı',
  pr_open: 'PR açık',
  ci_green: 'CI yeşil',
  verification: 'doğrulama raporu',
  closure: 'kapanış belgeleri',
};

export const ACTION_LABELS: Record<ActionIntent, string> = {
  request_plan: 'Plan iste',
  approve_plan: 'Planı onayla',
  resume: 'Oturumu sürdür',
  open_pr: 'PR aç',
  merge_track: "Track'i mergele",
  request_verification: 'Doğrulama iste',
  audit: 'Denetim çalıştır',
  update_docs: 'Belgeleri güncelle',
  close: 'İş emrini kapat',
};

export const ABSENT_REASON_LABELS: Record<AbsentReason, string> = {
  awaiting_plan_commit: 'Plan onayı bekleniyor', // M2 wording (WO-0027/Bulgu 11): approval is the act; the commit-as-evidence link is M3
  docs_not_updated: 'ROADMAP ve tech-debt henüz güncellenmedi',
  depends_on_open: 'Bağımlı track merge olmadı',
  verifier_report_missing: 'Henüz doğrulayıcı raporu yok',
  step_not_resolved: 'Bir adımda revize kararı açık — Devam et ya da yeniden çalıştır',
  pointers_unresolved: 'Kanıt işaretçileri head sha’da çözülmüyor',
};

export function cardReasonText(r: CardReason): string {
  switch (r.kind) {
    case 'stopped_asking':
      return `Şurada durdu: ${r.gate}`;
    case 'ci_failed':
      return `CI başarısız: ${r.checkName}`;
    case 'ci_running':
      return 'CI çalışıyor';
    case 'in_progress':
      return 'Devam ediyor';
    case 'just_written':
      return UI.cardJustWritten;
    case 'awaiting_plan_commit':
      return 'Plan commiti bekleniyor';
    case 'docs_not_updated':
      return 'Belgeler güncellenmedi';
    case 'awaiting_next_session':
      return 'Sonraki oturum bekleniyor';
  }
}

// Kart üstündeki satır içi ▸ eylem (WO-0013). 'link' eylem niyetinden; diğerleri sabit.
export const CARD_ACTION_AREA: Record<CardActionKind, string> = {
  permission: 'İzin',
  plan: 'Plan hazır',
  closure: 'Kapanış',
  link: 'Eylem',
};

export function cardActionText(a: CardAction): string {
  if (a.kind === 'link') return ACTION_LABELS[a.intent];
  return { permission: 'İzin ver', plan: 'Planı onayla', closure: 'Belgeleri güncelle' }[a.kind];
}

export function mergeActionText(a: TrackMergeAction): string {
  if (a.kind === 'available') return 'Mergele';
  switch (a.reason) {
    case 'depends_on_open':
      return 'Merge engelli — bağımlılık açık';
    case 'ci_not_green':
      return 'Merge engelli — CI yeşil değil';
    case 'pr_not_open':
      return 'Henüz PR yok';
    case 'already_merged':
      return 'Merged';
  }
}

// AC1 (return-pass): track aşaması, oturum durumu, mod ve kaynak türü için görüntü eşlemeleri +
// bunları tümceye çeviren besteciler. Bunlarla hiçbir bileşen bir kod tanımlayıcıyı `.replace` ile
// arayüz metnine çevirmez; bir çevirmenin dokunacağı her kelime burada.
export const TRACK_STAGE_LABELS: Record<TrackStage, string> = {
  not_started: 'Başlamadı',
  implementation: 'Uygulama',
  pr_opened: 'PR açıldı',
  ci: 'CI',
  merged: 'Merged',
};

export const SESSION_STATUS_LABELS: Record<SessionRef['status'], string> = {
  running: 'Çalışıyor',
  stopped_asking: 'İzin istiyor',
  idle: 'Boşta',
  none: 'Yok',
};

// Plan adımları (WO-0017). Durum etiketi + işaretçi (mock'taki ✓/►/○/⊘).
export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Bekliyor',
  active: 'Çalışıyor',
  done: 'Tamam',
  blocked: 'Engelli',
};

export const STEP_MARK: Record<StepStatus, string> = {
  done: '✓',
  active: '►',
  pending: '○',
  blocked: '⊘',
};

// WO-0008: canlı oturum durumu (runner olay katlaması), yukarıdaki fixture SessionRef durumundan
// farklı. Ham tanımlayıcı gösterilmez (ADR-0007) — araç adları TOOL_LABELS üzerinden eşlenir.
export const LIVE_STATUS_LABELS: Record<LiveSessionStatus, string> = {
  idle: 'Boşta',
  running: 'Çalışıyor',
  stopped_asking: 'Seni bekliyor',
  plan_ready: 'Plan hazır',
  done: 'Bitti',
  error: 'Hata',
};

// SADE modu: canlı durumdan türetilen tek-satır faz etiketleri (WO-0016). Detay akışının yerine sakin
// bir ilerleme satırı — "Kod taranıyor…", "Plan düşünülüyor…". Faz core'da (simplePhaseFromState).
export const SIMPLE_PHASE_LABELS: Record<SimplePhase, string> = {
  planning_started: 'Plan oluşturuluyor…',
  scanning: 'Kod taranıyor…',
  thinking: 'Plan düşünülüyor…',
  writing_decisions: 'Karar deposu yazılıyor…',
  running_command: 'Komut çalıştırılıyor…',
  delegating: 'Alt görev başlatıldı…',
  fetching: 'Kaynaklar aranıyor…',
  asking_input: 'Mimar seni bekliyor.',
  asking_permission: 'Mimarın bir isteği var.',
  ready: 'Plan hazır.',
  errored: 'Bir hata oluştu.',
  done: 'Bitti.',
};

export const TOOL_LABELS: Record<string, string> = {
  Write: 'Dosya yaz',
  Edit: 'Dosya düzenle',
  MultiEdit: 'Dosyaları düzenle',
  NotebookEdit: 'Notebook düzenle',
  NotebookEditNew: 'Notebook düzenle',
  Bash: 'Komut çalıştır',
  Read: 'Dosya oku',
  Grep: 'Ara',
  Glob: 'Dosya bul',
  Task: 'Devret',
  WebFetch: 'Sayfa getir',
  WebSearch: "Web'de ara",
  ExitPlanMode: 'Planı bitir',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? 'Araç kullan';
}

export function permissionPrompt(tool: string, detail: string): string {
  const label = toolLabel(tool);
  return detail ? `${label} — ${detail}` : label;
}

export const MODE_LABELS: Record<'plan' | 'direct', string> = {
  plan: 'Plan',
  direct: 'Direkt',
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  adr: 'ADR',
  tech_debt: 'teknik borç',
  roadmap: 'ROADMAP',
  contract: 'sözleşme',
};

export const EVIDENCE_MARK: Record<EvidenceStatus, string> = {
  satisfied: '[x]',
  unsatisfied: '[ ]',
  exempt: '[~]',
};

export function trackSessionText(session: { status: SessionRef['status'] } | undefined | null): string {
  return session ? `oturum · ${SESSION_STATUS_LABELS[session.status]}` : 'Oturum yok';
}

export function dependsOnText(count: number): string {
  return `${count} bağımlılığı var`;
}

export function needsText(kind: EvidenceKind): string {
  return `${EVIDENCE_LABELS[kind]} gerekli`;
}

export function modeText(mode: 'plan' | 'direct'): string {
  return `${MODE_LABELS[mode]} modu`;
}

export function stoppedAtGate(gate: string): string {
  return `durdu · ${gate}`;
}

// tr-TR ondalık ayraç (virgül) — mock'taki "$0,94" ile uyumlu.
export function formatUsd(usd: number): string {
  const n = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);
  return `$${n}`;
}

// Token sayısı kısaltması: 10k+ tam k, 1k+ bir ondalık, altı ham sayı (WO-0022).
export function formatTokens(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

// Maliyet + token özeti: "$0,41 · 68k→2k" (giriş→çıkış). Oturum/WO maliyeti yanında token harcaması (WO-0022).
export function formatCost(c: CostSummary): string {
  return `${formatUsd(c.usd)} · ${formatTokens(c.tokensIn)}→${formatTokens(c.tokensOut)}`;
}

// İş-emri numarası (örn. WO-0006) — operatörün kasten yarattığı bilet kimliğidir, anlamlı görüntüdür;
// donuk bir iç kimlik (UUID/yol) değil. ADR-0007 carve-out: bir bilet kimliği yalnızca bu fonksiyon
// arkasından gösterilir, asla ham {id} olarak değil. Bugün identity; biçim/yerel-arayüz buradan değişir.
export function woIdLabel(id: WorkOrderId): string {
  return id;
}

// Sağlayıcı hata dizgeleri (WO-0025 / B1) — koda göre Türkçe metin; kod yoksa ham mesaj gösterilir.
export const PROVIDER_ERROR_LABELS: Record<ProviderErrorCode, string> = {
  auth_missing: "Sağlayıcı kimliği bulunamadı — Ayarlar → Agent sağlayıcısı'ndan anahtar kaydet veya sağlayıcı girişi yap.",
  auth_failed: "Sağlayıcı kimliği reddedildi — Ayarlar → Agent sağlayıcısı'ndan anahtarı kontrol et.",
  timeout: 'Sağlayıcı bağlantısı zaman aşımına uğradı — ağ/ağ geçidi durumunu kontrol et.',
  executable_missing: 'Sağlayıcı çalıştırılabilirı bulunamadı — kurulumu kontrol et.',
};

// Rol-farkında izin satırı (WO-0027 / Bulgu 8) — ekTürkçe ekler sabit tablada, kural değil.
const ASKING_ROLE: Record<SessionRole, string> = {
  implementer: 'Uygulayıcının bir isteği var.',
  architect: 'Mimarın bir isteği var.',
  verifier: 'Doğrulayıcının bir isteği var.',
};

// Chrome dizgeleri — ayrıca veriye yönlendirilir, böylece bileşenlerde literal metin yoktur.
export const UI = {
  productName: 'Docket',
  backToBoard: '← İş emirleri',
  evidence: 'Kanıtlar',
  tracks: 'Track’ler',
  session: 'Oturum',
  sessionLog: 'Oturum günlüğü',
  sources: 'Kaynaklar',
  noWorkOrders: 'İş emri yok',
  noSessionForRole: 'Bu rol için oturum yok.',
  transcriptEmpty: '(transkript boş)',
  provisional: 'geçici',
  ciExempt: 'CI muaf',
  tokens: 'token',
  costNoSessions: 'Henüz oturum yok',
  orderDoc: 'order.md',
  planDoc: 'plan.md',
  workOrders: 'iş emri',
  noActionAvailable: 'Eylem yok.',
  tracksUnit: 'track',
  missing: 'eksik',
  scopedToTrack: ' · track',
  loading: 'Yükleniyor…',
  loadError: 'İş emirleri yüklenemedi.',
  boardIntro: 'Şu an sana ne düşüyor ve her oturum ne yapıyor.',
  inflightEmpty: 'Çalışan oturum yok.',
  closedDrawer: 'Kapalı',
  showPipeline: 'Akışı göster',
  pipelineHint: '9 aşama rayı · track’ler · kaynaklar · order.md · plan.md',
  metaSep: ' · ',
  // Canlı oturum bölmesi (WO-0008)
  permissionRequested: 'İzin istendi',
  startSession: 'Oturumu başlat',
  resumeSession: 'Sürdür',
  promptPlaceholder: 'Bu oturum ne yapsın?',
  allow: 'İzin ver',
  deny: 'Reddet',
  approve: 'Planı onayla',
  interrupt: 'Durdur',
  awaitingApproval: 'Plan hazır — devam etmek için incele ve onayla.',
  noSession: 'Çalışan oturum yok.',
  // Ayarlar modalı (WO-0013)
  settings: 'Ayarlar',
  theme: 'Tema',
  themeLight: 'Açık',
  themeDark: 'Koyu',
  themeSystem: 'Sistem',
  language: 'Dil',
  langEn: 'English',
  langTr: 'Türkçe',
  close: 'Kapat',
  workspace: 'Çalışma alanı',
  // ActionCard (salt-okunur "ne lazım" banner'ı — butonlar SessionPane'de)
  actionNeeded: 'Ne lazım',
  actionNotWired: 'Bu eylem oturum bölmesinden yapılır.',
  // Workspace management (WO-0014)
  wsSettings: 'Workspace ayarları',
  wsCreate: 'Yeni çalışma alanı',
  wsSettingsSubtitle: 'Yerel repo yolları ve karar deposu.',
  wsNameLabel: 'Ad',
  wsReposLabel: 'Repo bağlantıları',
  wsReposHint: "Yerel klasörü seç — GitHub bilgisi .github/'dan otomatik bulunur.",
  wsRepoAdd: '▸ Repo ekle',
  wsRepoAddManual: 'Ekle',
  wsRepoPick: 'Klasör',
  wsRepoPlaceholder: 'yerel repo yolu',
  wsDecisionStore: 'Karar deposu',
  wsErrName: 'Ad gerekli.',
  wsErrRepo: 'En az bir geçerli repo yolu ekle (örn. /Users/.../proje).',
  wsDecisionSameRepo: '— aynı reponun docs/ klasörü —',
  wsSave: 'Kaydet',
  wsCreateBtn: 'Oluştur',
  wsListTitle: 'Çalışma alanları',
  wsListSubtitle: 'Seç, ara veya yeni oluştur.',
  wsListFilter: 'ara…',
  wsListEmpty: 'Eşleşen yok.',
  wsListCreate: '▸ Yeni çalışma alanı',
  wsAll: 'Tümünü gör',
  wsRemove: "Docket'tan kaldır",
  // Kart sebebi — yeni yazılmış iş emri (WO-0015)
  cardJustWritten: 'İş emri yazıldı — bir plan isteyerek başla',
  // İş emri oluşturma (WO-0015)
  newWorkOrder: '▸ Yeni iş emri',
  woCreate: 'Yeni iş emri',
  woCreateSubtitle: 'Bir başlık ve hedef gir. Oluştur de, iş emri “yazıldı” aşamasında açılır ve kendi sayfasına gidersin.',
  woTitleLabel: 'Başlık',
  woTitlePlaceholder: 'Örn. Kullanıcı profili avatar yüklerken hata',
  woDescLabel: 'Açıklama / hedef',
  woDescPlaceholder: 'Bu iş emri neyi başarmalı? İlk prompt olarak mimar oturumuna gider.',
  woTracksLabel: "Track’ler (ilgili repolar)",
  woTracksHint: 'Karar deposu bir track değildir; listede yer almaz.',
  woContextLabel: 'Context (dosya)',
  woContextAdd: '▸ Dosya ekle',
  woReviewLabel: 'Denetim',
  woReviewGates: 'Sade — mimar otonom; plan onayı, revizyon ve merge’de sorar',
  woReviewEvery: 'Her adımda — her rapordan sonra bana sor',
  woCreateBtn: 'Oluştur',
  // Plan döngüsü (WO-0016)
  requestPlan: 'Plan iste',
  approvingPlan: 'Plan işleniyor…',
  planReadyHeader: 'Plan hazır',
  planReviewHint: 'Planı oku, sonra onayla ya da itiraz et.',
  object: 'İtiraz et',
  objectPlaceholder: 'Neden itiraz ediyorsun? Mimar revize etsin.',
  objectSend: 'Gönder',
  objectCancel: 'Vazgeç',
  objectingPlan: 'Plan revize ediliyor…',
  // Mimar soru kartı (WO-0016)
  architectWaiting: 'Mimar seni bekliyor',
  architectQuestionHint: 'Mimar devam etmek için sana soru sordu.',
  replyPlaceholder: 'Yanıtını yaz…',
  reply: 'Yanıtla',
  skipReply: 'Bilmiyorum',
  architectRequest: 'Mimarın bir isteği var',
  // SADE/Detay mod geçişi (WO-0016)
  modeSimple: 'Sade',
  modeDetail: 'Detay',
  // Onboarding: ilk çalışma alanı (WO-0016)
  noWorkspaceHint: 'Başlamak için bir çalışma alanı oluştur — yerel repo klasörünü seç, karar deposu otomatik belirlenir.',
  // Plan adımları (WO-0017)
  stepsHeader: 'Plan',
  stepsUnit: 'adım',
  stepRun: 'Çalıştır',
  stepResume: 'Sürdür',
  stepReportTitle: 'Rapor',
  stepReportMissing: '(rapor henüz yok)',
  stepScopeAll: 'hepsi',
  stepBlockedHint: 'kapsam bir track ile eşleşmiyor',
  noSteps: 'Onaylı plan çalışan bir adım listesi içermiyor — mimardan yeniden plan iste.',
  // İş emri silme (WO-0020)
  deleteWo: 'Sil',
  deleteWoHint: 'Bu iş emri kalıcı olarak silinir — order.md, plan.md, raporlar ve tüm oturum kayıtları kaldırılır. Geri alınamaz.',
  deleteWoConfirm: 'Evet, sil',
  deleteWoInFlight: 'Siliniyor…',
  cancel: 'Vazgeç',
  stepsAllDone: 'Tüm adımlar tamam',
  stepsAllDoneHint: "Plan uygulandı, tüm adımlar mimar denetiminden geçti. Kapanış: iş emrini kapat — merge'ler senin onayınla kayda geçer, kapanış notu order.md'ye yazılır.",
  // İş emri kapanışı (WO-0025)
  closeWo: 'İş emrini kapat',
  closeWoHint: "Tüm adımlar tamam ve denetimli. Kapatınca: merge'ler yapıldı olarak kayda geçer (M3'e kadar operatör onayı), kapanış notu order.md'ye eklenir ve iş emri 'Kapalı' çekencesine taşınır.",
  closeNoteLabel: 'Kapanış notu',
  closeNotePlaceholder: "Kısa bir kapanış notu — order.md'ye yazılır",
  closeWoConfirm: 'Evet, kapat',
  closeWoInFlight: 'Kapatılıyor…',
  closeWoFailed: 'Kapatılamadı: ön koşullar karşılanmadı (adım/denetim eksik olabilir).',
  // Sertleştirme dizgeleri (WO-0026)
  errorBoundaryTitle: 'Bir şeyler ters gitti',
  errorBoundaryHint: "Beklenmeyen bir hata oluştu. Yeniden yükleyebilirsin — kalıcı kayıtlar etkilenmez, yalnızca açık canlı oturum akışı kaybolur.",
  reload: 'Yeniden yükle',
  detailLoadError: 'İş emri yüklenemedi.',
  loadRetry: 'Yeniden dene',
  saveFailed: 'Kaydedilemedi — tekrar dene.',
  woErrTitle: 'Başlık gerekli.',
  // Çoklu askı (WO-0027 / Bulgu 10): başlıkta sayı + toplu onay
  asksPending: (n: number) => `${n} istek bekliyor`,
  actionRunning: 'Çalışıyor',
  // WO-0029 cila dizgeleri
  closeWoDoneTitle: 'Kapandı',
  planNoStepsWarn: 'Planda adım listesi (```steps) yok — onaylarsan adım akışı ve denetimler çalışmaz. İtiraz etmeyi düşün.',
  objectingLine: 'Mimar yeniden planlıyor…',
  overrideVerdictBtn: 'Devam et (geçersiz kıl)',
  overrideVerdictHint: "Mimarın 'revize' kararını geçersiz kılıp proceed yapar — mimarın özgün metni verdict dosyasında kalır.",
  permModeLabel: 'İzin modu',
  permModeAsk: 'Sor',
  permModeAuto: 'Otomatik',
  permModeHint: 'Otomatik: kapsam-içi her istek onaylı sayılır; kapsam-dışı yazmalar yine engellenir. Sor: her istekte kart çıkar.',
  verdictOverrideDone: 'Geçersiz kılındı — adım proceed sayıldı.',
  allowAll: 'Tümüne izin ver',
  // Rol-farkında askı satırı (Bulgu 8): 'Mimarın bir isteği var' sabitti; isteyen rol hangisiyse o.
  askingRole: (role: SessionRole) => ASKING_ROLE[role],
  // Süre (İstek 7)
  formatDuration: (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}sn`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}dk ${sec % 60}sn`;
    const h = Math.floor(min / 60);
    return `${h}s ${min % 60}dk`;
  },
  // Sağlayıcı ayarları (WO-0025 / B1)
  providerLabel: 'Agent sağlayıcısı',
  providerStatusOk: 'Hazır', // + source shown appended by the modal
  providerStatusUnknown: 'Durum bilinmiyor — anahtar kaydet ya da Test et',
  providerKeyLabel: 'API anahtarı',
  providerKeyPlaceholder: 'sk-… (yoksa sağlayıcı girişi kullanılır)',
  providerKeySave: 'Kaydet',
  providerKeyClear: 'Temizle',
  providerTest: 'Test et',
  providerTesting: 'Sınanıyor…',
  providerHint: 'Anahtar paylaşılan veritabanına kaydedilir; GUI ve CLI birlikte görür. Sağlayıcı girişi varsa anahtar gerekmez.',
  // Mimar denetim / karar (WO-0020)
  reviewHeader: 'Mimar denetimi',
  reviewHint: 'Mimar bu adımın raporunu inceliyor…',
  verdictLabel: 'Karar',
  verdictCardProceedTitle: 'Mimar devam dedi',
  verdictCardReviseTitle: 'Mimar revize istiyor',
  verdictCardUnknown: 'Mimar net karar vermedi — sen incele.',
  verdictCardHint: 'Raporu oku, sonra devam et ya da adımı yeniden çalıştır.',
  devamStep: 'Devam et',
  rerunStep: 'Adımı yeniden çalıştır',
  stepVerdictMissing: '(karar henüz yok)',
  // Pipeline faz göstergesi (WO-0021)
  woPhaseJustWritten: 'İş emri yazıldı — plan iste',
  woPhasePlanning: 'Mimar planı düşünüyor…',
  woPhasePlanReady: 'Plan hazır — onayla',
  woPhaseImplementing: 'Uygulama',
  woPhaseClosing: 'Kapanış — belgeleri güncelle',
  woPhaseDone: 'Tamamlandı',
} as const;

// WO-level faz etiketi — derivePhase çıktısını görüntü dizgesine çevirir (WO-0021). Faz birincil yüzey;
// 9-aşama rayı ikincil ("Akışı göster" arkasında).
export function phaseLabelText(p: WoPhase): string {
  switch (p.kind) {
    case 'just_written':
      return UI.woPhaseJustWritten;
    case 'planning':
      return UI.woPhasePlanning;
    case 'plan_ready':
      return UI.woPhasePlanReady;
    case 'implementing':
      return p.total > 0 ? `Uygulama · ${p.done}/${p.total} ${UI.stepsUnit}` : UI.woPhaseImplementing;
    case 'reviewing':
      return `${UI.reviewHeader} · ${UI.stepsUnit} ${p.stepIdx}`;
    case 'closing':
      return UI.woPhaseClosing;
    case 'done':
      return UI.woPhaseDone;
  }
}

// Mimar karar işareti — done adımın yanında (WO-0020).
export const VERDICT_MARK: Record<'proceed' | 'revise', string> = {
  proceed: '✓',
  revise: '↻',
};
