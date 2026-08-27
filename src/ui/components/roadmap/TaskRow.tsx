// TaskRow (WO-0049, mockup kare 01) — one task of a faz card: the status GLYPH (✓ ○ ► — the word
// stays home; evidence lines carry the tail), the title, the repo slug (mono; error tone when the
// slug resolves nowhere — that IS the row's repo_yok reason), and the tail: `N WO kapandı` /
// the open-WO chip (click → detail) / ▸ İş emri aç. The spawn action is ABSENT when unavailable
// (ADR-0001) — the reason rides the row itself: kosuyor → the chip tail; bloke → the faz's Bloke
// line; repo_yok → the red slug. `sıradaki` is the derived first-spawnable marker (pure derivation,
// written nowhere) as a signal Badge. BEKLİYOR faz rows render quiet (flatter surface + dim title —
// the WorkOrderCard `quiet` technique; NOT opacity, which fails AA on 12px text).
import type { WorkOrderId } from '../../../core/types';
import type { FazView, TaskView } from '../../../core/roadmap';
import { Badge, cn } from '../../kit';
import { useLabels } from '../../data/locale';

/** The spawn dialog's data seed (mockup kare 06) — data only, no display strings. */
export interface WoSpawnPrefill {
  fazId: string;
  taskId: string;
  ordinal: number; // 1-based — the context line's "GÖREV K"
  title: string;
  note?: string;
  repo?: string;
}

export function TaskRow({
  task,
  faz,
  ordinal,
  siradaki,
  quiet,
  onSpawn,
  onOpenWo,
}: {
  task: TaskView;
  faz: FazView;
  ordinal: number;
  siradaki: boolean;
  quiet: boolean;
  onSpawn: (prefill: WoSpawnPrefill) => void;
  onOpenWo: (id: WorkOrderId) => void;
}) {
  const { FAZ_STATUS_LABELS, UI, woIdLabel } = useLabels();
  const glyph = task.status === 'tamam' ? '✓' : task.status === 'kosuyor' ? '►' : '○';
  const glyphTone = task.status === 'tamam' ? 'text-proceed' : task.status === 'kosuyor' ? 'text-info' : 'text-inkdim';
  // openWoIds are branded in the view (core/roadmap) — the chip opens the detail with no boundary
  // cast anywhere (ADR-0003); the multi-chip opens the FIRST, deterministically.
  const firstOpenId = task.openWoIds[0];

  return (
    <div
      data-task-row
      data-task-id={task.id}
      className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5', quiet ? 'border-transparent bg-bg' : 'border-hairline bg-surface')}
    >
      <span aria-hidden="true" className={cn('w-3 shrink-0 text-center font-mono text-[11px]', glyphTone)}>
        {glyph}
      </span>
      <span className={cn('truncate text-[13px]', quiet ? 'text-inkdim' : 'text-ink')} title={task.title}>
        {task.title}
      </span>
      {siradaki ? <Badge tone="signal">{UI.roadmapNextTag}</Badge> : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {task.repo !== undefined ? (
          <span
            className={cn('font-mono text-[10.5px]', task.spawn.available === false && task.spawn.reason === 'repo_yok' ? 'text-error' : 'text-inkdim')}
          >
            {task.repo}
          </span>
        ) : null}
        {task.status === 'tamam' && task.closedWoCount > 0 ? (
          <span className="font-mono text-[11px] text-inkdim">{UI.roadmapTaskClosedTail(task.closedWoCount)}</span>
        ) : null}
        {task.status === 'kosuyor' && firstOpenId !== undefined ? (
          // Deterministic: the multi-chip opens the FIRST open WO (the ledger is one click away
          // from there; the roadmap is not a WO browser).
          <button
            type="button"
            data-task-wo
            className="ichip rounded px-1.5 py-0.5 font-mono text-[10.5px] text-info"
            onClick={() => onOpenWo(firstOpenId)}
          >
            {task.openWoIds.length === 1 ? woIdLabel(firstOpenId) : UI.roadmapTaskOpenMulti(task.openWoIds.length)}
          </button>
        ) : null}
        {task.spawn.available ? (
          <button
            type="button"
            data-task-spawn
            className="alink text-[11px] uppercase tracking-wider"
            onClick={() =>
              onSpawn({
                fazId: faz.id,
                taskId: task.id,
                ordinal,
                title: task.title,
                ...(task.note !== undefined ? { note: task.note } : {}),
                ...(task.repo !== undefined ? { repo: task.repo } : {}),
              })
            }
          >
            ▸ {UI.roadmapTaskSpawn}
          </button>
        ) : null}
      </span>
      <span className="sr-only">{FAZ_STATUS_LABELS[task.status]}</span>
    </div>
  );
}
