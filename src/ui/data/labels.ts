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
  StageId,
  TrackStage,
  TrackMergeAction,
} from '../../core/types';
import type { LiveSessionStatus, SimplePhase } from '../../core/runner';

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
  awaiting_plan_commit: 'Commitlenen plan bekleniyor',
  docs_not_updated: 'ROADMAP ve tech-debt henüz güncellenmedi',
  depends_on_open: 'Bağımlı track merge olmadı',
  verifier_report_missing: 'Henüz doğrulayıcı raporu yok',
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
  stepsAllDoneHint: 'Plan uygulandı. Kapanış — PR açma, CI, merge ve karar deposu güncellemesi — M3 aşamasında geliyor; şimdilik elle commit/merge yapabilirsin.',
} as const;
