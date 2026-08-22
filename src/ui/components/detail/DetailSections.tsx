// RecordSections (WO-0031c / v4 → WO-0038 DOSYA) — the RECORD as sections of the ONE scroll (the
// Kayıt tab, the ≥1080 rack and the archive special-case all died with the dual view). Audit A4
// rule: a section with nothing to show is ABSENT.
//
// WO-0038 rulings: the KANIT section DIED as a standing showcase (operator, 2026-08-22) — evidence
// is contextual now: the close card carries the checklist at the decision moment, and a gated
// action states its reason then and there; the mechanism (core derivation, order.md's Evidence
// required) is untouched. Belgeler became COLLAPSED ROWS (the operator's wall-of-prose complaint):
// filename + one-line teaser + section count; expansion is the .repbody idiom, height-capped.
import { useRef, useState, type ReactNode } from 'react';
import { splitStepsFence } from '../../../core/plan-steps';
import type { WorkOrderDetailView } from '../../../core/types';
import type { Labels } from '../../data/labels';
import { useLabels } from '../../data/locale';
import { SessionCards } from './SessionCards';
import { SourceLinks } from './SourceLinks';
import { MarkdownBody } from './MarkdownBody';

export interface DetailSection {
  id: string;
  title: string;
  aside?: string;
  node: ReactNode;
}

/** WO-0038: a document is ONE COLLAPSED ROW (operator ruling — full prose rendered as a wall was
 *  the complaint); expansion is the .repbody idiom, height-capped. NO teaser line (operator,
 *  2026-08-22: the "first meaningful line" was `---` front-matter on order.md — a derived teaser is
 *  a guess, and a wrong guess is worse than none); the meta counts `## ` sections. The visible name
 *  is the HUMAN word (İş emri / Plan — operator: raw filenames are developer-speak); the filename
 *  stays as a dim mono pointer (the file lives in the repo and gets edited). Opening scrolls the
 *  row's header to the scroll's top — the same ruling the session cards took the same day. */
function DocRow({ title, file, content }: { title: string; file: string; content: string }) {
  const { UI } = useLabels();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next) requestAnimationFrame(() => rowRef.current?.scrollIntoView({ block: 'start' }));
  };
  const sectionCount = content.split('\n').filter((l) => l.startsWith('## ')).length;
  return (
    <div ref={rowRef}>
      <button
        type="button"
        className="irow flex w-full items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-left"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="shrink-0 text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-inkdim">{file}</span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-inkdim">{UI.docSections(sectionCount)}</span>
      </button>
      {open ? (
        <div className="repbody max-h-[320px] overflow-y-auto">
          <MarkdownBody content={content} />
        </div>
      ) : null}
    </div>
  );
}

// WO-0035: this is a plain builder, not a component — the words arrive as a parameter (the caller's
// useLabels() destructure), because a hook inside a useMemo callback would reorder hooks and go stale
// on a locale switch. `UI` rides the args; the body reads it exactly as before.
export function buildRecordSections({
  detail,
  docs,
  UI,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  UI: Labels['UI'];
}): DetailSection[] {
  const sections: DetailSection[] = [];
  if (docs.order || docs.plan) {
    // The plan doc renders its PROSE only — the steps live in the PlanSection rows (the same grammar
    // from proposal to done); the fence never renders raw (tur-2 A4).
    const planProse = docs.plan ? splitStepsFence(docs.plan).prose : undefined;
    sections.push({
      id: 'docs',
      title: UI.secDocs,
      node: (
        <div className="flex flex-col gap-1.5">
          {docs.order ? <DocRow title={UI.docOrderLabel} file={UI.orderDoc} content={docs.order} /> : null}
          {planProse ? <DocRow title={UI.docPlanLabel} file={UI.planDoc} content={planProse} /> : null}
        </div>
      ),
    });
  }
  if (detail.sources.length > 0) {
    sections.push({ id: 'sources', title: UI.secSources, node: <SourceLinks sources={detail.sources} /> });
  }
  // The ledger rides the stack — the session CARDS (artifact headline + aç/kapa terminal, WO-0038).
  // detail.steps (the full views — verdicts included) replaces the parsed fence: the card headline
  // reads its artifacts from it.
  if (detail.sessions.length > 0) {
    sections.push({
      id: 'audit',
      title: UI.auditTitle,
      aside: UI.auditSessions(detail.sessions.length),
      node: <SessionCards sessions={detail.sessions} steps={detail.steps} />,
    });
  }
  return sections;
}

/** The record's stacked form — sections of the one DOSYA scroll. The ids anchor deep links
 *  (scroll-margin clears the pinned chrome). */
export function RecordStack({ sections }: { sections: DetailSection[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      {sections.map((s) => (
        <section key={s.id} id={`sec-${s.id}`}>
          <h2 className="readout mb-2 flex items-baseline gap-2">
            {s.title}
            {s.aside ? <span className="font-mono text-inkdim/60">{s.aside}</span> : null}
          </h2>
          {s.node}
        </section>
      ))}
    </div>
  );
}
