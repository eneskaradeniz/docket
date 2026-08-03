import type { SourceLink } from '../../../core/types';
import { UI } from '../../data/labels';

const KIND_LABEL: Record<SourceLink['kind'], string> = {
  adr: 'ADR',
  tech_debt: 'tech-debt',
  roadmap: 'ROADMAP',
  contract: 'contract',
};

// Referenced documents are links only (ccd463e). Non-functional in the prototype; they point at git.
export function SourceLinks({ sources }: { sources: SourceLink[] }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-slate-800">{UI.sources}</h2>
      <ul className="flex flex-col gap-1">
        {sources.map((s) => (
          <li key={s.ref} className="text-xs">
            <span className="text-slate-500">
              {KIND_LABEL[s.kind]} · {s.label} ↗
            </span>
            <code className="ml-1 text-[11px] text-slate-400">{s.ref}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
