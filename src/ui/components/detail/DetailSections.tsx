// RecordSections (WO-0031c / v4 → WO-0031f v6) — the KAYIT side: one stack consumed by THREE
// layouts — the <1080 Kayıt tab panel, the ≥1080 rack (the rack IS Kayıt), and the archive body
// (where Kayıt is the whole body). Audit A4 rule: a section with nothing to show is ABSENT — no
// header, no section. Evidence always shows (three WO-level items are ever-present by model);
// the rest on presence.
//
// WO-0031f v6 rulings that shaped this list: the steps section DIED (the step list is Akış's own
// body — the spine); the timeline section DIED (Y-2 — "who did what when" lives in the ledger rows'
// timestamps and the step metas; the stored event stream is untouched, only the surface is gone);
// Kanıt sits at the TOP as the summary it is; Kaynaklar rides last (the yuva tablosu names no home
// for it — r2's absent rule gives it this one).
//
// WO-0031d tur-2: the Repolar section is GONE (D3 — the track state folds into Kanıt's chips);
// Belgeler never renders the ```steps fence raw — the prose shows and the steps become a card
// summary (A4, splitStepsFence).
import type { ReactNode } from 'react';
import { parsePlanSteps, splitStepsFence } from '../../../core/plan-steps';
import type { StepSpec, TrackId, WorkOrderDetailView } from '../../../core/types';
import { UI } from '../../data/labels';
import { AuditTable } from './AuditTable';
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

export function buildRecordSections({
  detail,
  docs,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
}): DetailSection[] {
  const sections: DetailSection[] = [];
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
  // The ledger rides the stack in every layout: the tab/rack forms for a live WO, and the archive
  // body — where this stack IS the body (DetailBody's archive branch renders it directly; the tab
  // and rack branches are unreachable for a closed WO, so the ledger never draws twice).
  if (detail.sessions.length > 0) {
    sections.push({
      id: 'audit',
      title: UI.auditTitle,
      aside: UI.auditSessions(detail.sessions.length),
      node: <AuditTable sessions={detail.sessions} steps={parsePlanSteps(docs.plan)} />,
    });
  }
  return sections;
}

/** The record's stacked form — the Kayıt tab panel, the ≥1080 rack, and the archive body all render
 *  this one stack. The id anchors the tab-selection scroll (tur-3, now `sec-evidence`/`sec-docs`/
 *  `sec-audit` — scroll-margin clears the pinned chrome). */
export function RecordStack({ sections }: { sections: DetailSection[] }) {
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
