// OverviewScreen (WO-0072) — the FOURTH surface: the workspace's own facts projected (ADR-0008's
// derived-read discipline — the third consumer of the gate model, after the board and the detail).
// ONE 840px scroll, three sections in fixed order — Sıra (open work orders grouped by whose turn
// the stage model says it is), Borçlar (the open tech-debt lines and the work orders that opened
// them), Hazır (the work orders and roadmap tasks whose gates are satisfiable) — every section
// ABSENT when it has nothing (ADR-0012: empty groups render absent), and the all-empty workspace
// degrading to ONE invitation line. Read-only: a row NAVIGATES (the board card's select), it never
// acts; there is no stage column anywhere (TD-008's stance) and no cached projection (the read is
// once per mount/workspace switch — the usage screen's cadence).
//
// The turn group head carries the role word in its role hue (ADR-0013's KİM — ROL idiom, the
// SessionCards mapping); OPERATOR is no session role, so its word stays un-hued — the word carries
// it, never color alone. The `why` arm of a ready work order stays DATA in v1: the section head
// already names the state, and no row needs a second line to say "startable".
import type { Turn, WorkspaceOverview } from '../../core/overview';
import type { WorkOrderId } from '../../core/types';
import { useLabels } from '../data/locale';
import { cn } from '../kit';

// The role word hue — SessionCards' ROLE_WORD_CLASS, the three agent turns verbatim; the operator
// turn rides plain ink (not a session role — no lamp exists for it, and one would lie).
const TURN_WORD_CLASS: Record<Turn, string> = {
  architect: 'text-signal',
  operator: 'text-ink',
  implementer: 'text-info',
  verifier: 'text-proceed',
};

export function OverviewScreen({
  view,
  onSelect,
}: {
  view: WorkspaceOverview | undefined; // undefined = the read is in flight
  onSelect: (id: WorkOrderId) => void;
}) {
  const { UI, woIdLabel, debtIdLabel } = useLabels();
  const turnWord: Record<Turn, string> = {
    architect: UI.overviewTurnArchitect,
    operator: UI.overviewTurnOperator,
    implementer: UI.overviewTurnImplementer,
    verifier: UI.overviewTurnVerifier,
  };
  const hasReady = view !== undefined && (view.ready.wos.length > 0 || view.ready.tasks.length > 0);
  const hasTurns = view !== undefined && view.turns.length > 0;
  const hasDebts = view !== undefined && view.debts.length > 0;

  let body;
  if (view === undefined) {
    body = <p className="loadline px-1 py-8">{UI.loadOverview}</p>;
  } else if (!hasTurns && !hasDebts && !hasReady) {
    // The absent grammar: a workspace with neither open work orders nor tasks nor debts is ONE line.
    body = (
      <div data-overview-empty className="rounded-md border border-dashed border-hairline px-3 py-2.5">
        <p className="text-sm text-ink">{UI.overviewEmpty}</p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {hasTurns ? (
          <section data-overview-turns className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
            {view.turns.map((g) => (
              <div key={g.turn} data-overview-turn={g.turn} className={g.turn !== view.turns[0]!.turn ? 'mt-2.5' : undefined}>
                <p className={cn('readout', TURN_WORD_CLASS[g.turn])}>{turnWord[g.turn]}</p>
                <div className="mt-0.5">
                  {g.wos.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => onSelect(w.id)}
                      className="irow flex w-full items-baseline gap-2.5 border-b border-hairline py-1.5 text-left last:border-b-0"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-inkdim">{woIdLabel(w.id)}</span>
                      <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{w.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {hasDebts ? (
          <section data-overview-debts className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
            <p className="readout text-inkdim">{UI.overviewDebtsTitle}</p>
            <div className="mt-0.5">
              {view.debts.map((d) => {
                const linked = d.wo; // narrowed once — the chip's click needs the stable local
                return (
                  <div key={d.id} className="border-b border-hairline py-1.5 last:border-b-0">
                    <div className="flex items-baseline gap-2.5">
                      <span className="shrink-0 font-mono text-[11px] text-inkdim">{debtIdLabel(d.id)}</span>
                      <span className="min-w-0 shrink truncate text-[13px] text-ink">{d.title}</span>
                      {linked !== undefined ? (
                        <button
                          type="button"
                          onClick={() => onSelect(linked)}
                          className="irow ml-auto shrink-0 border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-inkdim"
                        >
                          {woIdLabel(linked)}
                        </button>
                      ) : null}
                    </div>
                    {linked === undefined ? (
                      <p className="pl-[calc(11px+0.625rem)] text-xs text-inkdim">{UI.overviewDebtUnlinked}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {hasReady ? (
          <section data-overview-ready className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
            <p className="readout text-inkdim">{UI.overviewReadyTitle}</p>
            {view.ready.wos.length > 0 ? (
              <div className="mt-0.5">
                {view.ready.wos.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onSelect(w.id)}
                    className="irow flex w-full items-baseline gap-2.5 border-b border-hairline py-1.5 text-left last:border-b-0"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-inkdim">{woIdLabel(w.id)}</span>
                    <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{w.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {view.ready.tasks.length > 0 ? (
              <div className="mt-0.5">
                {view.ready.tasks.map((t) => (
                  <div key={t.id} className="border-b border-hairline py-1.5 last:border-b-0">
                    <span className="min-w-0 truncate text-[13px] text-ink">{t.title}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }
  return (
    <main data-overview-screen className="mx-auto w-full max-w-[840px] px-5 py-5">
      {body}
    </main>
  );
}
