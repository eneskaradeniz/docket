// Tests for parseTarget and hashContent (rule I-11).
import { describe, expect, it } from 'vitest';

import type { DefinitionScope } from '../../../application/index';

import { hashContent, parseTarget } from './targets';

const slug = (s: string) => s as never;

const GLOBAL: DefinitionScope = { kind: 'global' };
const PROJECT: DefinitionScope = { kind: 'project', project: slug('atolye') };
const REPO: DefinitionScope = { kind: 'repo', repo: slug('acme') };

describe('parseTarget', () => {
  it('I-11: accepts roles|flows|capabilities/<slug>.yaml in every scope', () => {
    for (const scope of [GLOBAL, PROJECT, REPO]) {
      expect(parseTarget(scope, 'roles/planner.yaml')).toEqual({ kind: 'roles', id: 'planner' });
      expect(parseTarget(scope, 'flows/standard.yaml')).toEqual({ kind: 'flows', id: 'standard' });
      expect(parseTarget(scope, 'capabilities/docs.yaml')).toEqual({ kind: 'capabilities', id: 'docs' });
    }
  });

  it('I-11: accepts project.yaml and roadmap.yaml in the project scope only', () => {
    expect(parseTarget(PROJECT, 'project.yaml')).toEqual({ kind: 'project' });
    expect(parseTarget(PROJECT, 'roadmap.yaml')).toEqual({ kind: 'roadmap' });
    expect(parseTarget(GLOBAL, 'project.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roadmap.yaml')).toBeUndefined();
    expect(parseTarget(REPO, 'project.yaml')).toBeUndefined();
    expect(parseTarget(REPO, 'roadmap.yaml')).toBeUndefined();
  });

  it('I-11: accepts repo.yaml in the repo scope only', () => {
    expect(parseTarget(REPO, 'repo.yaml')).toEqual({ kind: 'repo' });
    expect(parseTarget(GLOBAL, 'repo.yaml')).toBeUndefined();
    expect(parseTarget(PROJECT, 'repo.yaml')).toBeUndefined();
  });

  it('I-11: rejects absolute paths', () => {
    expect(parseTarget(GLOBAL, '/etc/passwd')).toBeUndefined();
    expect(parseTarget(REPO, '/etc/passwd')).toBeUndefined();
  });

  it('I-11: rejects parent and current directory segments', () => {
    expect(parseTarget(GLOBAL, '../roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO, 'roles/../planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, './roles/planner.yaml')).toBeUndefined();
  });

  it('I-11: rejects backslash-separated targets', () => {
    expect(parseTarget(REPO, 'roles\\planner.yaml')).toBeUndefined();
  });

  it('I-11: rejects other extensions and extension-less names', () => {
    expect(parseTarget(GLOBAL, 'roles/planner.yml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roles/planner')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roles/planner.json')).toBeUndefined();
  });

  it('I-11: rejects deeper folders and folder-less file names', () => {
    expect(parseTarget(GLOBAL, 'roles/nested/planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roadmap.yaml.zip')).toBeUndefined();
  });

  it('I-11: rejects upper-case folder names, stems and extensions', () => {
    expect(parseTarget(GLOBAL, 'Roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roles/Planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roles/planner.YAML')).toBeUndefined();
  });

  it('I-11: rejects stems outside the domain slug pattern', () => {
    expect(parseTarget(GLOBAL, 'roles/-bad.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL, 'roles/has space.yaml')).toBeUndefined();
  });
});

describe('hashContent', () => {
  it('hashes the UTF-8 bytes with sha256 into lowercase hex', () => {
    expect(hashContent('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hashContent('docket')).toBe(hashContent('docket'));
    expect(hashContent('docket')).not.toBe(hashContent('dockeT'));
    expect(hashContent('ğümeç')).toMatch(/^[0-9a-f]{64}$/);
  });
});
