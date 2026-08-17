// DetailSections (WO-0031c / v4) — the DETAY side surfaces, one list consumed by BOTH layouts: the
// ≥1080 rack (stacked in the side column) and the <1080 tab bar. Audit A4 rule: a section with
// nothing to show is ABSENT — no header, no tab. Evidence always shows (three WO-level items are
// ever-present by model); Timeline only with events; the rest on presence.
import type { ReactNode } from 'react';
import { parsePlanSteps } from '../../../core/plan-steps';
import type { StepView, TrackLaneView, WoEvent, WorkOrderDetailView } from '../../../core/types';
import { eventDetailText, UI, formatDateTime, WO_EVENT_LABELS } from '../../data/labels';
import { AuditTable } from './AuditTable';
import { StepList } from './StepList';
import { EvidencePanel } from './EvidencePanel';
import { TrackLane } from './TrackLane';
import { SourceLinks } from './SourceLinks';
import { MarkdownDoc } from './MarkdownDoc';

export interface DetailSection {
  id: string;
  title: string;
  aside?: string;
  node: ReactNode;
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
  sections.push({ id: 'evidence', title: UI.secEvidence, node: <EvidencePanel items={detail.evidence} /> });
  if (detail.tracks.length > 0) {
    sections.push({
      id: 'tracks',
      title: UI.secTracks,
      node: (
        <ul className="flex flex-col gap-2">
          {detail.tracks.map((ln: TrackLaneView) => (
            <TrackLane key={ln.track.id as string} lane={ln} />
          ))}
        </ul>
      ),
    });
  }
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
    sections.push({
      id: 'docs',
      title: UI.secDocs,
      node: (
        <div className="flex flex-col gap-2">
          {docs.order ? <MarkdownDoc title={UI.orderDoc} content={docs.order} /> : null}
          {docs.plan ? <MarkdownDoc title={UI.planDoc} content={docs.plan} /> : null}
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

/** The rack's stacked form (≥1080): readout headers over calm content. */
export function SectionStack({ sections }: { sections: DetailSection[] }) {
  return (
    <aside className="flex min-w-0 flex-col gap-3.5">
      {sections.map((s) => (
        <section key={s.id}>
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
