// DoneFold (WO-0049, mockup kare 02) — the collapsed chronological PAST at the top: `▸ 4 tamamlanan
// faz · f0 · f3 · …` + the summed evidence (WO + gözlenen para). The ClosedToggle idiom: a real
// <button aria-expanded> with the flipping arrow, the content beneath; ≥2 done fazlar folds (the
// parent decides — 1 done faz renders as a plain card, no fold, no noise).
import { useState, type ReactNode } from 'react';
import type { FazView } from '../../../core/roadmap';
import { useLabels } from '../../data/locale';

export function DoneFold({ done, children }: { done: FazView[]; children: ReactNode }) {
  const { UI } = useLabels();
  const [open, setOpen] = useState(false);
  const wo = done.reduce((s, f) => s + f.closedWoCount, 0);
  // The fold's money voice sums what the faz metas already showed — cent-rounded like the head.
  const usd = Math.round(done.reduce((s, f) => s + f.closedCostUsd, 0) * 100) / 100;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-donefold
        aria-expanded={open}
        className="donefold"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="n">{open ? '▾' : '▸'}</span>
        <span className="n">{UI.roadmapDoneFold(done.length)}</span>
        <span>{done.map((f) => f.id).join(' · ')}</span>
        <span className="ml-auto">{UI.roadmapDoneFoldMeta(wo, usd)}</span>
      </button>
      {open ? <div className="flex flex-col gap-2">{children}</div> : null}
    </div>
  );
}
