// components/roadmap-repo-layer.tsx — repository roadmap layer (U-325): milestones, issues, subtasks.
import type { RoadmapPageView, RoadmapRepoView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import {
  repoPhaseLinkIndex,
  resolveIssuePhaseLink,
  resolveMilestonePhaseLink,
  type RepoPhaseLink,
} from '../stores/roadmap-phase-links';
import type { RepoRoadmapSlice, RoadmapRepoTab, RoadmapStore } from '../stores/roadmap';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-soft';
const CHIP = 'inline-flex h-5 flex-none items-center gap-1 rounded-control border px-1.5 font-mono text-[0.6875rem] leading-none';
const LINKED_CHIP = `${CHIP} border-bord text-ink`;

const fill = (text: string, vars: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(vars ?? {}).reduce((out, [name, value]) => out.split(`{${name}}`).join(value), text);

const PhaseBadge = ({
  link,
  locale,
  onJump,
}: {
  readonly link: RepoPhaseLink | undefined;
  readonly locale: Locale;
  readonly onJump: (phaseId: string) => void;
}) => {
  if (link === undefined) {
    return <span className={`${CHIP} border-hairline text-inkdim`}>{t(locale, 'roadmap.repo.phase.unlinked')}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onJump(link.phaseId)}
      title={link.phaseName}
      className={`${LINKED_CHIP} ${FOCUS}`}
    >
      {fill(t(locale, 'roadmap.repo.phase.prefix'), { name: link.phaseName })}
    </button>
  );
};

const IssueGlyph = ({ closed, locale }: { readonly closed: boolean; readonly locale: Locale }) => {
  if (closed) {
    return (
      <span
        aria-label={t(locale, 'roadmap.repo.state.closed')}
        className="grid h-[1.125rem] w-[1.125rem] flex-none place-items-center rounded-full bg-proceed font-mono text-[0.625rem] font-bold leading-none text-black"
      >
        ✓
      </span>
    );
  }
  return <span aria-label={t(locale, 'roadmap.repo.state.open')} className="h-[1.125rem] w-[1.125rem] flex-none rounded-full border border-bord" />;
};

const sourceChip = (
  locale: Locale,
  source: RoadmapRepoView['issues'][number]['source'],
): string => (source.kind === 'local' ? t(locale, 'roadmap.repo.source.local') : source.externalId);

const IssueRow = ({
  issue,
  subtasks,
  locale,
  expanded,
  link,
  store,
  onJumpPhase,
}: {
  readonly issue: RoadmapRepoView['issues'][number];
  readonly subtasks: readonly RoadmapRepoView['issues'][number][];
  readonly locale: Locale;
  readonly expanded: boolean;
  readonly link: RepoPhaseLink | undefined;
  readonly store: RoadmapStore;
  readonly onJumpPhase: (phaseId: string) => void;
}) => {
  const hasSubtasks = subtasks.length > 0;
  const title = (
    <span className={`min-w-0 flex-1 truncate ${issue.state === 'open' ? 'font-semibold text-ink' : 'text-ink'}`} title={issue.title}>
      {issue.title}
    </span>
  );
  const badges = (
    <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
      <span className={`${CHIP} border-hairline text-inkdim`}>{sourceChip(locale, issue.source)}</span>
      {issue.labels.map((label) => (
        <span key={label} className={`${CHIP} border-hairline text-inkdim`}>
          {label}
        </span>
      ))}
      <PhaseBadge link={link} locale={locale} onJump={onJumpPhase} />
    </div>
  );

  if (!hasSubtasks) {
    return (
      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-control px-2.5 py-1.5 text-[0.84375rem] hover:bg-raised">
        <IssueGlyph closed={issue.state === 'closed'} locale={locale} />
        {title}
        {badges}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t(locale, 'roadmap.repo.subtasks.toggle')}
        onClick={() => store.toggleRepoIssue(issue.id)}
        className={`flex min-h-10 w-full flex-wrap items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-[0.84375rem] hover:bg-raised ${FOCUS}`}
      >
        <span className="flex-none text-inkdim">{expanded ? '▾' : '▸'}</span>
        <IssueGlyph closed={issue.state === 'closed'} locale={locale} />
        {title}
        {badges}
      </button>
      {expanded ? (
        <div className="grid gap-0.5 pb-1 pl-8">
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex min-h-8 items-center gap-2 rounded-control px-2 text-[0.78125rem] text-inkdim">
              <IssueGlyph closed={sub.state === 'closed'} locale={locale} />
              <span className="min-w-0 flex-1 truncate" title={sub.title}>{sub.title}</span>
              <span className={`${CHIP} border-hairline`}>{t(locale, 'roadmap.repo.source.subtask')}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export interface RoadmapRepoLayerProps {
  readonly store: RoadmapStore;
  readonly locale: Locale;
  readonly projectView: RoadmapPageView;
  readonly repos: readonly RoadmapRepoTab[];
  readonly selectedRepo: string;
  readonly slice: RepoRoadmapSlice;
  readonly openMilestones: readonly string[];
  readonly expandedIssues: readonly string[];
}

export function RoadmapRepoLayer({
  store,
  locale,
  projectView,
  repos,
  selectedRepo,
  slice,
  openMilestones,
  expandedIssues,
}: RoadmapRepoLayerProps) {
  const phaseIndex = repoPhaseLinkIndex(projectView.phases, selectedRepo);
  const view = slice.view;

  if (slice.loading && view === null && slice.problem === null) {
    return (
      <div role="status" data-repo-roadmap-loading className="rounded-card border border-hairline bg-surface px-3 py-4">
        <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'roadmap.repo.loading')}</p>
        <ol aria-hidden="true" className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {[0, 1, 2].map((tile) => (
            <li key={tile} className="h-12 animate-pulse rounded-card border border-hairline bg-sunk" />
          ))}
        </ol>
      </div>
    );
  }

  if (slice.problem === 'not_found') {
    return (
      <div data-empty-card data-repo-no-roadmap className="rounded-card border border-hairline bg-surface px-4 py-6 text-center">
        <h2 className="m-0 text-[0.875rem] font-bold text-ink">{t(locale, 'roadmap.repo.noRoadmap.title')}</h2>
        <p className="m-0 mt-1 text-[0.8125rem] text-inkdim">{t(locale, 'roadmap.repo.noRoadmap.desc')}</p>
      </div>
    );
  }

  if (slice.problem !== null) {
    return (
      <div role="alert" data-repo-roadmap-error className="grid gap-2 rounded-card border border-error/40 bg-surface px-3 py-3">
        <div>
          <p className="m-0 text-[0.875rem] font-bold text-error">{t(locale, 'roadmap.repo.error.title')}</p>
          <p className="m-0 mt-1 text-[0.8125rem] text-inkdim">{t(locale, 'roadmap.repo.error.desc')}</p>
        </div>
        <button
          type="button"
          onClick={() => void store.loadRepo(selectedRepo)}
          className={`h-7 w-fit rounded-control border border-bord px-3 text-[0.78125rem] font-semibold text-ink hover:bg-raised ${FOCUS}`}
        >
          {t(locale, 'roadmap.repo.retry')}
        </button>
      </div>
    );
  }

  if (view === null) return null;

  const topLevel = view.issues.filter((issue) => issue.parent === undefined);
  const subtasksOf = (parentId: string): readonly RoadmapRepoView['issues'][number][] =>
    view.issues.filter((issue) => issue.parent === parentId);
  const unassigned = topLevel.filter((issue) => issue.milestone === undefined);
  const issuesOfMilestone = (milestoneId: string): readonly RoadmapRepoView['issues'][number][] =>
    topLevel.filter((issue) => issue.milestone === milestoneId);

  const isEmpty = view.milestones.length === 0 && topLevel.length === 0;
  if (isEmpty) {
    return (
      <div data-empty-card data-repo-roadmap-empty className="rounded-card border border-hairline bg-surface px-4 py-6 text-center">
        <h2 className="m-0 text-[0.875rem] font-bold text-ink">{t(locale, 'roadmap.repo.empty.title')}</h2>
        <p className="m-0 mt-1 text-[0.8125rem] text-inkdim">{t(locale, 'roadmap.repo.empty.desc')}</p>
      </div>
    );
  }

  const openIssues = topLevel.filter((issue) => issue.state === 'open');
  const linkedPhases = new Set<string>();
  for (const milestone of view.milestones) {
    const link = resolveMilestonePhaseLink(milestone.id, phaseIndex);
    if (link !== undefined) linkedPhases.add(link.phaseId);
  }
  for (const issue of topLevel) {
    const link = resolveIssuePhaseLink(issue, phaseIndex);
    if (link !== undefined) linkedPhases.add(link.phaseId);
  }

  const onJumpPhase = (phaseId: string): void => store.jumpToPhase(phaseId);

  return (
    <div className="grid gap-4" data-repo-roadmap>
      {repos.length > 1 ? (
        <div role="tablist" aria-label={t(locale, 'roadmap.repo.tabs.label')} className="flex flex-wrap gap-1.5">
          {repos.map((tab) => (
            <button
              key={tab.repo}
              type="button"
              role="tab"
              aria-selected={tab.repo === selectedRepo}
              onClick={() => store.selectRepo(tab.repo)}
              className={[
                'h-8 rounded-control border px-3 text-[0.8125rem] font-semibold',
                tab.repo === selectedRepo ? 'border-bord bg-raised text-ink' : 'border-hairline bg-surface text-inkdim hover:bg-raised',
                FOCUS,
              ].join(' ')}
            >
              {tab.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-card border border-hairline bg-surface" role="status">
        <div className="grid grid-cols-3 gap-3 px-3 py-3 text-[0.75rem]">
          <div>
            <p className="m-0 text-inkdim">{t(locale, 'roadmap.repo.summary.milestones')}</p>
            <p className="m-0 font-mono text-base text-ink">{view.milestones.length}</p>
          </div>
          <div>
            <p className="m-0 text-inkdim">{t(locale, 'roadmap.repo.summary.issues')}</p>
            <p className="m-0 font-mono text-base text-ink">
              {openIssues.length} / {topLevel.length}
            </p>
          </div>
          <div>
            <p className="m-0 text-inkdim">{t(locale, 'roadmap.repo.summary.linkedPhases')}</p>
            <p className="m-0 font-mono text-base text-ink">{linkedPhases.size}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(23.75rem,1fr))] gap-4">
        {view.milestones.map((milestone) => {
          const open = openMilestones.includes(milestone.id);
          const issues = issuesOfMilestone(milestone.id);
          const done = issues.filter((issue) => issue.state === 'closed').length;
          const msLink = resolveMilestonePhaseLink(milestone.id, phaseIndex);
          return (
            <section key={milestone.id} data-milestone={milestone.id} className="overflow-hidden rounded-card border border-hairline bg-surface">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => store.toggleMilestone(milestone.id)}
                className={`flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-raised ${FOCUS}`}
              >
                <span className="flex-none text-inkdim">{open ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem] font-bold text-ink">{milestone.title}</span>
                <span className={`${CHIP} border-hairline text-inkdim`}>{sourceChip(locale, milestone.source)}</span>
                <PhaseBadge link={msLink} locale={locale} onJump={onJumpPhase} />
                <span className="flex-none font-mono text-[0.6875rem] text-inkdim">
                  {done}/{issues.length}
                </span>
              </button>
              {open ? (
                <div className="border-t border-hairline px-1 pb-2">
                  {issues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      subtasks={subtasksOf(issue.id)}
                      locale={locale}
                      expanded={expandedIssues.includes(issue.id)}
                      link={resolveIssuePhaseLink(issue, phaseIndex)}
                      store={store}
                      onJumpPhase={onJumpPhase}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
        {unassigned.length > 0 ? (
          <section className="overflow-hidden rounded-card border border-hairline bg-surface">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[0.875rem] font-bold text-ink">{t(locale, 'roadmap.repo.unassigned.title')}</span>
              <span className="font-mono text-[0.6875rem] text-inkdim">0/{unassigned.length}</span>
            </div>
            <div className="border-t border-hairline px-1 pb-2">
              {unassigned.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  subtasks={subtasksOf(issue.id)}
                  locale={locale}
                  expanded={expandedIssues.includes(issue.id)}
                  link={resolveIssuePhaseLink(issue, phaseIndex)}
                  store={store}
                  onJumpPhase={onJumpPhase}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
