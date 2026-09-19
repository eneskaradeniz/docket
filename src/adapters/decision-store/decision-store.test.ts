import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrderMd, findWorkOrderDir, nextWorkOrderNumber, readRoadmapMd, readWoDocs, writeOrderMd, writePlanMdById, writeRoadmapMd } from './decision-store';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
});
// A throwaway decision-store root per test (isolated filesystem state).
const root = (): string => {
  const p = join(tmpdir(), `docket-ds-${Date.now()}-${dirs.length}`);
  mkdirSync(p, { recursive: true });
  dirs.push(p);
  return p;
};

describe('nextWorkOrderNumber — continues the real sequence (WO-0015)', () => {
  it('starts at WO-0001 when the work-orders dir does not exist', () => {
    expect(nextWorkOrderNumber(root())).toBe('WO-0001');
  });

  it('starts at WO-0001 when the dir exists but holds no WO-NNNN folders', () => {
    const r = root();
    mkdirSync(join(r, 'work-orders'), { recursive: true });
    expect(nextWorkOrderNumber(r)).toBe('WO-0001');
  });

  it('returns max+1, zero-padded, ignoring gaps (max wins, not count)', () => {
    const r = root();
    const woDir = join(r, 'work-orders');
    mkdirSync(woDir, { recursive: true });
    mkdirSync(join(woDir, 'WO-0002-foo'), { recursive: true });
    mkdirSync(join(woDir, 'WO-0014-bar'), { recursive: true });
    mkdirSync(join(woDir, 'not-a-wo'), { recursive: true });
    // max is 0014 → next 0015 (0002 and the gap at 0001 are irrelevant)
    expect(nextWorkOrderNumber(r)).toBe('WO-0015');
  });

  it('treats a stray file (not a dir) as no match', () => {
    const r = root();
    const woDir = join(r, 'work-orders');
    mkdirSync(woDir, { recursive: true });
    writeFileSync(join(woDir, 'WO-0099-ignored'), 'x');
    expect(nextWorkOrderNumber(r)).toBe('WO-0001');
  });
});

