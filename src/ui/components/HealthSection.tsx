import { useEffect, useState } from 'react';
import type { DependencyHealth, SystemHealth } from '../../core/health';
import { degradedKind } from '../../core/humanize';
import { useLabels } from '../data/locale';
import { Tooltip } from '../kit';

// WO-0083 — health lives on the OVERVIEW (the facts screen), in the section grammar, and speaks
// only when needed (operator ruling 2026-09-21: «gerekiğinde göstermeli, gizle/göster gibi»).
// Review round (PR #84): ONE row per tool — a degraded tool's row carries the operator words and
// never renders twice; the section auto-opens when a tool degrades and re-collapses when it heals
// (the look refreshes every minute and on focus — the old mount-time freeze is gone), and
// aria-expanded always tells the truth about the body. The raw reason and the version stamp ride
// the tooltips; the records keep the verbatim text (WO-0078's rule).
export function HealthSection({ health }: { health: SystemHealth }) {
  const { UI } = useLabels();
  const degradedCount = health.checks.filter((c) => c.state !== 'ok').length;
  const [open, setOpen] = useState(degradedCount > 0);
  useEffect(() => {
    setOpen(degradedCount > 0);
  }, [degradedCount]);
  return (
    <section data-overview-health className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
      <button
        type="button"
        className="irow flex w-full items-baseline gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="readout">{UI.healthTitle}</span>
        <span className="font-mono text-[10.5px] text-inkdim">
          {degradedCount > 0 ? UI.healthIssueCount(degradedCount) : UI.healthReadyCount(health.checks.length)}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1">
          {health.checks.map((c) => (
            <HealthToolRow key={c.tool} check={c} />
          ))}
        </div>
      )}
    </section>
  );
}

function HealthToolRow({ check }: { check: DependencyHealth }) {
  const { UI } = useLabels();
  const word = UI.HEALTH_TOOLS[check.tool];
  if (check.state !== 'ok') {
    return (
      <Tooltip label={check.state.degraded}>
        <div className="flex items-baseline gap-2 font-mono text-[10.5px] text-[var(--color-error)]">
          <span aria-hidden="true">✕</span>
          <span>
            {word}: {UI.DEGRADED_LINES[degradedKind(check.state.degraded)]}
          </span>
        </div>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={check.version !== undefined ? `${word} ${check.version}` : word}>
      <div className="flex items-baseline gap-2 font-mono text-[10.5px] text-inkdim">
        <span aria-hidden="true" className="text-proceed">
          ✓
        </span>
        <span>{word}</span>
        {check.version !== undefined && <span>{check.version}</span>}
      </div>
    </Tooltip>
  );
}
