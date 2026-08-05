import type { EvidenceItem } from '../../../core/types';
import { EVIDENCE_LABELS, EVIDENCE_MARK, UI } from '../../data/labels';

const TONE: Record<EvidenceItem['status'], string> = {
  satisfied: 'evx',
  unsatisfied: 'evblank',
  exempt: 'evexempt',
};

export function EvidencePanel({ items }: { items: EvidenceItem[] }) {
  return (
    <section className="rounded-sm border border-rule bg-surface p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.evidence}</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={`${it.kind}-${it.scope ? (it.scope as string) : 'wo'}-${i}`} className="text-xs">
            <div className="flex items-start gap-2">
              <span className={`font-mono ${TONE[it.status]}`}>{EVIDENCE_MARK[it.status]}</span>
              <span className="text-ink">
                {EVIDENCE_LABELS[it.kind]}
                {it.scope ? <span className="text-inkdim">{UI.scopedToTrack}</span> : null}
              </span>
            </div>
            {it.status === 'exempt' && it.exemption ? (
              <p className="ml-6 text-[11px] text-denim">{it.exemption.reason}</p>
            ) : null}
            {it.status === 'unsatisfied' ? <p className="ml-6 text-[11px] text-inkdim">{UI.missing}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
