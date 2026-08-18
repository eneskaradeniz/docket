// AuditTable (WO-0031c / v4 §4) — the session ledger: Oturum | Rol | Zaman | Süre | Maliyet + the
// total row. Rows come from core's deriveSessionAudit (structured names — labels render them); the
// table is the archive's default body and DETAY's "Denetim" section. A missing cost renders "—",
// never a fake $0,00 (the TD-030 honesty).
// WO-0031e tur-3: a row with a transcript expands in place — the toggle (▸/▾ döküm) maps through
// `sourceIdx` to `sessions[sourceIdx].transcript`, rendered as mono DOM via labels'
// `transcriptLineText` (core's formatTranscriptLine is xterm-ANSI — never for DOM). Instant show
// (no mount animation, ADR-0012), one row open at a time, height-capped. A session without a
// transcript renders no toggle — absent, never disabled (ADR-0001).
import { Fragment, useState } from 'react';
import type { SessionAuditRow } from '../../../core/derive';
import { deriveSessionAudit } from '../../../core/derive';
import type { SessionRef, StepSpec } from '../../../core/types';
import { formatUsd, transcriptLineText, UI } from '../../data/labels';
import { RoleChip } from './RoleChip';

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
  const [open, setOpen] = useState<number | null>(null);
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
          {rows.map((r) => {
            const transcript = sessions[r.sourceIdx]?.transcript ?? [];
            const expanded = open === r.sourceIdx && transcript.length > 0;
            return (
              <Fragment key={r.sourceIdx}>
                <tr className="border-b border-hairline/50">
                  <td className="max-w-[220px] px-1 py-1.5 font-sans text-[12px] font-semibold text-ink">
                    <span className="flex items-center gap-1">
                      {transcript.length > 0 ? (
                        <button
                          type="button"
                          data-audit-toggle=""
                          aria-expanded={expanded}
                          className="irow shrink-0 px-1 py-0.5 font-mono text-[10px] text-inkdim"
                          onClick={() => setOpen(expanded ? null : r.sourceIdx)}
                        >
                          {expanded ? UI.auditHideTranscript : UI.auditShowTranscript}
                        </button>
                      ) : null}
                      <span className="truncate">{nameText(r)}</span>
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-inkdim">
                    {/* D3: the row carries its role lamp (3px×11px) beside the rolechip — the same
                        lamp grammar the strip speaks (architect amber, implementer blue, verifier green). */}
                    <span className="flex items-center gap-1.5">
                      <span className={`rlamp rlamp-${r.role}`} aria-hidden="true" />
                      <RoleChip role={r.role} />
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-inkdim">{range(r)}</td>
                  <td className="px-1 py-1.5 text-right text-inkdim">{UI.formatDuration(r.durationMs)}</td>
                  <td className="px-1 py-1.5 text-right text-inkdim">
                    {r.costUsd !== undefined ? formatUsd(r.costUsd) : UI.auditCostNone}
                  </td>
                </tr>
                {expanded ? (
                  <tr className="border-b border-hairline/50">
                    <td colSpan={5} className="px-1 py-1.5">
                      <pre
                        data-audit-transcript=""
                        className="max-h-64 overflow-y-auto rounded border border-hairline bg-bg p-2 font-mono text-[11px] leading-relaxed text-inkdim"
                      >
                        {transcript.map((l, i) => (
                          <span key={i} className="block whitespace-pre-wrap break-words">{transcriptLineText(l)}</span>
                        ))}
                      </pre>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
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
