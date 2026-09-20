import { useState } from 'react';
import type { DependencyHealth, SystemHealth } from '../../core/health';
import { degradedKind } from '../../core/humanize';
import { useLabels } from '../data/locale';
import { Tooltip } from '../kit';

// WO-0083 — health lives on the OVERVIEW (the facts screen), in the section grammar, and speaks
// only when needed (operator ruling 2026-09-21: «gerekiğinde göstermeli, gizle/göster gibi»):
// healthy tools collapse into ONE summary row behind a göster/gizle toggle; a degraded tool opens
// the section and speaks operator words (WO-0078's rule — the raw reason rides the tooltip, the
// version detail too). The board no longer carries the strip; only the empty face's create door
// still reads the health look (App's gate, untouched).
export function HealthSection({ health }: { health: SystemHealth }) {
  const { UI } = useLabels();
  const degraded = health.checks.filter((c): c is DependencyHealth & { state: { degraded: string } } => c.state !== 'ok');
  const [open, setOpen] = useState(degraded.length > 0);
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
          {degraded.length > 0 ? UI.healthIssueCount(degraded.length) : UI.healthReadyCount(health.checks.length)}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {degraded.length > 0 && (
        <div className="mt-1 space-y-1">
          {degraded.map((c) => (
            <DegradedToolLine key={c.tool} check={c} />
          ))}
        </div>
      )}
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
  return (
    <Tooltip label={check.state === 'ok' ? (check.version !== undefined ? `${UI.HEALTH_TOOLS[check.tool]} ${check.version}` : UI.HEALTH_TOOLS[check.tool]) : check.state.degraded}>
      <div className="flex items-baseline gap-2 font-mono text-[10.5px] text-inkdim">
        <span aria-hidden="true" className={check.state === 'ok' ? 'text-proceed' : 'text-error'}>
          {check.state === 'ok' ? '✓' : '✕'}
        </span>
        <span>{UI.HEALTH_TOOLS[check.tool]}</span>
        {check.state === 'ok' && check.version !== undefined && <span>{check.version}</span>}
      </div>
    </Tooltip>
  );
}

function DegradedToolLine({ check }: { check: DependencyHealth & { state: { degraded: string } } }) {
  const { UI } = useLabels();
  return (
    <Tooltip label={check.state.degraded}>
      <div className="font-mono text-[10.5px] text-[var(--color-error)]">
        {UI.HEALTH_TOOLS[check.tool]}: {UI.DEGRADED_LINES[degradedKind(check.state.degraded)]}
      </div>
    </Tooltip>
  );
}
