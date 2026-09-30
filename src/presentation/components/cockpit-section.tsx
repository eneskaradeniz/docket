// components/cockpit-section.tsx — a foldable cockpit section: the heading is the disclosure (a
// chevron, the title, a count) and an optional action rides its right edge while the section is
// open. Folding animates the body's height with the shell's motion numbers; under
// prefers-reduced-motion it just switches. Senden bekleyenler does not use this — it never folds.
import type { ReactNode } from 'react';
import { MOTION } from './motion';

export interface CockpitSectionProps {
  readonly title: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Shown on the heading's right edge while the section is open (e.g. "show all"). */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function CockpitSection({ title, count, open, onToggle, action, children }: CockpitSectionProps) {
  return (
    <section className="grid">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-[13px] font-semibold text-ink">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="-ml-1.5 flex items-center gap-1.5 rounded-control px-1.5 py-0.5 transition-colors hover:bg-raised"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className={`h-3 w-3 flex-none text-inkdim motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}
              style={{ transitionDuration: `${MOTION.results.fadeMs}ms` }}
            >
              <path d="M4 2.5 8 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {title}
          </button>
        </h2>
        <span className="min-w-5 rounded-full bg-raised px-1.5 text-center font-mono text-[11px] leading-[18px] text-inkdim">{count}</span>
        {open && action !== undefined ? <span className="ml-auto">{action}</span> : null}
      </div>
      <div
        className={`grid motion-safe:transition-[grid-template-rows] ${open ? 'mt-2 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        style={{ transitionDuration: `${MOTION.results.heightMs}ms` }}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
