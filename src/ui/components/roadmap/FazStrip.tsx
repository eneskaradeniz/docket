// FazStrip (WO-0049, mockup kare 01/02) — the roadmap's minimap: one segment per faz in its status
// color (tamam green · kosuyor blue, breathing · bekliyor semi-transparent amber · planli hairline),
// the whole order visible at a glance. A segment's title names `FAZ N · Title — Status`; click
// scrolls to that faz's card (the screen owns the jump; reduced-motion gets the instant jump).
import type { FazView } from '../../../core/roadmap';
import { useLabels } from '../../data/locale';

export function FazStrip({ fazlar, onJump }: { fazlar: FazView[]; onJump: (fazId: string) => void }) {
  const { FAZ_STATUS_LABELS, UI, fazLabel } = useLabels();
  if (fazlar.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="fazstrip" role="group" aria-label={UI.roadmapStripLine}>
        {fazlar.map((f) => (
          <button
            key={f.id}
            type="button"
            data-faz-seg
            data-faz-id={f.id}
            className={`fseg fseg-${f.status}`}
            title={`${fazLabel(f.id)} · ${f.title} — ${FAZ_STATUS_LABELS[f.status]}`}
            aria-label={`${fazLabel(f.id)} · ${f.title} — ${FAZ_STATUS_LABELS[f.status]}`}
            onClick={() => onJump(f.id)}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] text-inkdim">{UI.roadmapStripLine}</span>
    </div>
  );
}