describe('buildOrderMd — order.md from creation input', () => {
  const input = {
    id: 'WO-0015',
    title: 'Avatar upload crash',
    workspaceSlug: 'docket',
    description: 'Fix the crash when a user uploads an avatar.',
    trackRepos: ['app'],
    reviewMode: 'gates' as const,
    contextFiles: ['/tmp/log.txt', '/tmp/screen.png'],
  };

  it('emits front matter following TEMPLATE.md + the review_mode key', () => {
    const md = buildOrderMd(input);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('id: WO-0015');
    expect(md).toContain('title: Avatar upload crash');
    expect(md).toContain('workspace: docket');
    expect(md).toContain('status: draft');
    expect(md).toContain('mode: plan');
    expect(md).toContain('review_mode: gates');
    expect(md).toContain('- repo: app');
  });

  it('Objective section carries the description (the architect first prompt)', () => {
    const md = buildOrderMd(input);
    expect(md).toMatch(/## Objective[\s\S]*Fix the crash when a user uploads an avatar\./);
  });

  it('Context section lists the attached file paths', () => {
    const md = buildOrderMd(input);
    expect(md).toContain('/tmp/log.txt');
    expect(md).toContain('/tmp/screen.png');
  });

  it('tracks front matter lists every selected repo', () => {
    const md = buildOrderMd({ ...input, trackRepos: ['app', 'mobile'] });
    expect(md).toContain('- repo: app');
    expect(md).toContain('- repo: mobile');
  });

  it('every-step review mode round-trips into front matter', () => {
    const md = buildOrderMd({ ...input, reviewMode: 'every-step' });
    expect(md).toContain('review_mode: every-step');
  });
});

describe('writeOrderMd — writes into the working tree, no git', () => {
  it('creates the WO-NNNN-slug dir and writes order.md', () => {
    const r = root();
    const path = writeOrderMd(r, 'WO-0015', 'avatar-upload-crash', '# body');
    expect(existsSync(path)).toBe(true);
    expect(path).toBe(join(r, 'work-orders', 'WO-0015-avatar-upload-crash', 'order.md'));
  });

  it('is idempotent-ish: writing twice overwrites without error', () => {
    const r = root();
    writeOrderMd(r, 'WO-0015', 'slug', '# one');
    const path = writeOrderMd(r, 'WO-0015', 'slug', '# two');
    expect(existsSync(path)).toBe(true);
  });

  it('creates nested dirs that did not exist', () => {
    const r = root();
    // work-orders absent entirely
    const path = writeOrderMd(r, 'WO-0001', 'first', '# body');
    expect(existsSync(path)).toBe(true);
  });
});

describe('findWorkOrderDir — locate a WO dir by id prefix (WO-0016)', () => {
  it('finds the WO-NNNN-<slug> directory matching the id', () => {
    const r = root();
    writeOrderMd(r, 'WO-0016', 'avatar-crash', '# body');
    const dir = findWorkOrderDir(r, 'WO-0016');
    expect(dir).toBe(join(r, 'work-orders', 'WO-0016-avatar-crash'));
  });

  it('ignores a stray file whose name starts with the id', () => {
    const r = root();
    const woDir = join(r, 'work-orders');
    mkdirSync(woDir, { recursive: true });
    writeFileSync(join(woDir, 'WO-0016-notes.txt'), 'x');
    expect(findWorkOrderDir(r, 'WO-0016')).toBeUndefined();
  });

  it('returns undefined when no matching directory exists', () => {
    expect(findWorkOrderDir(root(), 'WO-9999')).toBeUndefined();
  });
});

describe('readWoDocs — read order.md + plan.md from the working tree', () => {
  it('returns empty strings when the WO dir is absent', () => {
    expect(readWoDocs(root(), 'WO-0016')).toEqual({ order: '', plan: '' });
  });

  it('reads both documents when present', () => {
    const r = root();
    writeOrderMd(r, 'WO-0016', 'avatar-crash', '# order body');
    writePlanMdById(r, 'WO-0016', '# plan body');
    expect(readWoDocs(r, 'WO-0016')).toEqual({ order: '# order body', plan: '# plan body' });
  });

  it('returns an empty plan when plan.md is not yet written', () => {
    const r = root();
    writeOrderMd(r, 'WO-0016', 'avatar-crash', '# order body');
    expect(readWoDocs(r, 'WO-0016')).toEqual({ order: '# order body', plan: '' });
  });
});

describe('writePlanMdById — write plan.md into the discovered WO dir', () => {
  it('writes plan.md next to the existing order.md', () => {
    const r = root();
    writeOrderMd(r, 'WO-0016', 'avatar-crash', '# order');
    const path = writePlanMdById(r, 'WO-0016', '# the plan');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('# the plan');
    expect(path).toBe(join(r, 'work-orders', 'WO-0016-avatar-crash', 'plan.md'));
  });
});

describe('buildOrderMd — taskRef (WO-0048: the roadmap link lives only in order.md)', () => {
  const base = { id: 'WO-0016', title: 'Avatar crash', workspaceSlug: 'docket', description: 'Fix.', trackRepos: ['app'], reviewMode: 'gates' as const, contextFiles: [] };

  it('emits task: after permission_rule, before tracks', () => {
    const md = buildOrderMd({ ...base, permissionRule: 'full_auto', taskRef: 'f1-t3' });
    expect(md).toContain('permission_rule: full_auto\ntask: f1-t3\ntracks:');
  });

  it('omits the key entirely when unlinked (minimal front-matter)', () => {
    const md = buildOrderMd(base);
    expect(md).not.toContain('task:');
  });
});

describe('roadmap.md file helpers (WO-0048, ADR-0016)', () => {
  it('readRoadmapMd: "" when the file is absent', () => {
    expect(readRoadmapMd(root())).toBe('');
  });

  it('writeRoadmapMd creates the structure root and round-trips the bytes', () => {
    const r = join(root(), '.docket'); // a fresh alternative root — the dir does not exist yet
    const path = writeRoadmapMd(r, '# Yol haritası');
    expect(path).toBe(join(r, 'roadmap.md'));
    expect(readRoadmapMd(r)).toBe('# Yol haritası');
  });

  it('nextWorkOrderNumber scans the structure root it is given (a custom root is a fresh sequence)', () => {
    const r = root();
    mkdirSync(join(r, 'work-orders', 'WO-0042-old'), { recursive: true });
    expect(nextWorkOrderNumber(r)).toBe('WO-0043');
  });
});

// ===== WO-0071 — the tracks fence round-trips depends_on =====
describe('buildOrderMd — depends_on (WO-0071: the intra-WO dependency facts ride the fence)', () => {
  const base = { id: 'WO-0071', title: 'Makine', workspaceSlug: 'docket', description: 'x', trackRepos: ['app', 'api'], reviewMode: 'gates' as const, contextFiles: [] };

  it('absent trackDependencies → every track emits `depends_on: []` exactly as today', () => {
    const md = buildOrderMd(base);
    expect(md).toContain('tracks:\n  - repo: app\n    depends_on: []\n  - repo: api\n    depends_on: []\n');
  });

  it('an explicit empty list emits [] the same way', () => {
    const md = buildOrderMd({ ...base, trackDependencies: [{ repo: 'app', dependsOn: [] }] });
    expect(md).toContain('  - repo: app\n    depends_on: []');
  });

  it('a dependency serializes as a YAML flow list inside the fence', () => {
    const md = buildOrderMd({ ...base, trackDependencies: [{ repo: 'api', dependsOn: ['app'] }] });
    expect(md).toContain('tracks:\n  - repo: app\n    depends_on: []\n  - repo: api\n    depends_on: [app]\n');
  });

  it('multiple dependencies join comma-separated in the given order', () => {
    const md = buildOrderMd({
      ...base,
      trackRepos: ['app', 'api', 'web'],
      trackDependencies: [{ repo: 'web', dependsOn: ['api', 'app'] }],
    });
    expect(md).toContain('  - repo: web\n    depends_on: [api, app]');
  });

  it('a track with no entry still emits [] — the fence stays total', () => {
    const md = buildOrderMd({ ...base, trackDependencies: [{ repo: 'api', dependsOn: ['app'] }] });
    expect(md).toContain('  - repo: app\n    depends_on: []');
    expect(md).toContain('  - repo: api\n    depends_on: [app]');
  });
});
