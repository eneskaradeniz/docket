// components/section-card.tsx — the screen's framing surface: one card per section, a mono
// uppercase header in the readout voice, and an action slot for the section's decision.
import type { ReactNode } from 'react';

export interface SectionCardProps {
  readonly title: string;
  /** The section's decision, rendered at the header's right edge (e.g. the start-stage button). */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function SectionCard({ title, action, children }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <header className="flex min-h-[38px] items-center justify-between gap-3 border-b border-hairline px-4 py-2">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-inkdim">{title}</h2>
        {action !== undefined ? action : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
