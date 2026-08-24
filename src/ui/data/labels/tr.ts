// src/ui/data/labels/tr.ts — the TURKISH bundle (WO-0035). Tüm sabit arayüz metni burada (AC1:
// bileşenlerde gömlü metin yok); en.ts bu dosyadan türeyen Labels tipini sağlamak zorunda — eksik
// anahtar derleme hatasıdır (ADR-0007'in "eksik anahtar için en fallback" maddesi tip sistemiyle
// karşılanır). Domain enum'ları görüntü dizgelerine eşlenir; dinamik parçalar (kontrol adı, kapı)
// veriden gelir. Yerel-arayüzden bağımsız glifler (✓ ► ⊘) marks.ts'tedir.
// ADR-0007: arayüz dili Türkçe'dir (WO-0013); en/tr seçici WO-0035 ile geldi.
import type {
  AbsentReason,
  ActionIntent,
  BoardBucket,
  CardAction,
  CardActionKind,
  CardReason,
  EvidenceKind,
  SessionRole,
  SourceKind,
  StepStatus,
  CostSummary,
  StageId,
  WorkOrderId,
  WoEventKind,
  TranscriptLine,
} from '../../../core/types';
import type { LiveSessionStatus } from '../../../core/runner';
import type { PermissionRule } from '../../../core/source';
import type { WoPhase } from '../../../core/derive';
import type { ProviderErrorCode } from '../../../core/runner';

// Eski 3-sütunlu tahta (BoardColumn) — uyumluluk için kalır; yeni tahta BUCKET_* kullanır.
// Yeni iki kovalı tahta (WO-0013).
export const BUCKET_LABELS: Record<BoardBucket, string> = {
  up: 'Sıra sende',
  working: 'Çalışıyor',
  closed: 'Kapalı',
};

export const ROLE_LABELS: Record<SessionRole, string> = {
  implementer: 'Uygulayıcı',
  architect: 'Mimar',
  verifier: 'Doğrulayıcı',
};

// WO-0038 rol seçici — tek satırlık görev tanımı (menuitemradio alt satırı).
export const ROLE_DUTY_LABELS: Record<SessionRole, string> = {
  architect: 'planlar · adımları denetler',
  implementer: 'uygular · kodu yazar, koşturur',
  verifier: 'doğrular · bağımsız rapor verir',
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
  merge_track: 'Depoyu birleştir',
// D3 (tur-2): merge is not a UI action today. When the command becomes real it belongs in the
// RAIL. WO-0033 already applied the ADR-0012 r4 de-jargon the old wording deferred.
  request_verification: 'Doğrulama iste',
  audit: 'Denetim çalıştır',
  update_docs: 'Belgeleri güncelle',
  close: 'İş emrini kapat',
};

export const ABSENT_REASON_LABELS: Record<AbsentReason, string> = {
  awaiting_plan_commit: 'Plan onayı bekleniyor', // M2 wording (WO-0027/Bulgu 11): approval is the act; the commit-as-evidence link is M3
  docs_not_updated: 'ROADMAP ve tech-debt henüz güncellenmedi',
  depends_on_open: 'Bağımlı depo merge olmadı',
  verifier_report_missing: 'Henüz doğrulayıcı raporu yok',
  step_not_resolved: 'Bir adımda revize kararı açık — Devam et ya da yeniden çalıştır',
  pointers_unresolved: 'Kanıt işaretçileri head sha’da çözülmüyor',
};

