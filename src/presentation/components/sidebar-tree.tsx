// components/sidebar-tree.tsx — the sidebar's project → repo tree (U-15). A multi-repo project
// renders a chevron plus its row and a collapsible repo list; a project that is one repo renders
// a single flat row that opens that repo's board. The status dot mirrors the item's most urgent
// state, the pill its total active work orders — absent at zero (U-10) — and ★ marks the main
// repo, which opens its board like any other repo row. Selection states come from the store's
// derivation, not from this component.
import { useSyncExternalStore } from 'react';

import type { ProjectTreeItem, RepoNode } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import {
  orderTree,
  pillCount,
  projectRows,
  type ProjectTreeStore,
  type TreeSelection,
} from '../stores/project-tree';
import { ACTIVE_CLASS, ACTIVE_SOFT_CLASS } from './active-state';
import { SIDEBAR_HEADER_BUTTON } from './sidebar-header-button';
import { Skeleton, SkeletonReveal, SkeletonStyle, useSkeleton } from './skeleton';

export interface SidebarTreeProps {
  readonly store: ProjectTreeStore;
  readonly selection: TreeSelection;
  readonly locale: Locale;
  /** A project row's target: the roadmap. */
  readonly onOpenProject: (project: string) => void;
  /** A repo row's target — the ★ row included: that repo's board. */
  readonly onOpenRepo: (project: string, repo: string) => void;
  /** The header's "+": the Yeni proje page (U-40). */
  readonly onNewProject: () => void;
}

const DOT_CLASS: Readonly<Record<RepoNode['status'], string>> = {
  running: 'bg-proceed',
  waiting: 'bg-signal',
  idle: 'border border-bord bg-transparent',
};

const dot = (status: RepoNode['status']): string =>
  `h-2 w-2 flex-none rounded-full ${DOT_CLASS[status]}`;

/** The count pill: a bordered mono capsule, brighter on a selected row, absent at zero. */
const pill = (count: number | null, selected: boolean): string => {
  if (count === null) return '';
  const tone = selected ? 'border-bord text-ink' : 'border-hairline text-inkdim';
  return `inline-flex h-[18px] min-w-5 flex-none items-center justify-center rounded-full border px-1.5 font-mono text-[11px] ${tone}`;
};

/** A row's standing grammar: the active row carries the one active-state language, a project
 *  whose repo is active carries its soft variant (psel), the rest stay quiet. */
const rowState = (state: 'sel' | 'psel' | null): string => {
  if (state === 'sel') return ACTIVE_CLASS;
  if (state === 'psel') return ACTIVE_SOFT_CLASS;
  return '';
};

const Chevron = ({ open }: { readonly open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`h-2.5 w-2.5 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const SortIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block h-3 w-3">
    <path d="m21 16-4 4-4-4" />
    <path d="M17 20V4" />
    <path d="m3 8 4-4 4 4" />
    <path d="M7 4v16" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="block h-3 w-3">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

/** The empty projects box's folder (U-51): a quiet outline glyph, the box's one ornament. */
const FolderIcon = () => (
  <svg
    data-folder-icon=""
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="block h-5 w-5 text-inkdim"
  >
    <path d="M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-2.5H4a1 1 0 0 0-1 1Z" />
  </svg>
);

const ProjectRow = ({
  item,
  state,
  onOpen,
}: {
  readonly item: ProjectTreeItem;
  readonly state: 'sel' | 'psel' | null;
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    onClick={onOpen}
    className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 text-left text-[13.5px] text-ink hover:bg-raised ${rowState(state)}`}
  >
    <span aria-hidden="true" className={dot(item.status)} />
    <span title={item.name} className="min-w-0 flex-1 truncate">
      {item.name}
    </span>
    {pillCount(item.active) !== null ? (
      <span className={pill(item.active, state !== null)}>{item.active}</span>
    ) : null}
  </button>
);

