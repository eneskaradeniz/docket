// src/ui/data/labels/tr.ts — the TURKISH bundle (WO-0035). Tüm sabit arayüz metni burada (AC1:
// bileşenlerde gömlü metin yok); en.ts bu dosyadan türeyen Labels tipini sağlamak zorunda — eksik
// anahtar derleme hatasıdır (ADR-0007'in "eksik anahtar için en fallback" maddesi tip sistemiyle
// karşılanır). Domain enum'ları görüntü dizgelerine eşlenir; dinamik parçalar (kontrol adı, kapı)
// veriden gelir. Yerel-arayüzden bağımsız glifler (✓ ► ⊘) marks.ts'tedir.
// ADR-0007: arayüz dili Türkçe'dir (WO-0013); en/tr seçici WO-0035 ile geldi.
import type {
  AbsentReason,
  ActionIntent,
  AgentTaskStatus,
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
import type { FazStatus } from '../../../core/roadmap';
import type { RoadmapDiagnosticCode } from '../../../core/roadmap-md';

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
  close: 'İş emrini kapat',
};

export const ABSENT_REASON_LABELS: Record<AbsentReason, string> = {
  awaiting_plan_commit: 'Plan onayı bekleniyor', // M2 wording (WO-0027/Bulgu 11): approval is the act; the commit-as-evidence link is M3
  docs_not_updated: 'ROADMAP ve tech-debt henüz güncellenmedi',
  depends_on_open: 'Bağımlı depo merge olmadı',
  verifier_report_missing: 'Henüz doğrulayıcı raporu yok',
  step_not_resolved: 'Bir adımda revize kararı açık — Devam et ya da yeniden çalıştır',
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
    case 'limit_stopped':
      // WO-0053: pano kartının satırı — neden + saat, saat-sız (çekirdek türetmesi Date bilmez).
      return `Kullanım limiti doldu — sıfırlanma ${UI.limitClock(r.resetAt)}`;
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
  // detail's Kapat card is live).
  return { permission: 'İzin ver', plan: 'Planı onayla', closure: 'Kapatılabilir' }[a.kind];
}

// AC1 (return-pass): track aşaması, oturum durumu, mod ve kaynak türü için görüntü eşlemeleri +
// bunları tümceye çeviren besteciler. Bunlarla hiçbir bileşen bir kod tanımlayıcıyı `.replace` ile
// arayüz metnine çevirmez; bir çevirmenin dokunacağı her kelime burada.
// Plan adımları (WO-0017). Durum etiketi + işaretçi (mock'taki ✓/►/○/⊘ — işaretçiler marks.ts'te).
export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Bekliyor',
  // WO-0044 tur 2 (operator's word): "Aktif" — unlike "Çalışıyor" it stays TRUE for an interrupted
  // step; the live "what is it doing" answer lives in the instrument's activity verb.
  active: 'Aktif',
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

// WO-0055: bir ajan task'ının kapanış durumu (AgentTaskStatus → görüntü). Durum bildirilmemişse
// satır durumsuz okunur — asla uydurulmaz (absent-not-zero).
export const AGENT_TASK_STATUS_LABELS: Record<AgentTaskStatus, string> = {
  completed: 'bitti',
  failed: 'başarısız',
  stopped: 'kesildi',
};
// WO-0055 rev 2: blok başlığındaki koşan-durum kelimesi (canlıysa noktalarla: koşuyor···).
export const AGENT_TASK_RUNNING_WORD = 'koşuyor';


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
  Agent: 'Devret', // WO-0055 (probe t1): the delegation tool's on-the-wire name in this SDK vintage
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
  Agent: 'Devrediyor', // WO-0055: the wire name's twin (probe t1)
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
    case 'operator':
      return `${UI.operatorSpeaker}: ${line.text}`;
    case 'agent_task': // WO-0055: the agent task's flat projection (label + content words)
      if (line.phase === 'started') {
        return line.description ? `${UI.agentTaskLabel} — ${line.description}` : UI.agentTaskLabel;
      }
      {
        const head = line.status ? `${UI.agentTaskLabel} ${AGENT_TASK_STATUS_LABELS[line.status]}` : UI.agentTaskLabel;
        return line.summary ? `${head} — ${line.summary}` : head;
      }
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

// WO-0047: uyarı/limit satırının cümle seçicisi — durum × bilinen-harcama tek çağrıda (kart + bant
// aynı cümleyi konuşur). 'ok' durumunda satır hiç çizilmez; çağıran koşulu zaten elinde tutar.
export function budgetLine(status: 'warn' | 'hard_stop', hasUnknown: boolean, monthUsd: number, capUsd: number): string {
  if (status === 'hard_stop') return hasUnknown ? UI.budgetStopLineKnown(monthUsd, capUsd) : UI.budgetStopLine(monthUsd, capUsd);
  return hasUnknown ? UI.budgetWarnLineKnown(monthUsd, capUsd) : UI.budgetWarnLine(monthUsd, capUsd);
}

