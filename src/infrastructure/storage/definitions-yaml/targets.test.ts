// Tests for parseTarget and hashContent — the Phase 7 target grammar (rule I-95).
import { describe, expect, it } from 'vitest';

import { hashContent, parseTarget } from './targets';

describe('parseTarget', () => {
  it('I-95: accepts library/<kind>/<id>/v<N>.yaml for every versioned kind', () => {
    expect(parseTarget('library/roles/planner/v1.yaml')).toEqual({ kind: 'roles', id: 'planner', version: 1 });
    expect(parseTarget('library/flows/standard/v12.yaml')).toEqual({ kind: 'flows', id: 'standard', version: 12 });
    expect(parseTarget('library/capabilities/docs/v2.yaml')).toEqual({ kind: 'capabilities', id: 'docs', version: 2 });
    expect(parseTarget('library/memory/notes/v3.yaml')).toEqual({ kind: 'memory', id: 'notes', version: 3 });
  });

  it('I-95: accepts projects/<slug>/project.yaml, projects/<slug>/roadmap.yaml, repos/<slug>/repo.yaml and repos/<slug>/roadmap.yaml', () => {
    expect(parseTarget('projects/atolye/project.yaml')).toEqual({ kind: 'project' });
    expect(parseTarget('projects/atolye/roadmap.yaml')).toEqual({ kind: 'roadmap' });
    expect(parseTarget('repos/acme/repo.yaml')).toEqual({ kind: 'repo' });
    expect(parseTarget('repos/acme/roadmap.yaml')).toEqual({ kind: 'repo_roadmap' });
  });

  it('I-95: rejects absolute paths', () => {
    expect(parseTarget('/etc/passwd')).toBeUndefined();
    expect(parseTarget('/library/roles/planner/v1.yaml')).toBeUndefined();
  });

  it('I-95: rejects parent and current directory segments', () => {
    expect(parseTarget('../library/roles/planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('library/../roles/planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('./library/roles/planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('projects/../atolye/project.yaml')).toBeUndefined();
  });

  it('I-95: rejects backslash-separated targets', () => {
    expect(parseTarget('library\\roles\\planner\\v1.yaml')).toBeUndefined();
    expect(parseTarget('repos/acme\\repo.yaml')).toBeUndefined();
  });

  it('I-95: rejects other extensions and extension-less names', () => {
    expect(parseTarget('library/roles/planner/v1.yml')).toBeUndefined();
    expect(parseTarget('library/roles/planner/v1')).toBeUndefined();
    expect(parseTarget('library/roles/planner/v1.json')).toBeUndefined();
    expect(parseTarget('projects/atolye/project.yml')).toBeUndefined();
  });

  it('I-95: rejects deeper or shallower folders', () => {
    expect(parseTarget('library/roles/nested/planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('library/roles/v1.yaml')).toBeUndefined();
    expect(parseTarget('roles/planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('projects/atolye/nested/project.yaml')).toBeUndefined();
    expect(parseTarget('project.yaml')).toBeUndefined();
    expect(parseTarget('repo.yaml')).toBeUndefined();
    expect(parseTarget('roadmap.yaml')).toBeUndefined();
  });

  it('I-95: rejects upper case and non-slug segments', () => {
    expect(parseTarget('library/Roles/planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('library/roles/Planner/v1.yaml')).toBeUndefined();
    expect(parseTarget('projects/Atölye/project.yaml')).toBeUndefined();
    expect(parseTarget('repos/acme git/repo.yaml')).toBeUndefined();
  });

  it('I-95: rejects v0, leading-zero and fractional versions', () => {
    expect(parseTarget('library/roles/planner/v0.yaml')).toBeUndefined();
    expect(parseTarget('library/roles/planner/v01.yaml')).toBeUndefined();
    expect(parseTarget('library/roles/planner/v1.5.yaml')).toBeUndefined();
    expect(parseTarget('library/roles/planner/vx.yaml')).toBeUndefined();
  });

  it('I-95: rejects files the grammar does not name in their folders', () => {
    expect(parseTarget('projects/atolye/other.yaml')).toBeUndefined();
    expect(parseTarget('repos/acme/project.yaml')).toBeUndefined();
    expect(parseTarget('repos/acme/other.yaml')).toBeUndefined();
    expect(parseTarget('library/roles/planner/next.yaml')).toBeUndefined();
  });

  it('I-92: rejects repo-checkout or repo-side .docket paths — definitions are portable by bundle export/import, not git', () => {
    expect(parseTarget('.docket/repo.yaml')).toBeUndefined();
    expect(parseTarget('checkout/.docket/repo.yaml')).toBeUndefined();
    expect(parseTarget('repos/acme/.docket/repo.yaml')).toBeUndefined();
    expect(parseTarget('repos/acme/repo.yaml')).toEqual({ kind: 'repo' });
  });
});

describe('hashContent', () => {
  it('hashes distinct contents distinctly and equal contents equally', () => {
    expect(hashContent('a: 1')).toBe(hashContent('a: 1'));
    expect(hashContent('a: 1')).not.toBe(hashContent('a: 2'));
  });
});
