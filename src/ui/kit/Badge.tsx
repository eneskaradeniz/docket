// Badge — the kit's mono status chip (WO-0031): stage/status/role labels ride here. Tone maps to the
// lamp semantics; the label itself always comes from the call site (labels.ts — ADR-0007).
import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'signal' | 'proceed' | 'info' | 'error';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-hairline text-inkdim',
  signal: 'border-signal/50 text-signal bg-signal/10',
  proceed: 'border-proceed/50 text-proceed bg-proceed/10',
  info: 'border-info/50 text-info bg-info/10',
  error: 'border-error/50 text-error bg-error/10',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
