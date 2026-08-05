import type { SourceLink } from '../../../core/types';
import { SOURCE_KIND_LABELS, UI } from '../../data/labels';

// Referenced documents are links only (ccd463e). Non-functional in the prototype; they point at git.
export function SourceLinks({ sources }: { sources: SourceLink[] }) {
  return (
    <section>
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.sources}</h2>
      <ul className="flex flex-col gap-1">
        {sources.map((s) => (
          <li key={s.ref} className="text-xs">
            <span className="text-inkdim">
              {SOURCE_KIND_LABELS[s.kind]} · {s.label} ↗
            </span>
            <code className="ml-1 font-mono text-[11px] text-inkdim">{s.ref}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