export function cardReasonText(r: CardReason): string {
  switch (r.kind) {
    case 'closed':
      return UI.woPhaseDone; // closed is terminal — never "Sonraki oturum bekleniyor" (PR #37 tour)
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
    case 'session_stopped':
      return 'Oturum durduruldu';
    case 'awaiting_plan_commit':
      // WO-0039: the board reads the SAME value as the detail's ActionCard — the "Plan commiti
      // bekleniyor" twin is dead (one state, one sentence; "commit" never reaches the operator).
      return ABSENT_REASON_LABELS.awaiting_plan_commit;
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
  // WO-0031e tur-3: the closure-stage card names its state — Kapatılabilir (canClose holds; the
  // detail's Kapat card is live). ACTION_LABELS.update_docs stays for the rail's ActionCard.
  return { permission: 'İzin ver', plan: 'Planı onayla', closure: 'Kapatılabilir' }[a.kind];
}

// AC1 (return-pass): track aşaması, oturum durumu, mod ve kaynak türü için görüntü eşlemeleri +
// bunları tümceye çeviren besteciler. Bunlarla hiçbir bileşen bir kod tanımlayıcıyı `.replace` ile
// arayüz metnine çevirmez; bir çevirmenin dokunacağı her kelime burada.
// Plan adımları (WO-0017). Durum etiketi + işaretçi (mock'taki ✓/►/○/⊘ — işaretçiler marks.ts'te).
export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Bekliyor',
  active: 'Çalışıyor',
  done: 'Tamam',
  blocked: 'Engelli',
};

// WO-0008: canlı oturum durumu (runner olay katlaması), yukarıdaki fixture SessionRef durumundan
// farklı. Ham tanımlayıcı gösterilmez (ADR-0007) — araç adları TOOL_LABELS üzerinden eşlenir.
export const LIVE_STATUS_LABELS: Record<LiveSessionStatus, string> = {
  idle: 'Boşta',
  running: 'Çalışıyor',
  stopped_asking: 'Seni bekliyor',
  plan_ready: 'Plan hazır',
  done: 'Bitti',
  stopped: 'Durduruldu',
  error: 'Hata',
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
  // 2026-08-23 (canlı panel revizyonu, §5): an unknown tool's row carries a NAME-honest label —
  // "Araç kullan" said nothing; the raw tool name rides the detail slot as DATA.
  return TOOL_LABELS[tool] ?? 'Araç çağrısı';
}

// 2026-08-23 (§3): the SADE activity line renders a STATE, not content — per-tool progressive
// verbs (Turkish harmony is regular but not derivable: Ara → Arıyor is suppletive). The fallback
// matches toolLabel's "Araç çağrısı" in spirit.
export const TOOL_VERBS: Record<string, string> = {
  Write: 'Dosya yazıyor',
  Edit: 'Dosya düzenliyor',
  MultiEdit: 'Dosyaları düzenliyor',
  NotebookEdit: 'Notebook düzenliyor',
  NotebookEditNew: 'Notebook düzenliyor',
  Bash: 'Komut çalıştırıyor',
  Read: 'Dosya okuyor',
  Grep: 'Arıyor', // Ara → Arıyor (suppletive; not derivable from the label)
  Glob: 'Dosya buluyor',
  Task: 'Devrediyor',
  WebFetch: 'Sayfa getiriyor',
  WebSearch: "Web'de arıyor",
  ExitPlanMode: 'Planı bitiriyor',
};

export function toolVerb(tool: string): string {
  return TOOL_VERBS[tool] ?? 'Araç çalıştırıyor';
}

/** One transcript line as PLAIN text (the fail card's detail + clipboard, WO-0031c; xterm's ANSI
 *  twin died with it in WO-0037 — the chat renders structured rows, this is the flat projection). */
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

/** The SADE tail's one-line projection (WO-0037): an assistant turn collapses to its first
 *  non-empty line (the bubble body is markdown; the tail is a teaser), everything else is the flat
 *  transcript line. `split`, never `.replace(` — the CI ban holds here too. */
