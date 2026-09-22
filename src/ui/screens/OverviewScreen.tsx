// OverviewScreen (WO-0072) — the FOURTH surface: the FACTS screen (WO-0086's ruling — environment
// facts live here, the board is work-only). ONE 840px scroll: Sıra (open work orders grouped by
// whose turn the stage model says it is), Borçlar (the open tech-debt lines and the work orders
// that opened them), Hazır (the planli roadmap tasks), Sağlık (the machine tools, WO-0083) and
// Depo (the repo connections + open PRs, WO-0086 — content-INDEPENDENT: a workless workspace's
// connections belong here all the same). Every section ABSENT when it has nothing (ADR-0012), and
// a workspace with none of it degrading to ONE invitation line. Read-only: a row NAVIGATES (the
// board card's select), it never acts; there is no stage column anywhere (TD-008's stance) and no
// cached projection (the read is once per mount/workspace switch — the usage screen's cadence).
//
// The turn group head carries the role word in its role hue (ADR-0013's KİM — ROL idiom, the
// SessionCards mapping); OPERATOR is no session role, so its word stays un-hued — the word carries
// it, never color alone. WO-0080: the ready arm is the planli tasks' ALONE — every open WO's
// startability is already its turn group's content, and listing it twice read as a second,
// emptier board (the atelier's 2026-09-20 finding).
import type { ForgeIssueRow, ForgePrDetail, ForgeView } from '../../core/forge';
import type { SystemHealth } from '../../core/health';
import type { Turn, WorkspaceOverview } from '../../core/overview';
import type { WorkOrderId } from '../../core/types';
import { useLabels } from '../data/locale';
import { cn } from '../kit';
import { ForgeSection } from '../components/board/ForgeSection';
import { HealthSection } from '../components/HealthSection';

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
  health,
  forge,
  forgePending,
  onRefreshForge,
  onPrDetail,
  onPrDiff,
  onOpenExternal,
  onSpawnIssue,
  onBatchSpawnIssues,
  spawnedWoIdsByIssue,
  onSelect,
}: {
  view: WorkspaceOverview | undefined; // undefined = the read is in flight
  health?: SystemHealth; // WO-0083: the machine tools' state — the section speaks only when needed
  forge?: ForgeView; // WO-0086: the workspace's repo connections + open PRs (moved off the board)
  /** WO-0086: true = a forge watch exists but THIS workspace's look has not landed — the skeleton's
   *  only legitimate moment (no watch → no skeleton, the section is simply never fed). */
  forgePending?: boolean;
  onRefreshForge?: () => void;
  /** WO-0087: the depo row's lazy detail + diff, fetched live; the browser chip rides
   *  shell.openExternal. All three optional — absent = the rows render without toggles. */
  onPrDetail?: (repoRemote: string, number: number) => Promise<ForgePrDetail>;
  onPrDiff?: (repoRemote: string, number: number) => Promise<string>;
  onOpenExternal?: (url: string) => void;
  /** WO-0092: the issue spawn actions — single (prefilled dialog) + the counted batch. */
  onSpawnIssue?: (repoRemote: string, issue: ForgeIssueRow) => Promise<void>;
  onBatchSpawnIssues?: (repoRemote: string, issues: ForgeIssueRow[]) => Promise<void>;
  /** WO-0092: the view-time issue→WO join — issue ref → its spawned WOs (this workspace). */
  spawnedWoIdsByIssue?: Map<string, WorkOrderId[]>;
  onSelect: (id: WorkOrderId) => void;
}) {
  const { UI, woIdLabel, debtIdLabel } = useLabels();
  const turnWord: Record<Turn, string> = {
    architect: UI.overviewTurnArchitect,
    operator: UI.overviewTurnOperator,
    implementer: UI.overviewTurnImplementer,
    verifier: UI.overviewTurnVerifier,
  };
  const hasReady = view !== undefined && view.ready.tasks.length > 0;
  const hasTurns = view !== undefined && view.turns.length > 0;
  const hasDebts = view !== undefined && view.debts.length > 0;
  const hasContent = hasTurns || hasDebts || hasReady;
  // WO-0086 fix: Depo is CONTENT-INDEPENDENT — a workless workspace still has connected repos,
  // and their facts are exactly what its overview should show (the operator's live finding).
  const forgeLanded = forge !== undefined && forge.repos.length > 0;

  // WO-0083 + WO-0086 fix: the pure empty face (one invitation line, no sections) holds only while
  // every tool is ok AND no forge look is pending/landed — a degraded tool or connected repos
  // speak even here.
  const degradedCount = health?.checks.filter((c) => c.state !== 'ok').length ?? 0;
  let body;
  if (view === undefined) {
    body = <p className="loadline px-1 py-8">{UI.loadOverview}</p>;
  } else if (!hasContent && degradedCount === 0 && !forgeLanded && !forgePending) {
    // The absent grammar: a workspace with neither open work orders nor tasks nor debts is ONE line.
    body = (
      <div data-overview-empty className="rounded-md border border-dashed border-hairline px-3 py-2.5">
        <p className="text-sm text-ink">{UI.overviewEmpty}</p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {!hasTurns && !hasDebts && !hasReady ? (
          <div data-overview-empty className="rounded-md border border-dashed border-hairline px-3 py-2.5">
            <p className="text-sm text-ink">{UI.overviewEmpty}</p>
          </div>
        ) : null}
        {hasTurns ? (
          <section data-overview-turns className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
            {view.turns.map((g) => (
              <div key={g.turn} data-overview-turn={g.turn} className={g.turn !== view.turns[0]!.turn ? 'mt-2' : undefined}>
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
        {health !== undefined ? <HealthSection health={health} /> : null}
        {/* WO-0086 fix: Depo is content-independent — a workless workspace's overview is exactly
            where its connections belong; the skeleton rides the pending look. */}
        {forgePending ? (
          <section className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm" data-forge-skeleton>
            <p className="loadline">{UI.forgeScanning}</p>
            <div className="scanline mt-1"><div /></div>
          </section>
        ) : null}
        {forgeLanded ? (
          <ForgeSection
            view={forge}
            onRefresh={onRefreshForge ?? (() => {})}
            onPrDetail={onPrDetail}
            onPrDiff={onPrDiff}
            onOpenExternal={onOpenExternal}
            onSpawnIssue={onSpawnIssue}
            onBatchSpawnIssues={onBatchSpawnIssues}
            spawnedWoIdsByIssue={spawnedWoIdsByIssue}
            onOpenSpawnedWo={onSelect}
          />
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
