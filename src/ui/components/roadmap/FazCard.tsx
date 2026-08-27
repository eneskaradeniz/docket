// FazCard (WO-0049, mockup kare 01) — the work-order card's anatomy on the roadmap surface: a 3px
// status lamp on the left edge, `FAZ N` (mono — the id's own number, via fazLabel) + title + the
// status word + the faz meta (evidence: görev oranı, kapanan WO + gözlenen para, açık WO), the aim
// line, the 2px görev dolgusu (.hairline-progress — the detail band's step line, green at the task
// ratio), the Bloke line when bekliyor (notes verbatim; else derived from the blockers), the task
// rows, and the `+ görev ekle` tail (Ekle-only; legitimate on a blocked faz too — planning ahead).
import type { FazView } from '../../../core/roadmap';
import { cn } from '../../kit';
import { useLabels } from '../../data/locale';
import { TaskRow, type WoSpawnPrefill } from './TaskRow';
import type { WorkOrderId } from '../../../core/types';

const LAMP: Record<FazView['status'], string> = {
  tamam: 'lamp-done',
  kosuyor: 'lamp-run',
  bekliyor: 'lamp-signal',
  planli: 'lamp-idle',
};

export function FazCard({
  faz,
  allFazlar,
  siradakiTaskId,
  cardRef,
  onSpawn,
  onOpenWo,
  onAddTask,
}: {
  faz: FazView;
  allFazlar: FazView[];
  siradakiTaskId?: string;
  /** The strip's jump target — the screen registers the card element by faz id. */
  cardRef?: (el: HTMLDivElement | null) => void;
  onSpawn: (prefill: WoSpawnPrefill) => void;
  onOpenWo: (id: WorkOrderId) => void;
  /** `+ görev ekle` — opens the add dialog for THIS faz (Ekle-only editing, WO-0049). */
  onAddTask: (fazId: string) => void;
}) {
  const { FAZ_STATUS_LABELS, UI, fazLabel } = useLabels();
  const doneTasks = faz.tasks.filter((t) => t.status === 'tamam').length;
  const quiet = faz.status === 'bekliyor';
  const blockersNamed = faz.blockedBy
    .map((id) => `${fazLabel(id)} · ${allFazlar.find((f) => f.id === id)?.title ?? id}`)
    .join(' + ');

  return (
    <div
      data-faz-id={faz.id}
      ref={cardRef}
      className="flex w-full items-stretch overflow-hidden rounded-md border border-hairline bg-surface text-left shadow-sm"
    >
      <div className={`lamp ${LAMP[faz.status]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-inkdim">{fazLabel(faz.id)}</span>
          <span className="truncate text-[13.5px] font-semibold tracking-tight text-ink" title={faz.title}>
            {faz.title}
          </span>
          <span
            className={cn(
              'shrink-0 font-mono text-[10.5px] uppercase tracking-wider',
              faz.status === 'tamam' && 'text-proceed',
              faz.status === 'kosuyor' && 'text-info',
              faz.status === 'bekliyor' && 'text-signal',
              faz.status === 'planli' && 'text-inkdim',
            )}
          >
            {FAZ_STATUS_LABELS[faz.status]}
            {faz.status === 'bekliyor' && faz.blockedBy.length > 0 ? ` · ${faz.blockedBy.map(fazLabel).join(', ')}` : ''}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-inkdim">
            {UI.roadmapFazMeta(doneTasks, faz.tasks.length, faz.closedWoCount, faz.closedCostUsd, faz.openWoCount)}
          </span>
        </div>
        {faz.aim !== undefined ? <p className="text-[12px] text-inkdim">{faz.aim}</p> : null}
        <div className="hairline-progress" title={`${doneTasks}/${faz.tasks.length} görev`}>
          <div style={{ width: faz.tasks.length > 0 ? `${Math.round((doneTasks / faz.tasks.length) * 100)}%` : '0%' }} />
        </div>
        {faz.status === 'bekliyor' ? (
          <p className="bloke px-2.5 py-1.5 text-[12px] text-ink">
            <span className="mr-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-signal">
              {UI.roadmapBlokeWord}
            </span>
            {faz.notes !== undefined ? faz.notes : UI.roadmapBlokeFallback(blockersNamed)}
          </p>
        ) : null}
        <div className="mt-0.5 flex flex-col gap-1">
          {faz.tasks.map((t, i) => (
            <TaskRow
              key={t.id}
              task={t}
              faz={faz}
              ordinal={i + 1}
              siradaki={siradakiTaskId === t.id}
              quiet={quiet}
              onSpawn={onSpawn}
              onOpenWo={onOpenWo}
            />
          ))}
          <button
            type="button"
            data-task-add
            data-faz-id={faz.id}
            className="irow border border-transparent px-2.5 py-1 text-left font-mono text-[11px] text-inkdim"
            onClick={() => onAddTask(faz.id)}
          >
            {UI.roadmapTaskAdd}
          </button>
        </div>
      </div>
    </div>
  );
}
