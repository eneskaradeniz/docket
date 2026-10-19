// screens/board.tsx — the repo board screen (U-3's window, U-18's grammar): the header names the
// repo (with the shortcut that edits the project in Settings), the icon-only view segment, the
// roadmap shortcut and the create intent; the Kanban view is components/board-kanban.tsx — the
// flow's stages as columns with the done work as the last one. A card click opens the work order
// in place (K-8:A) — no drag, no hover preview. The list view is components/board-list.tsx — one
// flow, rows grouped by stage; the Kanban ⇄ Liste choice persists per repo. A failed board query
// shows the repo-problem state, never an empty board.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { BoardKanban } from '../components/board-kanban';
import { BoardList } from '../components/board-list';
import { KanbanIcon, ListIcon, PencilIcon } from '../components/board-icons';
import { boardMotionVars } from '../components/motion';
import { NewWorkOrderWindow } from '../components/new-work-order-window';
import { BoardSkeleton } from '../components/board-skeleton';
import { SkeletonReveal, useSkeleton } from '../components/skeleton';
import type { BoardStore } from '../stores/board';
import { kanbanColumns, listGroups } from '../stores/board';
import { failureKey } from '../stores/results';
import { boardFlowChoices, focusTarget, pinnedFlowFromColumns } from '../stores/work-order-window';

export interface BoardScreenProps {
  readonly store: BoardStore;
  readonly repo: string;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  /** The owning project's id when the project is single-repo — the header's roadmap shortcut
   *  (U-15); a multi-repo project reaches its roadmap from the tree and the cockpit card. */
  readonly roadmapProject: string | null;
  readonly onOpenRoadmap: (project: string) => void;
  readonly onOpenSettings: () => void;
  /** The owning project's id for the dialog's describe launcher; null when no project owns the repo. */
  readonly launchProject?: string | null;
  /** The owning project's name, shown read-only in the new-work-order window. */
  readonly projectName: string;
}

export function BoardScreen({ store, repo, locale, onOpenWorkOrder, roadmapProject, onOpenRoadmap, onOpenSettings, launchProject = null, projectName }: BoardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(repo);
  }, [store, repo]);
  // The skeletons' anti-flicker gate (U-26): only a board without a view and without a problem
  // stands to gain one — a reload over the standing board or a repo problem never blanks it.
  const { skeleton, reveal } = useSkeleton(state.loading && state.view === null && state.problem === null, () => Date.now());

  const [createOpen, setCreateOpen] = useState(false);
  const [focusTitle, setFocusTitle] = useState<string | null>(null);
  const view = state.view;

  // After a successful create the new card takes focus once the refreshed board lists it.
  useEffect(() => {
    if (focusTitle === null || view === null) return;
    const cards = [...view.columns.flatMap((column) => column.workOrders), ...view.done];
    if (focusTarget(focusTitle, cards) === null) return;
    const nodes = document.querySelectorAll<HTMLElement>('[data-board-card], [data-list-row]');
    for (const node of nodes) {
      if ((node.textContent ?? '').includes(focusTitle)) {
        node.focus();
        setFocusTitle(null);
        return;
      }
    }
  }, [focusTitle, view, state.viewMode]);

  const columns = view === null ? [] : kanbanColumns(view, state.columnOverrides);
  const groups = view === null ? [] : listGroups(view, state.groupOverrides);

  const activeWorkOrderCount = (view?.columns ?? [])
    .filter((c) => c.stage !== 'done')
    .reduce((sum, c) => sum + ((c as unknown as { cards?: readonly unknown[] }).cards ?? c.workOrders).length, 0);

  return (
    <>
    <div
      style={boardMotionVars()}
      className="flex h-full min-h-0 flex-col gap-[18px]"
    >
      <header className="flex flex-none flex-wrap items-center gap-3">
        <h1 className="truncate font-mono text-[15px] font-bold tracking-tight text-ink">{repo}</h1>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t(locale, 'board.editProject')}
          title={t(locale, 'board.editProject.title')}
          className="grid h-7 w-7 flex-none place-items-center rounded-control border border-bord text-inkdim outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:border-signal-soft"
        >
          <PencilIcon />
        </button>
        <span className="flex-1" />
        <span role="group" aria-label={t(locale, 'board.view.aria')} className="inline-flex overflow-hidden rounded-control border border-bord">
          {(['kanban', 'liste'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => store.setViewMode(repo, mode)}
              aria-pressed={state.viewMode === mode}
              aria-label={t(locale, mode === 'kanban' ? 'board.view.kanban' : 'board.view.liste')}
              title={t(locale, mode === 'kanban' ? 'board.view.kanban' : 'board.view.liste')}
              className={`grid h-7 w-8 place-items-center outline-none transition-colors focus-visible:shadow-[inset_0_0_0_1px_var(--signal-soft)] ${mode === 'liste' ? 'border-l border-bord' : ''} ${
                state.viewMode === mode ? 'bg-raised text-ink' : 'text-inkdim hover:text-ink'
              }`}
            >
              {mode === 'kanban' ? <KanbanIcon /> : <ListIcon />}
            </button>
          ))}
        </span>
        {roadmapProject !== null ? (
          <ActionButton onClick={() => onOpenRoadmap(roadmapProject)} title={t(locale, 'board.roadmap.title')}>
            {t(locale, 'board.roadmap')}
          </ActionButton>
        ) : null}
        <ActionButton variant="primary" onClick={() => setCreateOpen(true)}>
          {t(locale, 'board.new')}
        </ActionButton>
      </header>

      {skeleton ? <BoardSkeleton mode={state.viewMode} locale={locale} /> : null}

      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {!skeleton && view !== null && state.viewMode === 'kanban' ? (
        <SkeletonReveal active={reveal} className="flex min-h-0 flex-1 flex-col">
          <BoardKanban
            columns={columns}
            locale={locale}
            onOpenWorkOrder={onOpenWorkOrder}
            onToggleColumn={(key) => store.toggleColumn(repo, key)}
          />
        </SkeletonReveal>
      ) : null}

      {!skeleton && view !== null && state.viewMode === 'liste' ? (
        <SkeletonReveal active={reveal} className="flex min-h-0 flex-1 flex-col">
          <BoardList
            groups={groups}
            locale={locale}
            onOpenWorkOrder={onOpenWorkOrder}
            onToggleGroup={(key) => store.toggleGroup(repo, key)}
          />
        </SkeletonReveal>
      ) : null}
    </div>
    <NewWorkOrderWindow
      open={createOpen}
      locale={locale}
      projectName={projectName}
      flows={boardFlowChoices(view?.flow ?? null)}
      pinnedFlow={
        view === null
          ? null
          : pinnedFlowFromColumns(view.flow, 1, view.columns.map((column) => ({ stage: column.stage, name: column.name })))
      }
      skipProposal={null}
      launchProject={launchProject}
      activeWorkOrderCount={activeWorkOrderCount}
      onClose={() => setCreateOpen(false)}
      onCreated={setFocusTitle}
      onCreate={(intent) =>
        store.createFromWindow({
          title: intent.title,
          description: intent.description,
          flow: intent.flow,
          mode: intent.mode,
          skipProposal: intent.skipProposal,
          skipDecision: intent.skipDecision,
        })
      }
    />
    </>
  );
}