// Token sayısı kısaltması: 10k+ tam k, 1k+ bir ondalık, altı ham sayı (WO-0022).
export function formatTokens(n: number): string {
  // WO-0046: a max-context of 1 000 000 rendered "1000k" on the live readout — the M tier exists
  // for exactly that ceiling (and stays consistent with formatCost's in→out use of this helper).
  if (n >= 1000000) return `${+(n / 1000000).toFixed(1)}M`;
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
  rate_limited: 'Sağlayıcı kullanım limiti doldu — sıfırlanma saati bilinmiyor.', // WO-0053: damgasız degradasyon katmanı (mockup kare 04)
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
  steer_queued: 'Yönlendirme kuyruğa girdi',
  steer_delivered: 'Yönlendirme iletildi',
  steer_retracted: 'Yönlendirme geri çekildi',
  flow_mode_changed: 'Akış modu değişti',
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
    case 'flow_mode_changed':
      // The machine carries the internal value ('manual'/'auto'); the timeline speaks the chip's word.
      return detail === 'manual' ? 'manuel' : 'otomatik';
    case 'steer_queued':
    case 'steer_delivered':
      // The detail is 'not: <the operator's own words, 48 chars>' — the prefix is machine grammar.
      return detail.startsWith('not: ') ? detail.slice(5) : detail;
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
  // Tema seçici (WO-0040 — Sistem OS'u izler, Açık/Karanlık sabitler).
  theme: 'Tema',
  themeSystem: 'Sistem',
  themeLight: 'Açık',
  themeDark: 'Karanlık',
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
  stepBlockedHint: 'kapsam bir depoyla eşleşmiyor',
  noSteps: 'Onaylı plan çalışan bir adım listesi içermiyor — mimardan yeniden plan iste.',
  // İş emri silme (WO-0020)
  deleteWo: 'Sil',
  deleteWoHint: 'Bu iş emri kalıcı olarak silinir — iş emri dokümanı, plan, raporlar ve tüm oturum kayıtları kaldırılır. Geri alınamaz.',
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
  // Sağlayıcı durumu (WO-0059 rev 4 — saklı anahtar öldü; tek satır: varlık + çalışma)
  providerStatusOk: 'Hazır',
  providerStatusMissing: 'Bulunamadı',
  providerVerify: 'Doğrula',
  providerVerifying: 'Doğrulanıyor',
  // Ayarlar menüsü (WO-0059 rev 4 — sol menü İKİ öğe; sentence case, tek satır ad)
  settingsTabGeneral: 'Genel',
  // Model tercihi (WO-0059 rev 4 — rol satırı + kademe segmenti; anlık yazar). Kademe adları
  // adapter verisidir (c1 — providerDisplayName/modelOptions üslubu); paket yalnız nötr kelimeyi taşır.
  modelSectionLabel: 'Modeller',
  modelDefaultTier: 'Default',
  modelMatrixAria: 'Rol başına model kademesi',
  modelTierLine: 'Kademe adları kurulumundaki modellere eşlenir.',
  modelDraftLine: (role: string): string => `✦ taslak sürüşü ${role} satırını izler.`,
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
  // Sıra durumu (deriveTurnState çıktısı) — the header band's turn line. Kısa metin kuralı (operatör): çalışan
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
  // oturumu durdur" line died — the header band already says Çalışıyor (the cause is on screen).
  stripGateTooltip: 'Oturum çalışırken düzen kapalı — Durdur ile bitirince açılır.',
  stripDeleteGateTooltip: 'Oturum çalışırken silinmez — Durdur ile bitirince açılır.',
  // TD-038.4 — the Sil dialog's error line (a failed delete deletes nothing; the dialog stays open).
  deleteWoFailed: 'Silinemedi — depo yazma hatası.',
  // WO-0031f v6 §01 — the spine's row metas + the report under its own row.
  reportTitle: (idx: number): string => `Rapor · Adım ${idx}`,
  repOpen: '▸ rapor',
  repClose: '▾ rapor',
  // stepQueued ('sırada') died with WO-0044 tur 2: the spine's meta opens with the row's state word
  // from STEP_STATUS_LABELS (Bekliyor) — one vocabulary, not two queue words.
  // stepRunningShort died with WO-0044: the driven row's meta carries its scope only — the state
  // word lives in the row's StepPane header (the activity verb), where it stays true when stopped.
  // F7 — a running session that wrote nothing yet says so (a blank terminal answers nothing); the
  // line leaves with the first transcript entry. The no-session case stays 'Çalışan oturum yok.'.
  // streamOpened died with WO-0044 tur 3: StreamLine (the empty-run second line) is dead — the
  // header's activity line is the honest state on every pane.
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
  // WO satır içi düzenleme + inceleme modu rozeti. WO-0044: "Kapılarda" kendi başına jargondu
  // (neyin kapıları?) — çip denetim cadence'ini ADIYLA söyler; öğreten cümle tooltip'te zaten.
  reviewModeLabel: 'İnceleme',
  reviewModeGatesShort: 'Denetim: kapıda',
  reviewModeEveryShort: 'Denetim: her adımda',
  // WO-0045 operatör tempo: Akış çipi (operatörün kendi terimi) + steer besteci/döküm sözcükleri.
  // "Akış: manuel + İzin: hep sor" eşleşmesi ürün cevabıdır — izin kuralı sözlüğünden kopmaz.
  flowModeLabel: 'Akış',
  flowModeAutoShort: 'Akış: otomatik',
  flowModeManualShort: 'Akış: manuel',
  flowModeAutoHint: 'Sıralama kendiliğinden ilerler — karar ve adımlar ardarda koşar.',
  flowModeManualHint: 'Hiçbir oturum kendiliğinden başlamaz — sıradaki adım ve denetim tıkla başlar.',
  flowPendingBadge: (n: number) => `+${n}`,
  steerPlaceholder: 'Sürüşe not bırak — bir sonraki sınırda uygulanır',
  steerSend: 'Gönder',
  steerPendingTitle: 'Sırada',
  steerRefused: 'Not kuyruğa girmedi — sürüş henüz hazır değil; birazdan dene.',
  steerRetract: 'Geri çek',
  operatorSpeaker: 'Operatör',
  manuelNextStepCard: (idx: number) => `sıradaki: Adım ${idx}`,
  manuelReviewCard: (idx: number) => `sıradaki: Denetim ${idx}`,
  manuelStartCard: 'Başlat',
  // WO-0046 canlı dürüstlük: bağlam doluluk okuması (maliyet satırının dili — metin, animasyonsuz;
  // operatör kararı 2026-08-26) + sessizlik satırı (3 dk eşiği — Düşünüyor···'ün dürüst halefi).
  contextReadout: (pct: number, used: number, max: number) => `bağlam %${pct} · ${formatTokens(used)}/${formatTokens(max)}`,
  staleLine: (n: number) => `${n} dk'dır yeni çıktı yok`,
  // WO-0055 canlı ajan görünürlüğü: etkinlik satırının koşan-ajan kolunun dili + döküm satırının
  // etiket sözcükleri. Tanımlayıcılar (taskId/callId/subagentType) veri olarak kalır — hiçbiri
  // görüntülenmez (ADR-0007); description/summary içeriktir (detay yuvası ruling'i).
  agentTaskLabel: 'Ajan',
  agentRunningLine: (n: number) => (n === 1 ? '1 ajan sürüyor' : `${n} ajan sürüyor`),
  orphanAgentEnd: 'ajan sonu — eşleşen görev yok',
  agentBlockAria: 'Ajan çıktısı — aç/kapat',
  // WO-0047 bütçe kapısı: warn/limit satıları (kart + bant — bilinen-harcama niteleyicisiyle,
  // dolgu çubuğu yok, ADR-0012), ret kartının iki seçeneği, ayarlar bölümü. Para formatUsd ile.
  budgetWarnLine: (m: number, cap: number) => `bu ay ${formatUsd(m)} / ${formatUsd(cap)} — uyarı eşiği aşıldı`,
  budgetWarnLineKnown: (m: number, cap: number) => `bu ay bilinen harcama ${formatUsd(m)} / ${formatUsd(cap)} — uyarı eşiği aşıldı`,
  budgetStopLine: (m: number, cap: number) => `bu ay ${formatUsd(m)} / ${formatUsd(cap)} — limit doldu, yeni sürüş reddedilir`,
  budgetStopLineKnown: (m: number, cap: number) => `bu ay bilinen harcama ${formatUsd(m)} / ${formatUsd(cap)} — limit doldu, yeni sürüş reddedilir`,
  budgetRefusalTitle: 'AYLIK LİMİT DOLDU',
  budgetRefusalBody: (observed: number, cap: number) => `Bu ay bilinen harcama ${formatUsd(observed)}; limit ${formatUsd(cap)}. Yeni sürüş başlatılamaz.`,
  budgetRefusalRunningNote: 'Koşan sürüş kesilmez; kapı bir sonraki sürüşe uygulanır.',
  budgetBasisNote: 'Hesap yalnızca bilinen harcamayı sayar — kesilen bacakların maliyeti kayıtlı değil.',
  budgetRaiseLabel: 'Yeni limit ($)',
  budgetRaiseAction: 'Limiti yükselt ve sür',
  budgetKeepAction: 'Kapı kalsın',
  budgetErrNumber: 'Geçerli bir tutar gir ($, ör. 20 veya 20,50).',
  budgetErrRaise: 'Yeni limit bu ayki harcamayı aşmalı.',
  budgetLabel: 'Aylık bütçe',
  budgetCapLabel: 'Limit ($)',
  budgetWarnPercentLabel: 'Uyarı eşiği (%)',
  budgetSave: 'Kaydet',
  budgetClear: 'Kaldır',
  budgetErrCap: 'Sıfırdan büyük bir tutar gir.',
  budgetErrWarn: '1–100 arası bir oran gir.',
  budgetMonthReadout: (m: number, cap: number) => `bu ay ${formatUsd(m)} / ${formatUsd(cap)}`,
  budgetMonthReadoutKnown: (m: number, cap: number) => `bu ay bilinen harcama ${formatUsd(m)} / ${formatUsd(cap)}`,
  // ===== WO-0053 — limit ekranı (mockup rev 1 `cf28681`; kararlar turda kilitlendi) =====
  // Kart bütçe kartının TEK EYLEMLİ kardeşi: aksiyon satırı ya bir düğme (Sürdür ⏎) ya bir neden
  // satırıdır (saat); kart sağlayıcı penceresini konuşur — $/kapı kelimesi bütçe kartının. Pencere
  // kimliği ham gösterilmez (ADR-0007 — limitWindowLabel eşlemesi, woIdLabel düzeni).
  limitClock: (iso: string) => {
    // Gün farkındalı saat: bugünse HH:MM, değilse gün kısaltması + HH:MM (7 günlük pencere yaşar).
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number): string => String(n).padStart(2, '0');
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    if (d.toDateString() === new Date().toDateString()) return hm;
    const DAYS = ['paz', 'pzt', 'sal', 'car', 'per', 'cum', 'cmt'];
    return `${DAYS[d.getDay()]} ${hm}`;
  },
  limitCardTitle: 'KULLANIM LİMİTİ DOLDU',
  limitCardBody: (window: string, time: string) => `${window} doldu — sıfırlanma ${time}.`,
  limitResumeNote: 'Sürdür kaldığı yerden devam eder; bağlam yeniden okunur.',
  limitWarnLine: (window: string, pct: number | null, time: string | null) =>
    `${window}${pct !== null ? ` %${pct}` : ''}${time !== null ? ` — ${time}'de sıfırlanır` : ' — sınır yakın'}`,
  limitWindowLabel: (kind: string): string => (kind === 'five_hour' ? '5 saatlik pencere' : kind === 'seven_day' ? '7 günlük pencere' : 'pencere'),
  // ===== WO-0060 — appbar sürüş/limit çipi (boşta yok · yeşil sayaç · amber uyarı · kırmızı geri sayım) =====
  // Çip PASİF gösterge: tıklama yok, iş-emri kimliği yok. appbarRunningCount, agentRunningLine
  // DEĞİLDİR — o alt-ajan (WO-0055), bu sürüş sayar; ikisi tek anahtarda birleşirse iki yönde de
  // yalan söyler. limitCountdown, formatDuration'dan AYRI anahtar kastıyla: o geçen-süre
  // kopyasını konuşur (Xs Ydk'ta tavan yapar), bu geri sayımı gün katmanıyla (beş saatlik pencere
  // «4s 12dk», yedi günlük «2g 3s» yaşar).
  appbarRunningCount: (n: number) => (n === 1 ? '1 sürüyor' : `${n} sürüyor`),
  limitCountdown: (ms: number) => {
    if (ms < 0) ms = 0; // ticker'ın çaprazlama yarışı — negatif kare bir kare yaşar, sonra çip söker
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}sn`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}dk`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h}s ${min % 60}dk`;
    const d = Math.floor(h / 24);
    return `${d}g ${h % 24}s`;
  },
  appbarLimitWarn: 'limit yaklaşıyor',
  appbarLimitAria: (time: string) => `Kullanım limiti doldu — ${time}'de sıfırlanır`,
  // ===== WO-0054 — kullanım ekranı (mockup rev 1; ay başlığı · canlı kota · döküm · liste) =====
  // Ay başlığı MEVCUT bütçe görünümünü konuşur (WO-0047'nin matematiği/kopyası — burada yeniden
  // türetilmez); kota paneli yalnız sağlayıcının kendi sinyalini okur (WO-0053 kuralı); model
  // kimliği satır VERİSİDİR (ADR-0006'nın WO-0052 muafiyeti). Bilinen-harcama notu SAYISIZ (mimar
  // düzeltmesi 2 — WorkspaceBudgetView yalnız hasUnknown taşır). usageRoleUnknown KAYIT sayar
  // (roleUnknownCount satır sayar — D2.3'ün harfi; mockup'ın «oturum» dili sayacın birimine yenildi),
  // usageUnledgeredLine kapsız kolda da doğru olanı söyler (hane referansı yok — mimar bulgusu 4).
  surfaceUsage: 'Kullanım',
  loadUsage: 'Kullanım kaydı okunuyor…',
  usageEmptyLine: 'Bu ay henüz kayıt yok.',
  usageEmptyNote: 'Bir sürüş başlayınca harcama burada birikir.',
  usageMonthTitle: 'BU AY',
  usageMonthMeta: (d: Date) =>
    `${new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(d)} · takvim ayı (UTC)`,
  usageMonthObserved: (usd: number) => `bu ay ${formatUsd(usd)}`,
  usageKnownBasisNote: 'bilinen harcama — bazı oturumların maliyeti hiç bildirilmedi; toplam onları içermez.',
  usageBasisDivergence: 'İki sayı farklı pencere sayar — üsttekiler ay içinde başlayan oturumlar, döküm ay içinde işlenen harcama.',
  usageLimitTitle: 'KOTA PENCERELERİ · CANLI',
  usageLimitMeta: (role: string, wo: string) => `${role} · ${wo} sürüşü koşuyor`,
  usageLimitDraftMeta: (role: string) => `${role} · ✦ taslak sürüşü`,
  usageLimitProviderNote: 'Sağlayıcının kendi bildirmesi; sinyal yoksa bu bölüm çizilmez.',
  usageLimitUtilization: (pct: number) => `%${pct}`,
  usageLimitResetLine: (time: string) => `${time}'de sıfırlanır`,
  usageBreakdownTitle: 'DÖKÜM',
  usageBreakdownMeta: 'gözlemlenen harcama · bu ay',
  usageRolesTitle: 'ROLLER',
  usageRoleSub: (n: number, tin: number, tout: number) => `${n} oturum · ${formatTokens(tin)}→${formatTokens(tout)}`,
  usageRoleValue: (usd: number, pct: number) => `${formatUsd(usd)} · %${pct}`,
  usageModelsTitle: 'MODELLER',
  usageModelUnknownLabel: 'bilinmeyen model',
  usageModelSub: (tin: number, tout: number) => `${formatTokens(tin)}→${formatTokens(tout)}`,
  usageModelSplitNote: 'Model dağılımı sağlayıcının kendi bildirmesi — satır toplamıyla tutmayabilir.',
  usageCacheTitle: 'CACHE KIRILIMI',
  usageCacheLine: (fresh: number, read: number, creation: number) =>
    `taze giriş ${formatTokens(fresh)} · cache okuma ${formatTokens(read)} · cache yazma ${formatTokens(creation)}`,
  usageTotalLabel: 'toplam',
  usageByWoTitle: 'İŞ EMİRLERİ',
  usageWoMeta: 'harcama azalan',
  usageWoValue: (usd: number, n: number) => `${formatUsd(usd)} · ${n} oturum`,
  usageDraftRowLabel: 'Yol haritası taslakları',
  usageDraftWhere: '✦ taslak',
  usageDraftNonAdditive: '✦ taslakların harcaması — Mimar kovasında da sayılır.',
  usageSessionsTitle: 'OTURUMLAR',
  usageSessionTurns: (n: number) => `${n} sonuç`,
  usageUnledgeredLine: (n: number) => `${n} oturumun ayrıntı kaydı yok — maliyetleri yalnız ay toplamına sayılır.`,
  usageRoleUnknown: (n: number) => `${n} oturumun rolü belirsiz.`,
  // ===== WO-0049 — yol haritası yüzeyi (mockup kare 01/02/03/06/07; 04/05 WO-0050'nin) =====
  // Appbar geçişi (kardeş ekran — pano ve detay dokunulmaz) + üç yüzey hâlinin satırları.
  // Davet yüzeyi eylemsizdir: ✦ Üret/İçe aktar WO-0050'nin; bilgi satırı dosyanın yerini söyler.
  surfaceBoard: 'Pano',
  surfaceRoadmap: 'Yol Haritası',
  roadmapReading: 'Yol haritası okunuyor…',
  roadmapInviteLine: 'Haydi ilk yol haritasını çizelim — iş emirleri ondan doğar.',
  roadmapInviteFile: (root: string) => `Dosya: ${root}/roadmap.md — istersen elle oluştur.`,
  roadmapInvalidLine: 'Yol haritası okunamadı — dosyayı elle düzelt:',
  // Baş üstü + faz kartı metaları — para formatUsd ile; bilinen-harcama niteleyicisi bütçenin dili.
  roadmapHeadMeta: (done: number, total: number, open: number, usd: number) =>
    `${done}/${total} faz tamam · ${open} açık iş emri · ${formatUsd(usd)}`,
  roadmapHeadMetaKnown: (done: number, total: number, open: number, usd: number) =>
    `${done}/${total} faz tamam · ${open} açık iş emri · bilinen ${formatUsd(usd)}`,
  roadmapFazMeta: (done: number, total: number, closedWo: number, closedUsd: number, openWo: number) => {
    let s = `${done}/${total} görev`;
    if (closedWo > 0) s += ` · ${closedWo} WO kapandı`;
    if (closedUsd > 0) s += ` · ${formatUsd(closedUsd)}`;
    if (openWo > 0) s += ` · ${openWo} açık iş emri`;
    return s;
  },
  // Bloke satırı (kare 01): dosyanın notes'u varsa birebir; yoksa bağımlılıklardan türetilir.
  roadmapBlokeWord: 'Bloke',
  roadmapBlokeFallback: (blockers: string) => `${blockers} tamamlanmadan başlanmaz`,
  roadmapStripLine: 'faz sırası · tıkla kaydır',
  roadmapDoneFold: (n: number) => `${n} tamamlanan faz`,
  roadmapDoneFoldMeta: (wo: number, usd: number) => `${wo} WO · ${formatUsd(usd)}`,
  roadmapTaskFill: (done: number, total: number) => `${done}/${total} görev`,
  // Görev satırı kuyrukları — kanıt satırları, durum sözcüğü değil (glif taşır durumu).
  roadmapTaskSpawn: 'İş emri aç',
  roadmapTaskClosedTail: (n: number) => `${n} WO kapandı`,
  roadmapTaskOpenMulti: (n: number) => `${n} açık WO`,
  roadmapNextTag: 'sıradaki',
  // Ekle diyalogları (Ekle-only: düzenleme/silme yok — dosya karar deposu, elle düzenlenir).
  roadmapFazAdd: '+ Faz ekle',
  roadmapFazAddTitle: 'Faz ekle',
  roadmapFazAimLabel: 'Amaç (isteğe bağlı)',
  roadmapFazDependsLabel: 'Bağımlılıklar',
  roadmapTaskAdd: '+ görev ekle',
  roadmapTaskAddTitle: 'Görev ekle',
  roadmapErrRepo: 'Bir depo seç.',
  // Spawn ön-dolgu bağlam satırı (kare 06, düzenlenemez) + detail çipi (kare 07) + bozulma satırı.
  roadmapSpawnContext: (faz: string, ord: number, title: string, repo?: string) =>
    repo !== undefined ? `${faz} · GÖREV ${ord} · ${title} · hedef: ${repo}` : `${faz} · GÖREV ${ord} · ${title}`,
  roadmapTaskChip: (faz: string, task: string) => `${faz} · ${task}`,
  roadmapTaskMissing: '(görev yol haritasında yok)',
  // Ayarlar: yapı kökü (docs_root:<wsId>) — taşınmaz uyarısı bilgi satırı olarak kalır.
  docsRootLabel: 'Yapı kökü',
  docsRootWarn: 'Dosyalar taşınmaz; iş emri numaralandırması yeni kökte baştan sayılır.',
  docsRootErr: 'Güvenli göreli yol gir (ör. docs ya da .docket).',
  // WO-0059 rev 4: kök + bütçe grubu genel ayarlardan ws Düzenle dialoguna taşındı — grup başlığı
  wsRootBudgetLabel: 'Yapı kökü ve bütçe',
  // ===== WO-0050 — ✦ taslak sürüşü (mockup kare 03/04/05) =====
  // Tek mekanizma (ADR-0016 karar 2): üretim de içe aktarma da aynı mimar taslak oturumu; ayrımı
  // yalnız kaynak belge listesi yapar — prompt'a YOL yazılır, içeriği ajan okur. Kart dilinde
  // ham markdown yok: parse önizleme + üç eylem. Eylem sözcükleri (İtiraz et/Düzenle/Onayla ⏎)
  // plan döngüsünün anahtarlarını izler ama kart başlıkları özgün.
  roadmapDraftAction: '✦ Üret / İçe aktar',
  // Kare 04 — diyalog: hedef notu zorunlu (hata alanın altında; geçerlilik submit'i kiltlemez),
  // belge yolları diyalogla ölür (kalıcı değil — mockup hükmü).
  roadmapDraftDialogTitle: 'Yol haritası taslağı',
  roadmapDraftNoteLabel: 'Hedef notu',
  roadmapDraftNotePlaceholder: 'Örn: mevcut faz dokümanlarından yol haritasını çıkar; bağımlılıkları koru…',
  roadmapDraftNoteErr: 'Hedef notu gerekli — taslak bundan üretilir.',
  roadmapDraftDocsLabel: 'Kaynak belgeler',
  roadmapDraftDocPick: '+ Belge ekle',
  roadmapDraftDocRemoveAria: (name: string) => `Belgeyi çıkar: ${name}`,
  roadmapDraftDocMore: (n: number) => `+${n} belge`,
  roadmapDraftStart: 'Taslağı başlat',
  roadmapDraftBusy: 'Bir sürüş zaten koşuyor — bitince dene.',
  // Kare 05 — canlı alet: pane-chrome grameri aynen, WO'suz kim satırı; baş meta taslak sürerken
  // sayıların yerine geçer (yüzeyden ayrılmak dürüst kalır: pane unmount, sürüş mağazada yaşar).
  roadmapDraftIdentity: 'MİMAR — TASLAK',
  roadmapDraftRunning: 'taslak sürüyor',
  roadmapDraftSourceLine: (n: number) => (n > 0 ? `kaynak: ${n} belge` : 'kaynak: hedef notu'),
  // Kare 05 — TASLAK karar kartı (plan onay kartının kardeşi). Bloke kuyruğu faz satırında
  // roadmapBlokeFallback'in sesiyle konuşur (yeniden kullanım).
  roadmapDraftCardHead: 'Taslak hazır — gözden geçir',
  roadmapDraftCardSummary: (faz: number, task: number, chain: number, root: string) =>
    `${faz} faz · ${task} görev${chain > 0 ? ` · ${chain} bağımlılık zinciri` : ''} — onaylanınca ${root}/roadmap.md olarak karar deposuna yazılır; commit operatörün.`,
  roadmapDraftFazMeta: (n: number, repos: string) => (repos ? `${n} görev · ${repos}` : `${n} görev`),
  roadmapDraftWhy: 'İş emirlerinden önce dosya onayınla canlanır — durumlar burada görünmez.',
  roadmapDraftInvalidLine: 'Taslak okunamadı — Onayla yok; Sürdür mimarı aynı oturumdan yeniden başlatır.',
  roadmapDraftCardHeadUnreadable: 'Taslak tamamlanamadı',
  roadmapDraftNoSessionLine: 'Devam edecek oturum yok — yeni ✦ taslağı bu satırın üzerine yazar.',
  roadmapDraftDiscardTitle: 'Taslak silinsin mi?',
  roadmapDraftDiscardBody: 'Bekleyen taslak satırı silinir — yol haritası dosyası ve oturum geçmişi kalır; sonraki ✦ sıfırdan başlar.',
  roadmapDraftDiscardFailed: (reason: string) => `Taslak silinemedi — ${reason}`,
  roadmapDraftSuperseded: 'Yeni öneri okunamadı — önceki geçerli taslak duruyor.',
  roadmapDraftApprove: 'Onayla',
  roadmapDraftApproveFailed: (why: string) => `Onaylanamadı — ${why}`,
  // İtiraz bestecisi: tek satır not — mimar aynı oturuma senin notunla döner (resume).
  roadmapDraftObjectPlaceholder: 'Notun — mimar aynı oturuma senin notunla döner',
  // Düzenle (yapılandırılmış sahne, operatör kararı 2026-08-27): başlık girişleri + blockedBy
  // çipleri + görev satırları; applyFazlarEdits çit dışı her baytı korur. Ekle eylemleri ve
  // İtiraz/Vazgeç/Bitti sözcükleri WO-0049/plan döngüsünün anahtarlarından.
  roadmapDraftEditFazTitle: 'Faz başlığı',
  roadmapDraftTaskPlaceholder: 'Görev başlığı…',
  roadmapDraftEditEmptyTitle: 'Bir fazın başlığı boş — doldurunca Bitti işler.',
  roadmapDraftEditRefused: (why: string) => `Kaydedilmedi — ${why}`,
  roadmapDraftFazRemoveAria: (title: string) => `Fazı sil: ${title}`,
  roadmapDraftTaskRemoveAria: (title: string) => `Görevi sil: ${title}`,
  // Arka plan erişimi (D13): taslak askılarındaki toast.
  roadmapDraftAskToast: 'MİMAR — TASLAK seni bekliyor',
  // ===== WO-0051 — ✦ belge kaynağı: kanal kompozisyonu (sözleşme rev 2 · SUNUM rev 3) =====
  // Kaynak kümesi kanalların birleşimi: depo taraması (varsayılan TÜMÜ dahil, istisna grup
  // düzeyinde dışlanır) ∪ elle eklenen belgeler ∪ serbest keşif (opt-in, default kapalı) + hedef
  // notu. Rev 3 (operatör turu 2026-08-28): tek blok · tek satır dili · ad önce — kanal kelimesi
  // ekranda en fazla bir kez; depo satırı kutusuz tek sayı; eklenen satır ADıyla konuşur.
  // Depo satırı — kutusuz irow; tek sayı (tümü dahil), istisnada çift.
  roadmapDraftStoreLine: (docsRoot: string, found: number, included: number) =>
    included === found ? `${docsRoot}/ · ${found} belge — tümü dahil` : `${docsRoot}/ · ${included} / ${found} belge`,
  roadmapDraftScanning: (docsRoot: string) => `${docsRoot}/ taranıyor…`,
  roadmapDraftNoDocs: (docsRoot: string) => `${docsRoot}/ içinde belge yok — taslak hedef notundan üretilir.`,
  // Grup satırları: ilk dizin düzeyi; gürültü tek dokunuşla düşer. Kök grubu da yalnız yol.
  roadmapDraftGroupLabel: (docsRoot: string, key: string) => (key === '' ? `${docsRoot}/` : `${docsRoot}/${key}/`),
  roadmapDraftGroupCount: (n: number) => `${n} belge`,
  roadmapDraftExclude: 'dışla',
  roadmapDraftExcludeAria: (name: string) => `Dışla: ${name}`,
  roadmapDraftInclude: '↩ geri al',
  roadmapDraftIncludeAria: (name: string) => `Geri al: ${name}`,
  roadmapDraftMoreAll: (n: number) => `+${n} belge — tümü dahil`,
  // Elle eklenen belgeler: kelime yalnız başlıkta bir kez; satırda etiket YOK (rev 3 karar 1).
  roadmapDraftPickedSubhead: (n: number) => `ek belgeler · ${n}`,
  // Serbest keşif çipi (opt-in): tek sonuç satırı bedeli söyler (token disiplini, kuyruk madde 2).
  roadmapDraftExploreChip: 'Serbest keşif',
  roadmapDraftExploreInfo: 'Mimar repoyu kendisi de gezer — token harcar; seçili belgeler yine kesin gider.',
  // Kaynak satırının kompozisyon hâli — canlı alette ve kartın döküm kimlik satırında aynı ses.
  roadmapDraftSourceCompose: (store: number, external: number, explore: boolean) =>
    store === 0 && external === 0
      ? 'kaynak: hedef notu'
      : `kaynak: ${store} belge${external > 0 ? ` · ${external} ek` : ''}${explore ? ' · keşif' : ''}`,
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
  // WO-0044 tur 2: the card's first line is the KİM — ROL readout (ADIM 1 — UYGULAYICI); the step's
  // aim rides its own line below the head — "kim" and "ne" stopped sharing one string.
  auditNameStep: (idx: number) => `Adım ${idx}`,
  auditNameReview: (idx: number) => `İnceleme ${idx}`,
  auditNameUnscoped: 'Bağımsız',
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
  // liveSessionGo ('Canlı oturum') died with WO-0044: the ledger's live pointer card died — the
  // ledger is pure history; the one live surface is the driven row's instrument (pane-chrome chip).
  toolNoResult: '→ sonuç yok',
  orphanResult: 'sonuç — eşleşen çağrı yok',
  // WO-0044: the CTA names the chip as it reads on screen (the retired words died with the rename).
  reviewModeGatesHint: 'Adımlar kendi koşar — mimar sana üç kapıda döner: plan onayı, revize kararı, kapanış. Tıkla: Denetim: her adımda',
  reviewModeEveryHint: 'Her adımın sonunda mimarın rapor kararı sana gelir — onaylayınca sıradaki koşar. Tıkla: Denetim: kapıda',
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
    ? `Bu çalışma alanı ve ${n} iş emri kalıcı olarak silinir — iş emri dokümanları, planlar, raporlar ve tüm oturum kayıtları kaldırılır. Geri alınamaz.`
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
      // WO-0044: the stage badge beside this line already says "Uygulama" — the phase line carries
      // only the count (the word said twice was the operator's first-dogfood complaint).
      return p.total > 0 ? `${p.done}/${p.total} ${UI.stepsUnit}` : UI.woPhaseImplementing;
    case 'reviewing':
      return `${UI.reviewHeader} · ${UI.stepsUnit} ${p.stepIdx}`;
    case 'closing':
      return UI.woPhaseClosing;
    case 'done':
      return UI.woPhaseDone;
  }
}

