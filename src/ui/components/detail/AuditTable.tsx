// AuditTable (WO-0031c / v4 §4) — the session ledger: Oturum | Rol | Zaman | Süre | Maliyet + the
// total row. Rows come from core's deriveSessionAudit (structured names — labels render them); the
// table is the archive's default body and DETAY's "Denetim" section. A missing cost renders "—",
// never a fake $0,00 (the TD-030 honesty).
import type { SessionAuditRow } from '../../../core/derive';
import { deriveSessionAudit } from '../../../core/derive';
import type { SessionRef, StepSpec } from '../../../core/types';
import { formatUsd, ROLE_LABELS, UI } from '../../data/labels';

function nameText(row: SessionAuditRow): string {
  switch (row.name.kind) {
    case 'plan':
      return UI.auditNamePlan;
    case 'step':
      return UI.auditNameStep(row.name.idx, row.name.aim);
    case 'review':
      return UI.auditNameReview(row.name.idx);
    case 'unscoped':
      return UI.auditNameUnscoped;
  }
}

export function AuditTable({ sessions, steps }: { sessions: SessionRef[]; steps?: StepSpec[] }) {
  const { rows, total } = deriveSessionAudit(sessions, steps);
  if (rows.length === 0) return null;
  const range = (r: SessionAuditRow): string =>
    r.startedAt && r.endedAt ? UI.auditRange(r.startedAt, r.endedAt) : r.startedAt ? UI.auditClock(r.startedAt) : UI.auditCostNone;
  return (
    <section data-audit-table="">
      <header className="mb-2 flex items-baseline gap-2.5">
        <p className="readout text-proceed">{UI.auditTitle}</p>
      </header>
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="border-b border-hairline text-inkdim">
            <th className="px-1 py-1.5 text-left font-medium">{UI.auditColSession}</th>
            <th className="px-1 py-1.5 text-left font-medium">{UI.auditColRole}</th>
            <th className="px-1 py-1.5 text-left font-medium">{UI.auditColTime}</th>
            <th className="px-1 py-1.5 text-right font-medium">{UI.auditColDuration}</th>
            <th className="px-1 py-1.5 text-right font-medium">{UI.auditColCost}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-hairline/50">
              <td className="max-w-[220px] truncate px-1 py-1.5 font-sans text-[12px] font-semibold text-ink">{nameText(r)}</td>
              <td className="px-1 py-1.5 text-inkdim">{ROLE_LABELS[r.role]}</td>
              <td className="px-1 py-1.5 text-inkdim">{range(r)}</td>
              <td className="px-1 py-1.5 text-right text-inkdim">{UI.formatDuration(r.durationMs)}</td>
              <td className="px-1 py-1.5 text-right text-inkdim">
                {r.costUsd !== undefined ? formatUsd(r.costUsd) : UI.auditCostNone}
              </td>
            </tr>
          ))}
          <tr className="border-t border-hairline font-semibold text-ink">
            <td className="px-1 py-1.5 font-sans text-[12px]">{UI.auditTotal}</td>
            <td />
            <td className="px-1 py-1.5 text-inkdim">
              {total.startAt && total.endAt ? UI.auditRange(total.startAt, total.endAt) : ''}
            </td>
            <td className="px-1 py-1.5 text-right">{UI.formatDuration(total.durationMs)}</td>
            <td className="px-1 py-1.5 text-right">{total.costUsd > 0 ? formatUsd(total.costUsd) : UI.auditCostNone}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
