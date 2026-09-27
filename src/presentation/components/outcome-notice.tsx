// components/outcome-notice.tsx — how every intent result reaches the user (U-8): the mapped copy
// as a slim strip on the book's recessed band ground, its verdict carried by a colored glyph and
// edge; a failure additionally shows its raw code as selectable mono text so it can be copied by
// hand — the one place a code is user-visible by design.
import type { ReactNode } from 'react';

export interface OutcomeNoticeProps {
  readonly ok: boolean;
  readonly text: string;
  /** The failure code, shown only on failure (U-8: available for copying). */
  readonly code?: string;
}

export function OutcomeNotice({ ok, text, code }: OutcomeNoticeProps) {
  const edge = ok ? 'border-proceed/40' : 'border-error/40';
  const glyph = ok ? 'text-proceed' : 'text-error';
  const body: ReactNode = (
    <>
      <span className={`font-mono text-[11px] font-medium ${glyph}`}>{ok ? '✓' : '×'}</span>
      <span className="text-[13px] text-ink">{text}</span>
      {!ok && code !== undefined ? <code className="ml-auto select-all font-mono text-[11px] text-inkdim">{code}</code> : null}
    </>
  );
  return (
    <div role="status" className={`flex items-center gap-2.5 rounded-md border bg-band px-3 py-2 ${edge}`}>
      {body}
    </div>
  );
}
