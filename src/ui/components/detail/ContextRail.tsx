// ContextRail — the detail's right-hand context column (WO-0031b): Steps → Evidence → Tracks →
// Timeline → Docs → Sources. Everything the old "Akışı göster" expander hid, always visible beside the
// session instrument (≥1120px) or stacked after it (narrow). One visual voice: readout section headers,
// calm cards, mono data.
import type { ReactNode } from 'react';
import type { StepView, TrackLaneView, WoEvent, WorkOrderDetailView } from '../../../core/types';
import { UI, formatDateTime, WO_EVENT_LABELS } from '../../data/labels';
import { StepList } from './StepList';
import { EvidencePanel } from './EvidencePanel';
import { TrackLane } from './TrackLane';
import { SourceLinks } from './SourceLinks';
import { MarkdownDoc } from './MarkdownDoc';

function RailSection({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="readout mb-2 flex items-baseline gap-2">
        {title}
        {aside ? <span className="font-mono text-inkdim/60">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function ContextRail({
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
}) {
  return (
    <aside className="flex min-w-0 flex-col gap-5">
      {steps.length > 0 ? (
        <RailSection title={UI.stepsHeader} aside={`${steps.filter((s) => s.status === 'done').length}/${steps.length}`}>
          <StepList steps={steps} onOpenReport={onOpenReport} />
        </RailSection>
      ) : null}

      <RailSection title={UI.evidence}>
        <EvidencePanel items={detail.evidence} />
      </RailSection>

      {detail.tracks.length > 0 ? (
        <RailSection title={UI.tracks}>
          <ul className="flex flex-col gap-2">
            {detail.tracks.map((ln: TrackLaneView) => (
              <TrackLane key={ln.track.id as string} lane={ln} />
            ))}
          </ul>
        </RailSection>
      ) : null}

      <RailSection title={UI.timelineTitle}>
        {events.length === 0 ? (
          <p className="text-[12px] text-inkdim">{UI.timelineLegacyNote}</p>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {events.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px]">
                <span className="shrink-0 font-mono text-[11px] text-inkdim">{formatDateTime(e.at)}</span>
                <span className="text-ink">{WO_EVENT_LABELS[e.kind]}</span>
                {e.detail ? <span className="truncate font-mono text-[11px] text-inkdim">{e.detail}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </RailSection>

      <RailSection title={UI.docsSection}>
        <div className="flex flex-col gap-2">
          {docs.order ? <MarkdownDoc title={UI.orderDoc} content={docs.order} /> : null}
          {docs.plan ? <MarkdownDoc title={UI.planDoc} content={docs.plan} /> : null}
        </div>
      </RailSection>

      {detail.sources.length > 0 ? (
        <RailSection title={UI.sources}>
          <SourceLinks sources={detail.sources} />
        </RailSection>
      ) : null}
    </aside>
  );
}
