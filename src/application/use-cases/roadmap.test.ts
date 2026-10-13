import { describe, expect, it } from 'vitest';

import type { PhaseSlug, ProjectSlug, RepoSlug } from '../../domain/index';
import { createFakeDefinitionStore, createFakeDeps } from '../ports/fakes';

import { loadRepoRoadmapsForProject, readProjectRoadmap, readRepoRoadmap } from './roadmap';

const project = 'atolye' as ProjectSlug;
const repo = 'docket' as RepoSlug;

const repoRoadmapJson = JSON.stringify({
  milestones: [{ id: 'm1', title: 'M1', state: 'open', source: { kind: 'local' } }],
  issues: [{ id: 'i1', title: 'I1', state: 'open', labels: [], source: { kind: 'local' } }],
});

describe('roadmap read helpers', () => {
  it('readProjectRoadmap returns not_found for an unknown project', async () => {
    const deps = createFakeDeps();
    expect(await readProjectRoadmap(deps, project)).toEqual({ ok: false, code: 'not_found' });
  });

  it('readRepoRoadmap returns not_found when the repo roadmap file is absent', async () => {
    const deps = createFakeDeps();
    expect(await readRepoRoadmap(deps, repo)).toEqual({ ok: false, code: 'not_found' });
  });

  it('readRepoRoadmap returns the validated repo roadmap', async () => {
    const definitions = createFakeDefinitionStore();
    definitions.seed(`repos/${repo}/roadmap.yaml`, repoRoadmapJson);
    const deps = createFakeDeps({ definitions });
    const read = await readRepoRoadmap(deps, repo);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.roadmap.repo).toBe(repo);
      expect(read.roadmap.milestones).toHaveLength(1);
    }
  });

  it('loadRepoRoadmapsForProject loads only referenced repos', async () => {
    const definitions = createFakeDefinitionStore();
    definitions.seed(`repos/${repo}/roadmap.yaml`, repoRoadmapJson);
    const deps = createFakeDeps({ definitions });
    const roadmaps = await loadRepoRoadmapsForProject(deps, {
      phases: [
        {
          id: 'p1' as PhaseSlug,
          name: 'P1',
          blockedBy: [],
          tasks: [],
          items: [{ kind: 'repo_item', ref: { repo, kind: 'issue', id: 'i1' } }],
        },
      ],
    });
    expect(roadmaps).toHaveLength(1);
    expect(roadmaps[0]?.repo).toBe(repo);
  });
});
