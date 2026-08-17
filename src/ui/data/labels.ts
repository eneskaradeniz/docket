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
  SessionRef,
  SessionRole,
  SourceKind,
  StepStatus,
  CostSummary,
  StageId,
  WorkOrderId,
  WoEventKind,
} from '../../core/types';
import type { LiveSessionStatus, SimplePhase } from '../../core/runner';
import type { TranscriptLine } from '../../core/types';
import type { PermissionRule } from '../../core/source';
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
// D3 (tur-2): merge is not a UI action today. When the command becomes real it belongs in the
// RAIL, and this wording needs de-jargoning ('Repoyu birleştir'-style) per ADR-0012 r4.
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

// AC1 (return-pass): track aşaması, oturum durumu, mod ve kaynak türü için görüntü eşlemeleri +
// bunları tümceye çeviren besteciler. Bunlarla hiçbir bileşen bir kod tanımlayıcıyı `.replace` ile
// arayüz metnine çevirmez; bir çevirmenin dokunacağı her kelime burada.
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

/** One transcript line as PLAIN text (the fail card's detail + clipboard, WO-0031c) — the ANSI
 *  formatter is for xterm; this is its DOM/clipboard sibling, same label discipline. */
export function transcriptLineText(line: TranscriptLine): string {
  switch (line.speaker) {
    case 'assistant':
      return line.text;
    case 'tool_use':
      return line.detail ? `${toolLabel(line.tool)} — ${line.detail}` : toolLabel(line.tool);
    case 'tool_result':
      return `→ ${line.summary}`;
    case 'system':
      return line.text;
    case 'note':
      return UI.noteFor(line.kind, line.detail);
  }
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

// Yaşam döngüsü olay günlüğü (WO-0030 / İstek 8; WO-0031c düzenleme/izin türleri eklendi)
export const WO_EVENT_LABELS: Record<WoEventKind, string> = {
  created: 'Oluşturuldu',
  plan_saved: 'Plan önerildi (pending)',
  plan_approved: 'Plan onaylandı',
  step_started: 'Adım başladı',
  step_done: 'Adım tamamlandı',
  step_verdict: 'Mimar kararı',
  verdict_overridden: 'Karar geçersiz kılındı (operatör)',
  closed: 'Kapatıldı',
  wo_edited: 'İş emri düzenlendi',
  rule_changed: 'Kural değişti',
  permission_decision: 'İzin kararı',
};

/** The STRUCTURAL event detail → display (WO-0031c): the store writes machine detail (`edited:3`,
 *  `allowed · check.yml`, `full_auto`); this is the one place it becomes Turkish. */
export function eventDetailText(kind: WoEventKind, detail: string): string {
  if (!detail) return '';
  switch (kind) {
    case 'plan_approved': {
      const m = /^edited:(\d+)$/.exec(detail);
      return m ? `düzenlenmiş onay · ${m[1]} değişiklik` : detail;
    }
    case 'permission_decision': {
      const sep = detail.indexOf(' · ');
      const head = sep >= 0 ? detail.slice(0, sep) : detail;
      const rest = sep >= 0 ? detail.slice(sep + 3) : '';
      const verdict = head === 'allowed' ? 'izin verildi' : head === 'denied' ? 'reddedildi' : head;
      return rest ? `${verdict} · ${rest}` : verdict;
    }
    case 'rule_changed':
      return PERMISSION_RULE_LABELS[detail as PermissionRule] ?? detail;
    default:
      return detail;
  }
}

// Per-WO izin kuralı (WO-0031c) — değerler → görüntü.
export const PERMISSION_RULE_LABELS: Record<PermissionRule, string> = {
  ask_every: 'Her seferinde sor',
  risky_excluded: 'Riskli hariç',
  full_auto: 'Tam otomatik',
};
export const PERMISSION_RULE_SHORT: Record<PermissionRule, string> = {
  ask_every: 'İzin: hep sor',
  risky_excluded: 'İzin: otomatik',
  full_auto: 'İzin: tam otomatik',
};
export const PERMISSION_RULE_TINY: Record<PermissionRule, string> = {
  ask_every: 'İzin: sor',
  risky_excluded: 'İzin: oto',
  full_auto: 'İzin: tam',
};

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
/** "15 Ağu 17:15" — audit satırlarının zaman damgası (WO-0030). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS_TR[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Rol-farkında byline (WO-0031b): 'mimar'/'uygulayıcı'/'doğrulayıcı' — hardcode değil.
export function askingRole(role: SessionRole): string {
  return ASKING_ROLE[role];
}

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
  // Tur-2 D2/D3 — Kanıt chip dili: yokluk cümleleri (ADR-0001 ruhu — sebepsiz 'eksik' yok) + iz konumu.
  evdPlanApproval: 'plan onayı bekliyor',
  evdVerification: 'doğrulayıcı raporu yok',
  evdClosure: 'belgeler güncellenmedi',
  evdPrMissing: (repo: string) => `PR açılmadı · ${repo}`,
  evdCiRed: (repo?: string) => (repo ? `CI yeşil değil · ${repo}` : 'CI yeşil değil'),
  evdNoPr: 'henüz PR yok',
  evdPrCi: (ciState: string) => `PR açık · ${ciState}`,
  evdCiGreenShort: 'CI yeşil',
  evdMerged: (repo?: string) => (repo ? `✓ Depoda · ${repo}` : '✓ Depoda'),
  sources: 'Kaynaklar',
  ciExempt: 'CI muaf',
  orderDoc: 'order.md',
  planDoc: 'plan.md',
  loading: 'Yükleniyor…',
  loadError: 'İş emirleri yüklenemedi.',
  closedDrawer: 'Kapalı',
  // Canlı oturum bölmesi (WO-0008)
  permissionRequested: 'İzin istendi',
  startSession: 'Oturumu başlat',
  resumeSession: 'Sürdür',
  promptPlaceholder: 'Bu oturum ne yapsın?',
  allow: 'İzin ver',
  deny: 'Reddet',
  interrupt: 'Durdur',
  noSession: 'Çalışan oturum yok.',
  // Ayarlar modalı (WO-0013)
  settings: 'Ayarlar',
  language: 'Dil',
  langEn: 'English',
  langTr: 'Türkçe',
  close: 'Kapat',
  // ActionCard (salt-okunur "ne lazım" banner'ı — butonlar SessionPane'de)
  actionNeeded: 'Ne lazım',
  // Workspace management (WO-0014)
  wsSettings: 'Workspace ayarları',
  wsCreate: 'Yeni çalışma alanı',
  wsNameLabel: 'Ad',
  wsReposLabel: 'Repo bağlantıları',
  wsRepoAddManual: 'Ekle',
  wsRepoPick: 'Klasör',
  wsRepoPlaceholder: 'yerel repo yolu',
  wsDecisionStore: 'Karar deposu',
  wsErrName: 'Ad gerekli.',
  wsErrRepo: 'En az bir geçerli repo yolu ekle (örn. /Users/.../proje).',
  wsSave: 'Kaydet',
  wsCreateBtn: 'Oluştur',
  wsListTitle: 'Çalışma alanları',
  wsListFilter: 'ara…',
  wsListEmpty: 'Eşleşen yok.',
  wsListCreate: '▸ Yeni çalışma alanı',
  wsAll: 'Tümünü gör',
  // Kart sebebi — yeni yazılmış iş emri (WO-0015)
  cardJustWritten: 'İş emri yazıldı — bir plan isteyerek başla',
  // İş emri oluşturma (WO-0015)
  newWorkOrder: '▸ Yeni iş emri',
  woCreate: 'Yeni iş emri',
  woTitleLabel: 'Başlık',
  woTitlePlaceholder: 'Örn. Kullanıcı profili avatar yüklerken hata',
  woDescLabel: 'Açıklama / hedef',
  woDescPlaceholder: 'Bu iş emri neyi başarmalı? İlk prompt olarak mimar oturumuna gider.',
  woTracksLabel: 'Repolar',
  woContextLabel: 'Context (dosya)',
  woContextAdd: '▸ Dosya ekle',
  woReviewLabel: 'Denetim',
  woCreateBtn: 'Oluştur',
  // Plan döngüsü (WO-0016)
  requestPlan: 'Plan iste',
  planReadyHeader: 'Plan hazır',
  object: 'İtiraz et',
  objectSend: 'Gönder',
  objectCancel: 'Vazgeç',
  // Mimar soru kartı (WO-0016)
  architectWaiting: 'Mimar seni bekliyor',
  replyPlaceholder: 'Yanıtını yaz…',
  reply: 'Yanıtla',
  skipReply: 'Bilmiyorum',
  architectRequest: 'Mimarın bir isteği var',
  // Onboarding / davet (WO-0016 → WO-0031d: boş durum = 1 satır + 1 eylem).
  inviteFirstWo: 'Haydi ilk iş emrini açalım',
  // Plan adımları (WO-0017)
  stepsHeader: 'Plan',
  stepsUnit: 'adım',
  stepReportTitle: 'Rapor',
  stepReportMissing: '(rapor henüz yok)',
  stepScopeAll: 'hepsi',
  stepBlockedHint: 'kapsam bir track ile eşleşmiyor',
  noSteps: 'Onaylı plan çalışan bir adım listesi içermiyor — mimardan yeniden plan iste.',
  // İş emri silme (WO-0020)
  deleteWo: 'Sil',
  deleteWoHint: 'Bu iş emri kalıcı olarak silinir — order.md, plan.md, raporlar ve tüm oturum kayıtları kaldırılır. Geri alınamaz.',
  deleteWoConfirm: 'Evet, sil',
  cancel: 'Vazgeç',
  stepsAllDone: 'Tüm adımlar tamam',
  // İş emri kapanışı (WO-0025)
  closeWo: 'İş emrini kapat',
  closeNoteLabel: 'Kapanış notu',
  closeNotePlaceholder: "Kısa bir kapanış notu — order.md'ye yazılır",
  closeWoConfirm: 'Evet, kapat',
  closeWoFailed: 'Kapatılamadı: ön koşullar karşılanmadı (adım/denetim eksik olabilir).',
  closeStatEvidence: 'Kanıt',
  closeStatReviews: 'İnceleme',
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
  overrideVerdictBtn: 'Devam et (geçersiz kıl)',
  overrideVerdictHint: "Mimarın 'revize' kararını geçersiz kılıp proceed yapar — mimarın özgün metni verdict dosyasında kalır.",
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
  providerStatusOk: 'Hazır', // + source shown appended by the modal
  providerStatusUnknown: 'Durum bilinmiyor — anahtar kaydet ya da Test et',
  providerTest: 'Test et',
  // Mimar denetim / karar (WO-0020)
  reviewHeader: 'Mimar denetimi',
  reviewHint: 'Mimar bu adımın raporunu inceliyor…',
  verdictCardProceedTitle: 'Mimar devam dedi',
  verdictCardReviseTitle: 'Mimar revize istiyor',
  verdictCardUnknown: 'Mimar net karar vermedi — sen incele.',
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
  // ===== Kontrol Konsolu v2 (WO-0031c / v4 mockup) =====
  // Görünüm modu — global, hatırlanır; strip'teki mono segment.
  viewModeSimple: 'SADE',
  viewModeDetail: 'DETAY',
  viewModeAria: 'Görünüm — Sade veya Detay',
  // Sıra durumu (deriveTurnState çıktısı) — substrip satırı. Kısa metin kuralı (operatör): çalışan
  // durumda doldurma güvence cümlesi YOK — yalnız "Çalışıyor" + canlı satır; bilgi taşıyan satırlar
  // (maliyet donması gibi) kalır.
  turnYours: 'Sıra sende',
  turnRunning: 'Çalışıyor',
  turnStopped: 'Durduruldu — istersen sürdür',
  turnRetry: 'Yeniden dene',
  turnDone: 'Kapandı',
  // Tur-2 D1: the only-closed board platform.
  boardAllDone: 'Bütün işler tamam',
  // Tur-2 A3: the short closure sha (full sha in title/aria; click copies).
  closeShaAria: 'Kapanış kaydı — kopyala',
  copyDone: 'Kopyalandı',
  // Strip (başlık şeridi) ölçümleri + düzenleme katmanı.
  stripCost: 'Maliyet',
  stripDuration: 'Süre',
  objectTitle: 'İtirazın ne?',
  dialogCloseAria: 'kapat',
  removeAria: 'kaldır',
  stripGateReason: 'önce oturumu durdur',
  objectLinePlaceholder: 'Bir cümle yaz — mimar planı düzeltir…',
  // Ray (alt aksiyon çubuğu) — düğme + mesaj dili (v4 kısa metin). Çalışırken mesaj yok — rail yalnız
  // Durdur taşır ("Çalışıyor"u substrip söyler); mesajlar bilgi taşır (maliyet işlemez gibi).
  railApprove: 'Onayla',
  railApproveHint: 'Onayla — adımlar sırayla koşar.',
  railCloseHint: 'Kapat — arşive gider, not bırakabilirsin.',
  railAskHint: 'Oturum durdu — maliyet işlemez.',
  railResume: '▶ Sürdür',
  railStopping: 'Durduruluyor…',
  railRetry: 'Yeniden dene',
  // Adım kartı durum satırı (kart dili).
  stepReady: 'hazır',
  // Plan onayı: kart yüzü ("Mimar N adım önerdi").
  planProposedSteps: (n: number) => `Mimar ${n} adım önerdi`,
  // DETAY bölüm yüzeyleri — sekme adları @<1080 ve raf başlıkları @≥1080 aynı dili kullanır.
  secTerminal: 'Terminal',
  secSteps: 'Adımlar',
  secEvidence: 'Kanıt',
  secTimeline: 'Çizelge',
  secDocs: 'Belgeler',
  secSources: 'Kaynaklar',
  secTracks: 'Repolar',
  // Terminal notları (TranscriptNoteKind → görüntü; core'a noteFor olarak enjekte edilir).
  noteFor: (kind: 'interrupt_sent' | 'session_closed' | 'force_killed', detail?: string) => {
    const base = { interrupt_sent: '⏸ kesme sinyali gönderildi', session_closed: '■ oturum kapandı', force_killed: '■ zorla kesildi' }[kind];
    return detail ? `${base} — ${detail}` : base;
  },
  // ===== c2 (WO-0031c): kural, düzenleme, denetim, bildirim =====
  // İzin kuralı — Ayarlar (varsayılan) + create-modal + rozet + izin kartı.
  permRuleLabel: 'İzin kuralı',
  permRuleQuestion: 'İzin kuralı — ajan sizden ne zaman izin istesin',
  askRiskyTag: 'riskli yazım',
  askAlwaysAuto: 'Bu iş emri için hep otomatik',
  // WO satır içi düzenleme + inceleme modu rozeti.
  reviewModeLabel: 'İnceleme',
  reviewModeGatesShort: 'Kapılarda',
  reviewModeEveryShort: 'Her adımda',
  woEditAria: 'İş emrini düzenle',
  woEditTitle: 'İş emrini düzenle',
  woEditSave: 'Kaydet',
  woEditTitleLabel: 'Başlık',
  woEditDescLabel: 'Açıklama / hedef',
  // Plan düzenleme (onay öncesi).
  editPlan: 'Düzenle',
  editPlanDone: 'Bitti',
  editAddStep: '+ Adım ekle',
  editNewStepAim: 'Yeni adım — yaz…',
  editCounter: (n: number) => `${n} değişiklik — onayın "düzenlenmiş onay" olarak loglanır`,
  editAimMissing: 'Bir adımın metni boş — doldurunca Onayla gelir.',
  editMoveUpAria: 'Yukarı taşı',
  editMoveDownAria: 'Aşağı taşı',
  editRemoveAria: 'Adımı sil',
  editRoleAria: (role: SessionRole) => `Rol: ${ROLE_LABELS[role]} — değiştirmek için tıkla`,
  stepRef: (idx: number) => `adım ${idx}`,
  stepSegments: (idx: number, total: number) => `adım ${idx}/${total}`,
  // Denetim (oturum dökümü tablosu).
  auditTitle: 'Oturum dökümü',
  auditColSession: 'Oturum',
  auditColRole: 'Rol',
  auditColTime: 'Zaman',
  auditColDuration: 'Süre',
  auditColCost: 'Maliyet',
  auditTotal: 'Toplam',
  auditCostNone: '—',
  auditClock: (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  auditRange: (a: string, b: string) => `${UI.auditClock(a)} – ${UI.auditClock(b)}`,
  auditNamePlan: 'Plan',
  auditNameStep: (idx: number, aim?: string) => (aim ? `Adım ${idx} · ${aim}` : `Adım ${idx}`),
  auditNameReview: (idx: number) => `İnceleme ${idx}`,
  auditNameUnscoped: 'Bağımsız',
  stepCostMeta: (duration: string, cost: string) => `tamam · ⏱ ${duration} · ${cost}`,
  // Diff peek (yazma izni kartı).
  diffPeek: '▸ fark',
  diffPeekHide: '▾ fark',
  diffTruncated: (n: number) => `… ${n} satır`,
  diffEmpty: 'Değişiklik yok',
  // Durum: wind-down, force-kill, hata kartı.
  railForceKill: 'Zorla kes',
  railStoppedMsg: 'Durduruldu. Rapor kısmi kalır.',
  failTitle: 'Oturum çöktü',
  failSpent: (cost: string) => `Harcanan: ${cost} — kayıt korundu.`,
  failDetail: 'Ayrıntı',
  failCopy: 'Kopyala',
  failCopied: 'Kopyalandı',
  failLastTitle: 'Son satırlar',
  // Toast + bildirim sözleşmesi.
  toastAskTitle: (wo: string) => `${wo} · izin bekliyor`,
  toastAskBody: 'tıkla — detaya git',
  toastErrTitle: (wo: string) => `${wo} · oturum çöktü`,
  toastRuleSaved: 'Kural kaydedildi',
  toastRuleSavedBody: 'bu iş emrinde tam otomatik',
  titlePending: (n: number) => `(${n}) izin bekliyor`,
  // Create-modal: tek adımda mimar + yeni inceleme adları.
  createAndPlan: 'Oluştur ve plan iste',
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
