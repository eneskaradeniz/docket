import type { EvidenceItem } from '../../../core/types';
import { EVIDENCE_LABELS, EVIDENCE_MARK, UI } from '../../data/labels';

const TONE: Record<EvidenceItem['status'], string> = {
  satisfied: 'text-emerald-700',
  unsatisfied: 'text-slate-400',
  exempt: 'text-violet-700',
};

export function EvidencePanel({ items }: { items: EvidenceItem[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">{UI.evidence}</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={`${it.kind}-${it.scope ? (it.scope as string) : 'wo'}-${i}`} className="text-xs">
            <div className="flex items-start gap-2">
              <span className={`font-mono ${TONE[it.status]}`}>{EVIDENCE_MARK[it.status]}</span>
              <span className="text-slate-700">
                {EVIDENCE_LABELS[it.kind]}
                {it.scope && <span className="text-slate-400">{UI.scopedToTrack}</span>}
              </span>
            </div>
            {it.status === 'exempt' && it.exemption && (
              <p className="ml-6 text-[11px] text-violet-600">{it.exemption.reason}</p>
            )}
            {it.status === 'unsatisfied' && (
              <p className="ml-6 text-[11px] text-slate-400">{UI.missing}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
