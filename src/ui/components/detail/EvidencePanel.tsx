// EvidencePanel (WO-0031d tur-2 D2/D3) — Kanıt as horizontal chips (the mockup's .evd language):
//   satisfied → '✓ label' (proceed); unsatisfied → an ABSENCE SENTENCE (ADR-0001 spirit — never a
//   reasonless 'eksik'); exempt → info tone with the reason one line under (full text in the title).
// D3 folds the dead TrackLane in: each track is ONE chip — merged → '✓ Depoda · repo', otherwise its
// PR/CI position ('PR açık · CI yeşil' / 'henüz PR yok' / 'CI muaf' / 'CI yeşil değil'). The scope
// suffix is the REPO name (never a TrackId); a single-repo work order prints no suffix. Chips are not
// controls → no hover (ADR-0012 r1 scopes the contract to controls).
import type { EvidenceItem, TrackId, TrackLaneView } from '../../../core/types';
import { useLabels } from '../../data/locale';

type Chip = { key: string; text: string; tone: 'proceed' | 'dim' | 'info'; title?: string; reason?: string };

const TONE_CLASS: Record<Chip['tone'], string> = {
  proceed: 'border-proceed/40 text-proceed',
  dim: 'border-hairline text-inkdim',
  info: 'border-info/40 text-info',
};

export function EvidencePanel({
  items,
  tracks,
  repoOf,
  multiRepo,
}: {
  items: EvidenceItem[];
  /** The tracks whose PR/CI/merge state speaks here (D3 — the TrackLane is gone). */
  tracks: TrackLaneView[];
  repoOf: (id: TrackId) => string | undefined;
  multiRepo: boolean;
}) {
  const { EVIDENCE_LABELS, UI } = useLabels();
  // WO-0035: the absence map + the chip builder moved inside — they read the hook's words, so they
  // re-localize with the locale (module scope would freeze the first-seen bundle).
  /** The absence sentence per WO-level kind — what is MISSING, in plain words. */
  const ABSENCE: Partial<Record<EvidenceItem['kind'], string>> = {
    plan_approval: UI.evdPlanApproval,
    verification: UI.evdVerification,
    closure: UI.evdClosure,
  };

  /** One chip per WO-level evidence item + ONE chip per track (D3: the TrackLane fold). */
  function buildChips(
    items: EvidenceItem[],
    tracks: TrackLaneView[],
    repoOf: (id: TrackId) => string | undefined,
    multiRepo: boolean,
  ): Chip[] {
    const chips: Chip[] = [];
    for (const it of items) {
      if (it.scope !== undefined) continue; // per-track evidence speaks through the track chips below
      if (it.status === 'satisfied') {
        chips.push({ key: `wo-${it.kind}`, text: `✓ ${EVIDENCE_LABELS[it.kind]}`, tone: 'proceed' });
      } else if (it.status === 'exempt') {
        chips.push({
          key: `wo-${it.kind}`,
          text: EVIDENCE_LABELS[it.kind],
          tone: 'info',
          ...(it.exemption ? { title: it.exemption.reason, reason: it.exemption.reason } : {}),
        });
      } else {
        chips.push({ key: `wo-${it.kind}`, text: ABSENCE[it.kind] ?? EVIDENCE_LABELS[it.kind], tone: 'dim' });
      }
    }
    for (const ln of tracks) {
      const repo = repoOf(ln.track.id);
      const suffix = multiRepo && repo !== undefined ? ` · ${repo}` : '';
      const scoped = (kind: 'pr_open' | 'ci_green') => items.find((e) => e.kind === kind && e.scope === ln.track.id);
      const prOpen = scoped('pr_open')?.status === 'satisfied';
      const ci = scoped('ci_green');
      let chip: Chip;
      if (ln.track.merge) {
        chip = { key: `tr-${ln.track.id}`, text: UI.evdMerged(multiRepo ? repo : undefined), tone: 'proceed' };
      } else if (!prOpen) {
        chip = { key: `tr-${ln.track.id}`, text: multiRepo && repo !== undefined ? UI.evdPrMissing(repo) : UI.evdNoPr, tone: 'dim' };
      } else if (ci?.status === 'satisfied') {
        chip = { key: `tr-${ln.track.id}`, text: `${UI.evdPrCi(UI.evdCiGreenShort)}${suffix}`, tone: 'proceed' };
      } else if (ci?.status === 'exempt') {
        chip = {
          key: `tr-${ln.track.id}`,
          text: `${UI.evdPrCi(UI.ciExempt)}${suffix}`,
          tone: 'info',
          ...(ci.exemption ? { title: ci.exemption.reason } : {}),
        };
      } else {
        chip = { key: `tr-${ln.track.id}`, text: UI.evdCiRed(multiRepo ? repo : undefined), tone: 'dim' };
      }
      chips.push(chip);
    }
    return chips;
  }

  const chips = buildChips(items, tracks, repoOf, multiRepo);
  const satisfied = items.filter((e) => e.status === 'satisfied').length;
  return (
    <ul className="flex flex-wrap gap-1.5" data-evidence-chips={chips.length} data-evidence-sum={`${satisfied}/${items.length}`}>
      {chips.map((c) => (
        <li key={c.key} className="max-w-full">
          <span className={`inline-block rounded border px-1.5 py-px font-mono text-[11px] ${TONE_CLASS[c.tone]}`} {...(c.title ? { title: c.title } : {})}>
            {c.text}
          </span>
          {c.reason ? <span className="block pl-1 text-[10.5px] text-info">{c.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}
