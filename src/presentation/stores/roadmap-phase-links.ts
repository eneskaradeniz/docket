// stores/roadmap-phase-links.ts — maps repo milestones and issues to project phases (R-137, U-325).
import type { RoadmapPageView, RoadmapRepoView } from '../../api/queries';

export interface RepoPhaseLink {
  readonly phaseId: string;
  readonly phaseName: string;
}

const itemKey = (kind: 'milestone' | 'issue', id: string): string => `${kind}:${id}`;

/** Direct refs from each phase's `items` for one repository. */
export const repoPhaseLinkIndex = (
  phases: RoadmapPageView['phases'],
  repo: string,
): ReadonlyMap<string, RepoPhaseLink> => {
  const out = new Map<string, RepoPhaseLink>();
  for (const phase of phases) {
    for (const item of phase.items ?? []) {
      if (item.kind !== 'repo_item' || item.ref.repo !== repo) continue;
      out.set(itemKey(item.ref.kind, item.ref.id), { phaseId: phase.id, phaseName: phase.name });
    }
  }
  return out;
};

/** Milestone-linked phases propagate to top-level issues under that milestone. */
export const resolveIssuePhaseLink = (
  issue: RoadmapRepoView['issues'][number],
  index: ReadonlyMap<string, RepoPhaseLink>,
): RepoPhaseLink | undefined => {
  const direct = index.get(itemKey('issue', issue.id));
  if (direct !== undefined) return direct;
  if (issue.milestone === undefined) return undefined;
  return index.get(itemKey('milestone', issue.milestone));
};

export const resolveMilestonePhaseLink = (
  milestoneId: string,
  index: ReadonlyMap<string, RepoPhaseLink>,
): RepoPhaseLink | undefined => index.get(itemKey('milestone', milestoneId));
