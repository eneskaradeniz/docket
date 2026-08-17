// DetailSections (WO-0031c / v4) — the DETAY side surfaces, one list consumed by BOTH layouts: the
// ≥1080 rack (stacked in the side column) and the <1080 tab bar. Audit A4 rule: a section with
// nothing to show is ABSENT — no header, no tab. Evidence always shows (three WO-level items are
// ever-present by model); Timeline only with events; the rest on presence.
//
// WO-0031d tur-2: the Repolar section is GONE (D3 — the track state folds into Kanıt's chips);
// Kanıt carries a '3/5' summary aside like Adımlar (D2); Belgeler never renders the ```steps fence
// raw — the prose shows and the steps become a card summary (A4, splitStepsFence).
import type { ReactNode } from 'react';
import { parsePlanSteps, splitStepsFence } from '../../../core/plan-steps';
import type { StepSpec, StepView, TrackId, WoEvent, WorkOrderDetailView } from '../../../core/types';
import { eventDetailText, UI, formatDateTime, WO_EVENT_LABELS } from '../../data/labels';
import { AuditTable } from './AuditTable';
import { StepList } from './StepList';
import { EvidencePanel } from './EvidencePanel';
import { RoleChip } from './RoleChip';
import { SourceLinks } from './SourceLinks';
import { MarkdownDoc } from './MarkdownDoc';

export interface DetailSection {
  id: string;
  title: string;
  aside?: string;
  node: ReactNode;
}

/** The plan's steps in the card language — the fence NEVER renders raw (tur-2 A4). */
function PlanStepsSummary({ steps }: { steps: StepSpec[] }) {
  return (
    <div className="flex flex-col gap-1.5" data-plan-summary={steps.length}>
      {steps.map((s) => (
        <div key={s.idx} className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5">
          <span className="font-mono text-[11px] text-inkdim">{s.idx}</span>
          <RoleChip role={s.role} />
          <span className="min-w-0 truncate text-[12.5px] text-ink">{s.aim}</span>
        </div>
      ))}
    </div>
  );
}

export function buildDetailSections({
  detail,
  steps,
  events,
  docs,
  onOpenReport,
}: {
  detail: WorkOrderDetailView;
  steps: StepView[];
  events: WoEvent[];
  docs: { order: string; plan: string };
  onOpenReport: (step: StepView) => void;
}): DetailSection[] {
  // WO-0031c: a running WO's ledger lives in DETAY's Denetim section (the archive shows it by default).
  const sections: DetailSection[] = [];
  if (steps.length > 0) {
    sections.push({
      id: 'steps',
      title: UI.secSteps,
      aside: `${steps.filter((s) => s.status === 'done').length}/${steps.length}`,
      node: <StepList steps={steps} sessions={detail.sessions} onOpenReport={onOpenReport} />,
    });
  }
  const repoByTrack = new Map<TrackId, string>(detail.tracks.map((ln) => [ln.track.id, ln.track.repo as string]));
  const repoCount = new Set(repoByTrack.values()).size;
  const satisfied = detail.evidence.filter((e) => e.status === 'satisfied').length;
  sections.push({
    id: 'evidence',
    title: UI.secEvidence,
    aside: `${satisfied}/${detail.evidence.length}`,
    node: (
      <EvidencePanel
        items={detail.evidence}
        tracks={detail.tracks}
        repoOf={(id: TrackId) => repoByTrack.get(id)}
        multiRepo={repoCount > 1}
      />
    ),
  });
  if (events.length > 0) {
    sections.push({
      id: 'timeline',
      title: UI.secTimeline,
      node: (
        <ol className="flex flex-col gap-0.5">
          {events.map((e, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[12px]">
              <span className="shrink-0 font-mono text-[11px] text-inkdim">{formatDateTime(e.at)}</span>
              <span className="text-ink">{WO_EVENT_LABELS[e.kind]}</span>
              {e.detail ? <span className="truncate font-mono text-[11px] text-inkdim">{eventDetailText(e.kind, e.detail)}</span> : null}
            </li>
          ))}
        </ol>
      ),
    });
  }
  if (docs.order || docs.plan) {
    // A4: the fence never shows raw — the plan doc renders its prose plus the steps as cards.
    const plan = docs.plan ? splitStepsFence(docs.plan) : undefined;
    sections.push({
      id: 'docs',
      title: UI.secDocs,
      node: (
        <div className="flex flex-col gap-2">
          {docs.order ? <MarkdownDoc title={UI.orderDoc} content={docs.order} /> : null}
          {plan ? (
            <div className="flex flex-col gap-2">
              <MarkdownDoc title={UI.planDoc} content={plan.prose} />
              {plan.steps.length > 0 ? <PlanStepsSummary steps={plan.steps} /> : null}
            </div>
          ) : null}
        </div>
      ),
    });
  }
  if (detail.sources.length > 0) {
    sections.push({ id: 'sources', title: UI.secSources, node: <SourceLinks sources={detail.sources} /> });
  }
  if (detail.sessions.length > 0 && detail.stage !== 'closed') {
    sections.push({
      id: 'audit',
      title: UI.auditTitle,
      node: <AuditTable sessions={detail.sessions} steps={parsePlanSteps(docs.plan)} />,
    });
  }
  return sections;
}

/** The rack's stacked form (≥1080): readout headers over calm content. The id anchors the
 *  substrip's adım N/T jump (tur-2 A7 — scroll-margin clears the pinned chrome). */
export function SectionStack({ sections }: { sections: DetailSection[] }) {
  return (
    <aside className="flex min-w-0 flex-col gap-3.5">
      {sections.map((s) => (
        <section key={s.id} id={`sec-${s.id}`}>
          <h2 className="readout mb-2 flex items-baseline gap-2">
            {s.title}
            {s.aside ? <span className="font-mono text-inkdim/60">{s.aside}</span> : null}
          </h2>
          {s.node}
        </section>
      ))}
    </aside>
  );
}