// WO-0049 — faz durum sözlüğü: TEK söz dağarcığı (görev durumları alt kümedir; StepStatus'un
// 'Bekliyor'undaki gibi ikinci bir kuyruk sözcüğü açılmaz). Durum türetilir, hiçbir yere yazılmaz.
export const FAZ_STATUS_LABELS: Record<FazStatus, string> = {
  planli: 'Planlı',
  kosuyor: 'Koşuyor',
  bekliyor: 'Bekliyor',
  tamam: 'Tamam',
};

// WO-0049 — faz kimliğinin görüntü hali (mono işaretçi): `f4` → `FAZ 4` (kimlikteki sayı aynen,
// sıra numarası değil); `^f\d+$` dışı kimlikler (elle yazılmış) büyük harfe çıkar.
export function fazLabel(id: string): string {
  const m = /^f(\d+)$/.exec(id);
  return m !== null ? `FAZ ${m[1]!}` : `FAZ ${id.toUpperCase()}`;
}

// WO-0049 — the fold's `f0 · f3` run: the roadmap's ids ride the woIdLabel pattern (ADR-0007's
// 2026-08-27 addendum — operator-authored references rendered as identities through the seam).
export function fazIdLabel(id: string): string {
  return id;
}

// WO-0049 — tanı adlı eller: invalid yüzeyin sebep satırları (roadmapDiagnostics'ın 11 kodu).
// Detail tanıdan gelir (kimlik/öğe no); ham kod asla görüntülenmez.
export const ROADMAP_DIAGNOSTIC_LABELS: Record<RoadmapDiagnosticCode, (detail: string) => string> = {
  no_fence: () => 'fazlar bloğu yok',
  bad_json: (detail) => `JSON bozuk — ${detail}`,
  bad_element: (detail) => `bozuk öğe — ${detail}`,
  duplicate_id: (detail) => `yinelenen kimlik: ${detail}`,
  bad_id_shape: (detail) => `geçersiz kimlik biçimi: ${detail}`,
  empty_title: (detail) => `boş başlık: ${detail}`,
  unknown_blocked_by: (detail) => `bilinmeyen bağımlılık: ${detail}`,
  self_blocked_by: (detail) => `kendi kendini blokluyor: ${detail}`,
  cyclic_blocked_by: (detail) => `döngüsel bağımlılık: ${detail}`,
  front_matter_mismatch: (detail) => `workspace uyuşmuyor: ${detail}`,
  unknown_repo: (detail) => `bilinmeyen depo: ${detail}`,
};

// Türkçe demet (WO-0035): bu modülün tüm görüntü üyeleri tek objede. Labels TÜRÜ bu demetten türer;
// en.ts onu sağlamak zorunda — eksik anahtar derleme hatası. Yeni bir görüntü üyesi eklendiğinde
// hem buraya hem en.ts'e girer (derleyici hatırlatır).
const tr = {
  UI,
  budgetLine,
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
  AGENT_TASK_STATUS_LABELS,
  AGENT_TASK_RUNNING_WORD,
  TOOL_LABELS,
  TOOL_VERBS,
  MODE_LABELS,
  SOURCE_KIND_LABELS,
  PROVIDER_ERROR_LABELS,
  WO_EVENT_LABELS,
  PERMISSION_RULE_LABELS,
  PERMISSION_RULE_SHORT,
  PERMISSION_RULE_TINY,
  FAZ_STATUS_LABELS,
  ROADMAP_DIAGNOSTIC_LABELS,
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
  phaseLabelText,
  fazLabel,
  fazIdLabel,
};
export type Labels = typeof tr;
export default tr;
