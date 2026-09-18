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

export function Badge({
  tone = 'neutral',
  children,
  caps = true,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  /** WO-0060: the appbar chip must opt OUT of the uppercase — "4s 12dk" would read "4S 12DK" and S
   *  is both saniye and saat. The default stays caps, so every existing call site is pixel-identical. */
  caps?: boolean;
  /** Escape hatch for one-off layout (the chip's icon gap) — the tone map stays the one truth. */
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-px font-mono text-[10px] font-medium tracking-wider',
        caps && 'uppercase',
        className,
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
