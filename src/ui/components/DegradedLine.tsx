import { degradedKind } from '../../core/humanize';
import { useLabels } from '../data/locale';
import { Tooltip } from '../kit';

// WO-0078 — the ONE degraded face. The kind picks the operator line from the locale bundles; the
// verbatim reason rides the kit Tooltip as the hint (ADR-0012: tooltips carry reasons). The face
// keeps the mono signature the forge row established; the record layer keeps the raw text.
// «Görüşemedik» stays distinct from «baktı ve başarısız oldu» — in words, per the forge.ts shaping.
export function DegradedLine({ reason }: { reason: string }) {
  const { UI } = useLabels();
  const line = UI.DEGRADED_LINES[degradedKind(reason)];
  return (
    <Tooltip label={reason}>
      <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-error)]">{line}</div>
    </Tooltip>
  );
}
