// components/state-badge.tsx — a status pill in the console's instrument voice: mono, uppercase,
// one tinted hairline per tone. Purely presentational; the copy always arrives resolved.
import type { ReactNode } from 'react';

/** The five state hues the console speaks; every badge picks one, never a raw color. */
export type BadgeTone = 'dim' | 'signal' | 'proceed' | 'info' | 'error';

const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  dim: 'border-hairline text-inkdim',
  signal: 'border-signal/45 text-signal',
  proceed: 'border-proceed/45 text-proceed',
  info: 'border-info/45 text-info',
  error: 'border-error/45 text-error',
};

export interface StateBadgeProps {
  readonly tone: BadgeTone;
  readonly children: ReactNode;
}

export function StateBadge({ tone, children }: StateBadgeProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
