import type { DependencyHealth, SystemHealth } from '../../../core/health';
import { useLabels } from '../../data/locale';

// The health strip (WO-0066): the three dependencies' first-class state as ONE dim row on the
// board — tool name verbatim (the operator's own vocabulary, like the WO-number carve-out), a ✓
// mark, git's version. A degraded tool speaks its reason verbatim as its own line (the WO-0065
// timeline precedent: «we could not look» ≠ «we looked and it failed»). Absent when no look has
// landed (the caller gates it; ADR-0012).
export function HealthStrip({ health }: { health: SystemHealth }) {
  const { UI } = useLabels();
  const degraded = health.checks.filter((c): c is DependencyHealth & { state: { degraded: string } } => c.state !== 'ok');
  return (
    <div className="mb-5" data-testid="health-strip">
      <div className="flex items-baseline gap-3">
        <span className="readout">{UI.healthTitle}</span>
        {health.checks.map((c) => (
          <HealthToolChip key={c.tool} check={c} />
        ))}
      </div>
      {degraded.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {degraded.map((c) => (
            <div key={c.tool} className="font-mono text-[10.5px] text-[var(--color-error)]">
              {c.tool}: {c.state.degraded}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthToolChip({ check }: { check: DependencyHealth }) {
  return (
    <span className="flex items-baseline gap-1 font-mono text-[10.5px] text-inkdim">
      <span aria-hidden="true">{check.state === 'ok' ? '✓' : '✕'}</span>
      <span>{check.tool}</span>
      {check.state === 'ok' && check.version !== undefined && <span>{check.version}</span>}
    </span>
  );
}