export function transcriptTailText(line: TranscriptLine): string {
  if (line.speaker === 'assistant') {
    const first = line.text.split('\n').find((l) => l.trim().length > 0);
    return first ?? '';
  }
  return transcriptLineText(line);
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

export function modeText(mode: 'plan' | 'direct'): string {
  return `${MODE_LABELS[mode]} modu`;
}

export function stoppedAtGate(gate: string): string {
  return `durdu · ${gate}`;
}

// tr-TR ondalık ayraç (virgül) — mock'taki "$0,94" ile uyumlu. en.ts 'en-US' ister (nokta).
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
  plan_save_refused: 'Bozuk plan önerisi reddedildi',
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
    case 'plan_saved':
      // "Bitti = kaydet" (2026-08-23): the operator's editor save rides the same event kind the
      // architect's proposal does — the detail says WHO proposed.
      if (detail === 'operator-edit') return 'operatör düzenlemesi';
      if (detail === 'restored-original') return 'ajanın ilk önerisine dönüldü';
      return detail;
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
// WO-0035: as const BİLİNÇLİ olarak yok — literal özellik tipleri en.ts'i atanamaz yapardı; Labels
// bu objeden türer (string + doğal fonksiyon imzaları).
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
  // Workspace management (WO-0014). WO-0033: the vocabulary pass — repo → depo, workspace →
  // çalışma alanı; the section becomes the Defter (two-line rows: ad + tam mono yol).
  wsSettings: 'Çalışma alanı ayarları',
  wsCreate: 'Yeni çalışma alanı',
  wsNameLabel: 'Ad',
  wsReposLabel: 'Depo bağlantıları',
  wsRepoAddManual: 'Ekle',
  wsRepoPick: 'Klasör',
  wsRepoPlaceholder: 'yerel depo yolu',
  wsDecisionStore: 'Karar deposu',
  wsErrName: 'Ad gerekli.',
  wsErrRepo: 'En az bir geçerli depo yolu ekle (örn. /Users/.../proje).',
  // WO-0033 — Defter satır dili: satır eylemleri, bekçi tooltip'leri, alan-altı hata satırları.
  wsRepoEditAria: 'Depo yolunu düzenle',
  wsRepoRemoveAria: 'Depoyu kaldır',
  wsRepoAdd: 'Depo ekle',
  wsDsMarker: 'karar deposu',
  wsDsMake: 'Karar deposu yap',
  wsNoRepos: 'Henüz depo yok.',
  wsErrPathInvalid: 'Tam yol değil — / ile başlamalı.',
  // Ad = RepoId = kimlik (ADR-0003'in basename kuralı): track'ler bu adla referans verir. Mesaj
  // kuralı değil ÇAREYİ söyler — operator incelemesi (2026-08-21, tur 2).
  wsErrPathName: 'Ad değişemez — ad, depo kimliğidir. Başka depo istiyorsan silip yeniden ekle.',
  wsErrRepoDup: 'Bu adda depo zaten var.',
  // Kaldırma bekçileri (ADR-0001 2026-08-21 addendum: eylem yerinde, soluk; sebep hover tooltip'te —
  // copy engeli DEĞİL çözümü adlar). Teyitsiz kaldırma — yeniden eklemek bir yol yazmaktır.
  wsGuardDs: 'Karar deposu — seçimi başka depoya taşıyınca kaldırılabilir',
  wsGuardOpenWo: (wo: string) => `${wo} kullanıyor — iş kapanınca kaldırılabilir`,
  wsGuardLast: 'Son kalan depo — çalışma alanı bir depoya ihtiyaç duyar',
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
  woDescLabel: 'Açıklama / hedef (isteğe bağlı)', // WO-0036: minority marker — the one optional free-text field
  woDescPlaceholder: 'Bu iş emri neyi başarmalı? İlk prompt olarak mimar oturumuna gider.',
  woTracksLabel: 'Depolar',
  woContextLabel: 'Bağlam dosyaları',
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
  // Onboarding / davet (WO-0016 → WO-0031d: boş durum = 1 satır + 1 eylem). WO-0032: satır düğmenin
  // ne oluşturacağını adlar — sıfır-workspace yüzeyi workspace davet eder, iş-emri satırı iş-emri tahtasına.
  inviteFirstWs: 'Haydi ilk çalışma alanını oluşturalım',
  inviteFirstWo: 'Haydi ilk iş emrini açalım',
  // Plan adımları (WO-0017). WO-0031f: stepsHeader/stepReportTitle died with the spine restructure —
  // the spine carries no "Plan" header (the Akış count does) and the report header is reportTitle(idx).
  stepsUnit: 'adım',
  stepReportMissing: '(rapor henüz yok)',
  stepScopeAll: 'hepsi',
  stepBlockedHint: 'kapsam bir depoyla eşleşmiyor',
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
  woPhasePlanStopped: 'Plan önerisi durduruldu',
  woPhasePlanReady: 'Plan hazır — onayla',
  woPhaseImplementing: 'Uygulama',
  woPhaseClosing: 'Kapanış — belgeleri güncelle',
  woPhaseDone: 'Tamamlandı',
  // ===== Kontrol Konsolu v2 (WO-0031c / v4 mockup) =====
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
  // WO-0031e tur-3: the awaiting-close platform — no live work left, only closable + closed.
  boardAwaitingClose: (n: number): string => `${n} iş kapatılmayı bekliyor`,
  boardCloseCta: 'Kapanışa git',
  // Tur-2 A3: the short closure sha (full sha in title/aria; click copies).
  closeShaAria: 'Kapanış kaydı — kopyala',
  copyDone: 'Kopyalandı',
  codeCopyAria: 'Kodu kopyala', // WO-0037 — CodeBlock's header button; confirmation rides copyDone
  // Strip (başlık şeridi) ölçümleri + düzenleme katmanı.
  // WO-0031f review (operator): stripCost died — the price speaks for itself ("$9,50", no prefix);
  // the LEDGER's column header (auditColCost) stays, it names a column.
  stripDuration: 'Süre',
  objectTitle: 'İtirazın ne?',
  dialogCloseAria: 'kapat',
  removeAria: 'kaldır',
  // WO-0037 — the strip gate joined the guarded idiom (ADR-0001 2026-08-22 addendum): while a drive
  // spends (and on a closed WO) the pencil/trash render in place, dimmed, handler-less, pointer
  // events KEPT so the tooltip opens; the tooltip names the unblocking move. The standing "önce
  // oturumu durdur" line died — the substrip already says Çalışıyor (the cause is on screen).
  stripGateTooltip: 'Oturum çalışırken düzen kapalı — Durdur ile bitirince açılır.',
  stripDeleteGateTooltip: 'Oturum çalışırken silinmez — Durdur ile bitirince açılır.',
  // TD-038.4 — the Sil dialog's error line (a failed delete deletes nothing; the dialog stays open).
  deleteWoFailed: 'Silinemedi — depo yazma hatası.',
  // WO-0031f v6 — the two DETAY surfaces. Akış is the body itself (decision cards + the step spine);
  // Kayıt is one drawer (kanıt chips + belgeler + döküm). The counts ride the tab (S1-C shrunk).
  secFlow: 'Akış',
  secRecord: 'Kayıt',
  // WO-0031f v6 §01 — the spine's row metas + the report under its own row.
  reportTitle: (idx: number): string => `Rapor · Adım ${idx}`,
  repOpen: '▸ rapor',
  repClose: '▾ rapor',
  stepQueued: 'sırada',
  stepRunningShort: 'çalışıyor',
  stepLiveMeta: (duration: string, cost: string): string => `çalışıyor · ⏱ ${duration} · ${cost}`,
  // F7 — a running session that wrote nothing yet says so (a blank terminal answers nothing); the
  // line leaves with the first transcript entry. The no-session case stays 'Çalışan oturum yok.'.
  streamOpened: 'Oturum açıldı — çıktı bekleniyor',
  // WO-0037/0038 — the chat transcript (the session surfaces' terminal; xterm retired).
  // One reading column: assistant turns are markdown bubbles, tool calls compact rows, results
  // indented lines. The aria names the log; the jump chip restores the bottom; the head line caps
  // at the last 800 entries.
  chatAria: 'Oturum akışı',
  chatJumpLatest: 'En alta git',
  chatOlderLines: (n: number) => `… önceki ${n} satır`,
  // WO-0037 Ray turu (operatör, 2026-08-22): araç çağrıları blok + aç/kapa — komut çıktısının
  // paragraf gibi akması bitti; geçmiş kapalı (yoğunluk), canlı kenar açık, arşiv de kapalı başlar.
  toolOutputAria: 'Komut çıktısı — aç/kapat',
  // WO-0031f review → WO-0039: the plan-stage invitation line died with the empty-state card
  // ("Henüz plan yok." + Plan iste owns the bare plan stage now).
  // TD-037 — the named load lines replace the bare 'Yükleniyor…' (no skeletons, one line + a run
  // dot). loadWorkOrders is the one string no mockup drew (the board reads work orders, not
  // documents) — shown to the operator at PR review.
  loadWorkOrders: 'İş emirleri okunuyor…',
  loadSteps: 'Adımlar okunuyor…',
  loadReport: 'Rapor okunuyor…',
  // WO-0031f T1 — the closed-list toggle, ONE pattern on all three board surfaces ('▸ 3 kapalı iş';
  // the count is data, the word is copy — >5 closed starts collapsed).
  closedToggleWord: 'kapalı iş',
  objectLinePlaceholder: 'Bir cümle yaz — mimar planı düzeltir…',
  // WO-0039 — ray öldü: kararlar plan bölümünün karar bandına (planApprove*), süreç denetimi canlı
  // panelin başlığına (drive*), ipuçları hedef kartlarına (askHint/closeHint) indi. Çalışırken mesaj
  // yok kuralı aynen — panel yalnız Durdur taşır; mesajlar bilgi taşır (maliyet işlemez gibi).
  planApprove: 'Onayla',
  // (planApproveHint 'Onayla — adımlar sırayla koşar.' + planApproveHintEdited died on the
  // 2026-08-23 fourth operator pass: no standing consequence lines beside decisions — the gate
  // reason (an empty aim) is the only line the row carries; the staged count lives in the record.)
  closeHint: 'Arşive gider — istersen not bırakabilirsin.',
  askHint: 'Oturum durdu — maliyet işlemez.',
  driveResume: '▶ Sürdür',
  driveStopping: 'Durduruluyor…',
  driveRetry: 'Yeniden dene',
  // Plan onayı: kart yüzü ("Mimar N adım önerdi").
  // DETAY bölüm yüzeyleri — WO-0031f v6: altı sekme öldü, iki yüzey var (Akış | Kayıt); Kayıt'ın
  // kendi bölümleri (Kanıt/Belgeler/Kaynaklar) raf başlığı olarak aynı dili kullanır. secTerminal/
  // secSteps/secTimeline died with the restructure (the spine IS Akış; Çizelge died with Y-2).
  secDocs: 'Belgeler',
  // WO-0038: belgeler göster/gizle satırları — meta = bölüm sayısı (## başlığı). Görünen ad insan
  // kelimesi (İş emri / Plan); dosya adı sönük mono işaretçi olarak kalır (depoda yaşar, düzenlenir).
  docSections: (n: number) => `${n} bölüm`,
  docOrderLabel: 'İş emri',
  docPlanLabel: 'Plan',
  // WO-0038: oturum kartının özet satırı — özet = oturumun ESERİNİN manşeti (operator onayı
  // 2026-08-22): plan → fence sayımı, inceleme → verdict, adım/serbest → ajanın kapanış cümlesi.
  // Asla uydurulmaz; eser yoksa satır da yok. (LLM'e özet yazdırma = B yolu, yalnız gerekirse.)
  sessionSummary: 'Özet',
  sessionSummaryPlan: (n: number) => `${n} adımlık plan önerdi`,
  sessionSummaryProceed: 'Mimar: proceed — adım onaylandı',
  sessionSummaryRevise: 'Mimar: revise — yeniden çalışma istendi',
  secSources: 'Kaynaklar',
  secTracks: 'Depolar',
  // Terminal notları (TranscriptNoteKind → görüntü; core'a noteFor olarak enjekte edilir).
  noteFor: (
    kind: 'interrupt_sent' | 'session_closed' | 'force_killed' | 'interrupted' | 'session_started' | 'session_done',
    detail?: string,
  ) => {
    const base = {
      interrupt_sent: '⏸ kesme sinyali gönderildi',
      session_closed: '■ oturum kapandı',
      force_killed: '■ zorla kesildi',
      interrupted: '⏸ oturum durduruldu',
      session_started: '● oturum açıldı',
      session_done: '■ oturum bitti',
    }[kind];
    // The FOLD's lifecycle notes carry an ISO stamp — the locale's clock renders it ("hangi saniye",
    // 2026-08-24). The UI-composed notes pass display-ready detail through untouched.
    if ((kind === 'session_started' || kind === 'session_done' || kind === 'interrupted') && detail) {
      return `${base} — ${UI.auditClock(detail)}`;
    }
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
  // Plan düzenleme (onay öncesi).
  editPlan: 'Düzenle',
  editPlanDone: 'Bitti',
  // 2026-08-23 ("ilk öneriye dön" — replaces the in-session Sıfırla): restore the AGENT's
  // originally proposed steps; confirm-gated (the operator's saved edits die with it).
  editPlanRestore: 'Önerine dön',
  restoreTitle: 'Önerine dön',
  restoreBody: 'Ajanın önerdiği adımlara dönülür — düzenlemelerin ve kaydettiklerin silinir.',
  restoreConfirm: 'Evet, dön',
  editAddStep: '+ Adım ekle',
  editNewStepAim: 'Yeni adım — yaz…',
  editAimMissing: (idx: number) => `Bir adımın metni boş (${idx}. satır) — doldurunca Onayla açılır.`,
  // 2026-08-23 drag-and-drop: the ▲▼ aria pair died; the grip + dnd-kit's announcements/instructions
  // are bundle copy (ADR-0007 — the library's English defaults never render).
  editDragHandleAria: 'Adımı sürükle',
  dragSrInstructions: 'Bir adımı taşımak için tutamağa odaklan, Space ile kaldır, ok tuşlarıyla yeni yerine getir, Space ile bırak.',
  dragAnnounceStart: (idx: number) => `${idx}. adım kaldırıldı.`,
  dragAnnounceOver: (idx: number) => `${idx}. adım üzerine gelindi.`,
  dragAnnounceEnd: (idx: number) => `${idx}. adım bırakıldı.`,
  dragAnnounceCancel: (idx: number) => `${idx}. adım taşımı iptal edildi.`,
  editRemoveAria: 'Adımı sil',
  editRoleAria: (role: SessionRole) => `Rol seç · şu an: ${ROLE_LABELS[role]}`,
  editRoleMenuAria: 'Rol seç',
  stepRef: (idx: number) => `adım ${idx}`,
  stepSegments: (idx: number, total: number) => `adım ${idx}/${total}`,
  // Denetim (oturum dökümü tablosu).
  auditTitle: 'Oturum dökümü',
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
  // WO-0031e tur-3 — the per-row transcript show/hide (the diffPeek ▸/▾ idiom; "döküm" echoes
  // auditTitle). Rendered only when the session HAS a transcript — absent, never disabled.
  auditShowTranscript: '▸ döküm',
  auditHideTranscript: '▾ döküm',
  // 2026-08-23 (döküm kaybı): the pre-checkpoint rows' honest line — the card opens, the record
  // itself never existed. New sessions checkpoint every tool result and are never empty.
  auditNoTranscript: 'Döküm kaydı yok.',
  stepCostMeta: (duration: string, cost: string) => `tamam · ⏱ ${duration} · ${cost}`,
  // Diff peek (yazma izni kartı).
  diffPeek: '▸ fark',
  diffPeekHide: '▾ fark',
  diffTruncated: (n: number) => `… ${n} satır`,
  diffEmpty: 'Değişiklik yok',
  // Durum: wind-down, force-kill, hata kartı.
  driveForceKill: 'Zorla kes',
  driveStoppedMsg: 'Durduruldu. Rapor kısmi kalır.',
  // WO-0039 — panel durduruldu sözcüğü, çip tooltip'leri. (planEmptyLine 'Henüz plan yok.' died on
  // the 2026-08-23 operator pass: the bare plan stage is ONLY the Plan iste button — the header
  // band's phase line already states it.)
  // 2026-08-23 (canlı panel revizyonu): the SADE state line + the verb toggle + the orphan row.
  actThinking: 'Düşünüyor',
  planClosing: 'Plan hazır — oturum kapanıyor',
  transcriptOpen: 'Dökümü aç',
  transcriptClose: 'Dökümü kapat',
  // 2026-08-23 (düzeltme): the SDK ends a plan-mode turn with a synthetic 'User has approved
  // your plan…' pseudo-result — that is the HARNESS accepting the agent's submission, NOT the
  // operator's Docket approval (which records its own plan_approved event). The line speaks
  // PROPOSAL language, like the card's 'N adımlık plan önerdi'.
  planApprovedNote: 'Mimar planını sundu',
  planRejectedNote: 'Mimarın planı geri çevrildi',
  liveSessionGo: 'Canlı oturum',
  toolNoResult: '→ sonuç yok',
  orphanResult: 'sonuç — eşleşen çağrı yok',
  reviewModeGatesHint: 'Adımlar kendi koşar — mimar sana üç kapıda döner: plan onayı, revize kararı, kapanış. Tıkla: Her adımda',
  reviewModeEveryHint: 'Her adımın sonunda mimarın rapor kararı sana gelir — onaylayınca sıradaki koşar. Tıkla: Kapılarda',
  // Rol görev tooltip'i — besteci, yeni söz yok: rozetin hover'ı görev satırını açığa çıkarır.
  roleDutyTip: (role: SessionRole) => `${ROLE_LABELS[role]} — ${ROLE_DUTY_LABELS[role]}`,
  failTitle: 'Oturum çöktü',
  // WO-0035 — akış kopması (kod/ham mesaj taşımayan tek hata yolu; drive-store'daki dizgi silindi,
  // durum yapısal: status==='error' && lastErrorCode yok && lastError yok → bu satır).
  driveStreamCrashed: 'Akış koptu — kayıt korundu.',
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
  // Çalışma alanı silme (WO-0032) — tam cascade: tanım + bağlantılar + iş emirleri + tüm kayıtlar +
  // Docket'ın yazdığı docs/work-orders dizinleri. Sayılı sonuç satırı diyalogun güvenlik mekanizmasıdır.
  wsDelete: 'Çalışma alanını sil',
  wsDeleteHint: (n: number) => n > 0
    ? `Bu çalışma alanı ve ${n} iş emri kalıcı olarak silinir — order.md, plan.md, raporlar ve tüm oturum kayıtları kaldırılır. Geri alınamaz.`
    : 'Bu çalışma alanı kalıcı olarak silinir. Geri alınamaz.',
  wsDeleteConfirm: 'Evet, sil',
  wsDeleteFailed: 'Silinemedi — önce oturumu durdur.',
  wsDeleteGateReason: 'önce oturumu durdur',
};

// WO-level faz etiketi — derivePhase çıktısını görüntü dizgesine çevirir (WO-0021). Faz birincil yüzey;
// 9-aşama rayı ikincil ("Akışı göster" arkasında).
export function phaseLabelText(p: WoPhase): string {
  switch (p.kind) {
    case 'just_written':
      return UI.woPhaseJustWritten;
    case 'planning':
      return UI.woPhasePlanning;
    case 'plan_stopped':
      return UI.woPhasePlanStopped;
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

// Türkçe demet (WO-0035): bu modülün tüm görüntü üyeleri tek objede. Labels TÜRÜ bu demetten türer;
// en.ts onu sağlamak zorunda — eksik anahtar derleme hatası. Yeni bir görüntü üyesi eklendiğinde
// hem buraya hem en.ts'e girer (derleyici hatırlatır).
const tr = {
  UI,
  BUCKET_LABELS,
  ROLE_LABELS,
  ROLE_DUTY_LABELS,
  STAGE_LABELS,
  EVIDENCE_LABELS,
  ACTION_LABELS,
  ABSENT_REASON_LABELS,
  CARD_ACTION_AREA,
  STEP_STATUS_LABELS,
  LIVE_STATUS_LABELS,
  TOOL_LABELS,
  TOOL_VERBS,
  MODE_LABELS,
  SOURCE_KIND_LABELS,
  PROVIDER_ERROR_LABELS,
  WO_EVENT_LABELS,
  PERMISSION_RULE_LABELS,
  PERMISSION_RULE_SHORT,
  PERMISSION_RULE_TINY,
  cardReasonText,
  cardActionText,
  toolLabel,
  toolVerb,
  transcriptLineText,
  transcriptTailText,
  permissionPrompt,
  modeText,
  stoppedAtGate,
  formatUsd,
  formatTokens,
  formatCost,
  woIdLabel,
  eventDetailText,
  formatDateTime,
  askingRole,
  phaseLabelText,
};
export type Labels = typeof tr;
export default tr;
