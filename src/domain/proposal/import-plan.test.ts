import { describe, expect, it } from 'vitest';

import type { DiscoveredRepo } from './import-plan';
import { planImport } from './import-plan';

const repo = (name: string, path: string, isGit = true): DiscoveredRepo => ({ name, path, isGit });

describe('planImport', () => {
  it('R-148: orders found repos alphabetically by name case-insensitively, then path', () => {
    const plan = planImport(
      [repo('Zeta', '/z'), repo('alpha', '/a2'), repo('Alpha', '/a1')],
      [],
      8,
    );
    expect(plan.rows.map((row) => row.name)).toEqual(['Alpha', 'alpha', 'Zeta']);
    expect(plan.rows.map((row) => row.path)).toEqual(['/a1', '/a2', '/z']);
  });

  it('R-148: skipped rows never count toward max and carry their reason', () => {
    const plan = planImport(
      [
        repo('a', '/a', false),
        repo('b', '/in'),
        repo('c', '/c'),
        repo('d', '/d'),
      ],
      ['/in'],
      1,
    );
    expect(plan.rows).toEqual([
      { name: 'a', path: '/a', state: 'skipped', reason: 'not_a_git_repo' },
      { name: 'b', path: '/in', state: 'skipped', reason: 'already_in_project' },
      { name: 'c', path: '/c', state: 'queued' },
    ]);
    expect(plan.overflow).toBe(1);
  });

  it('R-148: overflow arithmetic with zero and exactly max eligible rows', () => {
    expect(planImport([], [], 8).overflow).toBe(0);
    const exact = planImport([repo('a', '/a'), repo('b', '/b')], [], 2);
    expect(exact.overflow).toBe(0);
    expect(exact.rows.filter((row) => row.state === 'queued')).toHaveLength(2);
    const over = planImport(
      [repo('a', '/a'), repo('b', '/b'), repo('c', '/c')],
      [],
      2,
    );
    expect(over.overflow).toBe(1);
    expect(over.rows.filter((row) => row.state === 'queued')).toHaveLength(2);
  });

  it('R-148: duplicate paths are skipped and ties break on path', () => {
    const plan = planImport([repo('x', '/dup'), repo('x', '/dup')], [], 8);
    expect(plan.rows[1]).toEqual({ name: 'x', path: '/dup', state: 'skipped', reason: 'duplicate_path' });
  });
});
