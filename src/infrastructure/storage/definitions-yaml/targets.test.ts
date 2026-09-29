// Tests for parseTarget and hashContent (rule I-11). Pure string handling; no filesystem.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { DefinitionScope } from '../../../application/index';
import type { RepoSlug } from '../../../domain/index';

import { hashContent, parseTarget } from './targets';

const GLOBAL_SCOPE: DefinitionScope = { kind: 'global' };
const REPO_SCOPE: DefinitionScope = { kind: 'repo', repo: 'acme' as RepoSlug };

describe('parseTarget', () => {
  it('I-11: accepts roles|flows|capabilities/<slug>.yaml in the global scope', () => {
    expect(parseTarget(GLOBAL_SCOPE, 'roles/planner.yaml')).toEqual({ kind: 'roles', id: 'planner' });
    expect(parseTarget(GLOBAL_SCOPE, 'flows/quick-fix.yaml')).toEqual({ kind: 'flows', id: 'quick-fix' });
    expect(parseTarget(GLOBAL_SCOPE, 'capabilities/context-loader.yaml')).toEqual({
      kind: 'capabilities',
      id: 'context-loader',
    });
  });

  it('I-11: accepts roles|flows|capabilities/<slug>.yaml in the repo scope', () => {
    expect(parseTarget(REPO_SCOPE, 'roles/planner.yaml')).toEqual({ kind: 'roles', id: 'planner' });
    expect(parseTarget(REPO_SCOPE, 'flows/standard.yaml')).toEqual({ kind: 'flows', id: 'standard' });
    expect(parseTarget(REPO_SCOPE, 'capabilities/web-search.yaml')).toEqual({
      kind: 'capabilities',
      id: 'web-search',
    });
  });

  it('I-11: accepts workspace.yaml and roadmap.yaml in the repo scope only', () => {
    expect(parseTarget(REPO_SCOPE, 'workspace.yaml')).toEqual({ kind: 'repo' });
    expect(parseTarget(REPO_SCOPE, 'roadmap.yaml')).toEqual({ kind: 'roadmap' });
    expect(parseTarget(GLOBAL_SCOPE, 'workspace.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL_SCOPE, 'roadmap.yaml')).toBeUndefined();
  });

  it('I-11: rejects absolute paths', () => {
    expect(parseTarget(REPO_SCOPE, '/etc/roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL_SCOPE, '/roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, '/workspace.yaml')).toBeUndefined();
  });

  it('I-11: rejects parent and current directory segments', () => {
    expect(parseTarget(REPO_SCOPE, '../roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/../planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, './roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, '../../etc/passwd')).toBeUndefined();
  });

  it('I-11: rejects backslash-separated targets', () => {
    expect(parseTarget(REPO_SCOPE, 'roles\\planner.yaml')).toBeUndefined();
    expect(parseTarget(GLOBAL_SCOPE, 'flows\\standard.yaml')).toBeUndefined();
  });

  it('I-11: rejects other extensions and extension-less names', () => {
    expect(parseTarget(REPO_SCOPE, 'roles/planner.yml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/planner.json')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/planner')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/planner.yaml.bak')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'repo.yml')).toBeUndefined();
  });

  it('I-11: rejects deeper folders and folder-less file names', () => {
    expect(parseTarget(REPO_SCOPE, 'roles/inner/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'docs/roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, '')).toBeUndefined();
  });

  it('I-11: rejects upper-case folder names, stems and extensions', () => {
    expect(parseTarget(REPO_SCOPE, 'Roles/planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/Planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/planner.YAML')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'Repo.yaml')).toBeUndefined();
  });

  it('I-11: rejects stems outside the domain slug pattern', () => {
    expect(parseTarget(REPO_SCOPE, 'roles/-planner.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/planner_.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'roles/.yaml')).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, `roles/${'a'.repeat(64)}.yaml`)).toBeUndefined();
    expect(parseTarget(REPO_SCOPE, 'unknown-kind/planner.yaml')).toBeUndefined();
  });
});

describe('hashContent', () => {
  it('hashes the UTF-8 bytes with sha256 into lowercase hex', () => {
    const expected = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

    expect(hashContent('')).toBe(expected(''));
    expect(hashContent('id: planner\n')).toBe(expected('id: planner\n'));
    // Non-ASCII proves the digest is over UTF-8 bytes, not UTF-16 code units.
    expect(hashContent('ğ: ü')).toBe(expected('ğ: ü'));
    expect(hashContent('id: planner\n')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
