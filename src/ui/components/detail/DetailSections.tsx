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
import { stripUnfilledSections } from '../../../core/order-md';
import { splitStepsFence } from '../../../core/plan-steps';
import type { SessionRole, WorkOrderDetailView } from '../../../core/types';
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
    // 2026-08-23 (operator: "aynı tasarımı kullan"): the doc row is a CARD like the session
    // card — one enclosing border holds the toggle row AND the expansion (the well's top hairline
    // parts them). The old form bordered only the button and left the body hanging frameless.
    <div ref={rowRef} className="overflow-hidden rounded-md border border-hairline bg-surface">
      <button
        type="button"
        className="irow flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="shrink-0 text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-inkdim">{file}</span>
        {/* 2026-08-24 (operator: "0 lar gözükmesin"): a fence-only plan has no ## sections — a "0
            bölüm" count says nothing. The count draws only when there is one to count. */}
        {sectionCount > 0 ? <span className="ml-auto shrink-0 font-mono text-[10.5px] text-inkdim">{UI.docSections(sectionCount)}</span> : null}
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
  liveRow,
  liveSessionId,
  now,
  onGoLive,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  UI: Labels['UI'];
  /** WO-0039/C: the RUNNING drive's pointer card (meta + "▸ Canlı oturum") — the pane owns the
   *  live stream; the ledger marks it and jumps there. Card-level facts only (identity-stable,
   *  never per-line), so streaming never re-renders the record stack. */
  liveRow?: {
    role: SessionRole;
    name: { kind: 'plan' } | { kind: 'step'; idx: number; aim?: string } | { kind: 'review'; idx: number } | { kind: 'unscoped' };
    startedAt: number;
    costUsd: number;
  };
  /** WO-0039 stabilization (2026-08-23): the live drive's provider session id — the ledger row
   *  carrying it renders AS the pointer (one session, one card; kills the re-entry dupe of the
   *  running row card beside the appended pointer). */
  liveSessionId?: string;
  /** The controller's one-second ticker + the pointer's jump handler (the live card's duration
   *  ticks and its click lands on the live surface). */
  now?: number;
  onGoLive?: () => void;
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
          {/* 2026-08-23 (operator ruling): the ORDER view drops the creation template's unfilled
              skeleton sections (Context placeholder, bare Scope lists, empty Acceptance) — the
              document shows what exists. The count follows the view text, so it stays honest. */}
          {docs.order ? (
            <DocRow title={UI.docOrderLabel} file={UI.orderDoc} content={stripUnfilledSections(docs.order)} />
          ) : null}
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
  // reads its artifacts from it. WO-0039/C: a RUNNING drive's pointer card renders even with ZERO
  // persisted rows (the first plan run must not leave an empty ledger).
  if (detail.sessions.length > 0 || liveRow) {
    sections.push({
      id: 'audit',
      title: UI.auditTitle,
      // 2026-08-23 (operator): the count aside is dead — the cards are the count (the PLAN HAZIR
      // ruling, applied to the ledger's own heading).
      node: <SessionCards sessions={detail.sessions} steps={detail.steps} liveRow={liveRow} liveSessionId={liveSessionId} now={now} onGoLive={onGoLive} />,
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
