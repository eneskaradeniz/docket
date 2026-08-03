import { useState } from 'react';
import type { SessionRef, SessionRole } from '../../../core/types';
import { ROLE_LABELS, UI } from '../../data/labels';
import { Badge } from '../primitives/Badge';
import { StopAndAskCard } from './StopAndAskCard';
import { Transcript } from './Transcript';

// PROVISIONAL region (AC7 / stop-and-ask gate 3). Isolated in its own folder + minimal props
// (`sessions` only) so WO-0001's outcome can replace it without touching the rest.
const ROLE_ORDER: SessionRole[] = ['implementer', 'architect', 'verifier'];

export function SessionPane({ sessions }: { sessions: SessionRef[] }) {
  const present = ROLE_ORDER.filter((r) => sessions.some((s) => s.role === r));
  const [active, setActive] = useState<SessionRole>(present[0] ?? 'implementer');
  const current = sessions.find((s) => s.role === active);

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{UI.session}</h2>
        <Badge tone="provisional">{UI.provisional}</Badge>
      </header>

      {present.length === 0 ? (
        <p className="text-xs text-slate-400">{UI.noSessionForRole}</p>
      ) : (
        <>
          <div className="mb-2 flex gap-1">
            {present.map((r) => {
              const s = sessions.find((x) => x.role === r);
              const isActive = r === active;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setActive(r)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {ROLE_LABELS[r]}
                  {!isActive && s?.status === 'running' && (
                    <span className="ml-1 text-emerald-500">●</span>
                  )}
                  {!isActive && s?.status === 'stopped_asking' && (
                    <span className="ml-1 text-rose-500">●</span>
                  )}
                </button>
              );
            })}
          </div>

          {current?.status === 'stopped_asking' && <StopAndAskCard stopAndAsk={current.stopAndAsk} />}
          {current ? (
            <Transcript entries={current.transcript} />
          ) : (
            <p className="text-xs text-slate-400">{UI.noSessionForRole}</p>
          )}
        </>
      )}
    </section>
  );
}