const RepoRow = ({
  node,
  selected,
  onOpen,
}: {
  readonly node: RepoNode;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    onClick={onOpen}
    aria-current={selected ? 'true' : undefined}
    className={`flex h-7 min-w-0 w-full items-center gap-2 rounded-control px-2.5 text-left text-[13.5px] text-ink hover:bg-raised ${rowState(selected ? 'sel' : null)}`}
  >
    <span aria-hidden="true" className={dot(node.status)} />
    <span title={node.name} className="min-w-0 flex-1 truncate">
      {node.name}
    </span>
    {node.main ? (
      <span title={node.name} aria-label={node.name} className="flex-none text-[10px] text-signal">
        ★
      </span>
    ) : null}
    {pillCount(node.active) !== null ? (
      <span className="inline-flex h-4 min-w-[18px] flex-none items-center justify-center rounded-full border px-1.5 font-mono text-[10px] text-inkdim">
        {node.active}
      </span>
    ) : null}
  </button>
);

/** One project row's shape as a placeholder: the row's own height and padding, a lamp, a name
 *  bar, a count pill — the same grammar the real rows render in (U-26). */
const TreeRowSkeleton = () => (
  <div className="flex h-8 items-center gap-2 rounded-control px-2.5">
    <Skeleton radius="full" width="8px" height="8px" />
    <Skeleton radius="control" width="52%" height="15px" />
    <Skeleton radius="full" width="20px" height="18px" className="ml-auto" />
  </div>
);

export function SidebarTree({ store, selection, locale, onOpenProject, onOpenRepo, onNewProject }: SidebarTreeProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const rows = projectRows(orderTree(state.tree, state.sort, state.usedAt));
  // Only a tree with nothing to show can carry a skeleton (U-26); a re-query over the standing
  // rows never replaces them.
  const { skeleton, reveal } = useSkeleton(state.loading && state.tree.length === 0, () => Date.now());

  return (
    <>
      {/* Like the Hesaplar header, the row's height is its 22px buttons plus the symmetric py-1 —
          no fixed height, so the label stays centred on the buttons' own geometry. The header
          itself holds the section's 14 px/700 scale (U-51). */}
      <div className="mb-1.5 mt-3.5 flex flex-none items-center gap-1 py-1 pl-2 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-inkdim">
          {t(locale, 'nav.projects')}
        </span>
        <button
          type="button"
          onClick={() => store.cycleSort()}
          aria-label={t(locale, 'nav.projects.sort')}
          title={t(locale, 'nav.projects.sort')}
          className={SIDEBAR_HEADER_BUTTON}
        >
          <SortIcon />
        </button>
        <button
          type="button"
          onClick={onNewProject}
          aria-label={t(locale, 'nav.projects.new')}
          title={t(locale, 'nav.projects.new')}
          className={SIDEBAR_HEADER_BUTTON}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={skeleton ? 'true' : undefined}>
        {skeleton ? (
          <div data-skeleton="" className="grid py-1">
            <SkeletonStyle />
            {[0, 1, 2, 3, 4].map((row) => (
              <TreeRowSkeleton key={row} />
            ))}
          </div>
        ) : state.tree.length === 0 ? (
          /* No project yet: the centred dashed box (U-51) — folder, the standing line, and the
             secondary button that opens the U-40 page. */
          <div className="my-1 grid justify-items-center gap-1.5 rounded-card border-[1.5px] border-dashed border-bord px-2 pb-2 pt-2.5 text-center">
            <FolderIcon />
            <p className="text-[12.5px] leading-snug text-inkdim">{t(locale, 'nav.projects.empty')}</p>
            <button
              type="button"
              onClick={onNewProject}
              className="flex items-center gap-1.5 rounded-control border border-hairline px-2.5 py-1 text-[12.5px] font-semibold text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
            >
              <PlusIcon />
              {t(locale, 'nav.projects.new')}
            </button>
          </div>
        ) : (
          <SkeletonReveal active={reveal}>
            {rows.map((row) =>
            row.kind === 'flat' ? (
              <ProjectRow
                key={row.item.project}
                item={row.item}
                state={selection.project?.id === row.item.project ? selection.project.state : null}
                onOpen={() => {
                  store.recordUse(row.item.project);
                  if (row.repo !== null) onOpenRepo(row.item.project, row.repo);
                }}
              />
            ) : (
              <div key={row.item.project}>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => store.toggle(row.item.project)}
                    aria-label={t(locale, 'tree.open')}
                    aria-expanded={state.expanded.includes(row.item.project)}
                    title={t(locale, 'tree.open')}
                    className="grid h-8 w-5 flex-none place-items-center rounded-control text-inkdim hover:text-ink"
                  >
                    <Chevron open={state.expanded.includes(row.item.project)} />
                  </button>
                  <ProjectRow
                    item={row.item}
                    state={selection.project?.id === row.item.project ? selection.project.state : null}
                    onOpen={() => {
                      store.recordUse(row.item.project);
                      onOpenProject(row.item.project);
                    }}
                  />
                </div>
                <div
                  className={`grid pl-5 transition-all duration-200 ${
                    state.expanded.includes(row.item.project) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {row.item.repos.map((node) => (
                      <RepoRow
                        key={node.repo}
                        node={node}
                        selected={selection.repo === node.repo}
                        onOpen={() => {
                          store.recordUse(row.item.project);
                          onOpenRepo(row.item.project, node.repo);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ),
          )}
          </SkeletonReveal>
        )}
      </div>
    </>
  );
}
