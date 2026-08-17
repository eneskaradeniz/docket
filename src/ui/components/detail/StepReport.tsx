import { useEffect, useState } from 'react';
import type { StepView } from '../../../core/types';
import { UI } from '../../data/labels';
import { MarkdownBody } from './MarkdownBody';

// A step's report (WO-0017). The report body lives in the decision store (reports/step-NN-<role>.md) and is
// read at view time — never cached in the DB (ADR-0010). Fetched lazily only when the operator opens a done
// step. The load is async (IPC over SQLite/fs); until it resolves we show the loading copy, and an empty body
// (the report file is absent — step not actually run) shows the missing copy.
export function StepReport({
  step,
  loadReport,
  onClose,
}: {
  step: StepView;
  loadReport: () => Promise<string>;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    loadReport().then((b) => {
      if (!cancelled) setBody(b);
    });
    return () => {
      cancelled = true;
    };
  }, [loadReport]);

  return (
    <section className="overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">
          {UI.stepReportTitle} · {step.idx}
        </h2>
        <button type="button" onClick={onClose} aria-label={UI.close} className="ibtn ml-auto text-[14px]">
          ✕
        </button>
      </header>
      {body === null ? (
        <p className="text-xs text-inkdim">{UI.loading}</p>
      ) : body.trim() ? (
        <MarkdownBody content={body} />
      ) : (
        <p className="text-xs text-inkdim">{UI.stepReportMissing}</p>
      )}
    </section>
  );
}
