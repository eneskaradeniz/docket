import { describe, expect, it } from 'vitest';
import { parseCreateWorkOrderArgs, parseCreateWorkspaceArgs, repoSlugOf, resolveTracks } from '../create';

// WO-0024 — the CLI bootstrap mappers, pure: argv (plain strings) in, a draft/input out. No store, no fs,
// no branding — identity construction stays in the composition root (index.ts) per ADR-0003. The
// validation mirrors the GUI's WoCreateModal (title non-empty, review-mode exactly gates|every-step,
// tracks = code repos minus the decision store), so a CLI-born WO is shaped identically to a GUI-born one.

describe('parseCreateWorkspaceArgs', () => {
  it('minimal happy path → one repo, no explicit decision store', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', 'Docket', '--repo', '/src/docket']);
    expect(r).toEqual({
      ok: true,
      input: { label: 'Docket', repos: [{ path: '/src/docket' }], decisionStorePath: undefined },
    });
  });

  it('repeatable --repo keeps argv order; --decision-store picks among them', () => {
    const r = parseCreateWorkspaceArgs([
      'create-workspace', '--label', 'W', '--repo', '/a/app', '--repo', '/a/docs', '--decision-store', '/a/docs',
    ]);
    expect(r.ok && r.input.repos.map((x) => x.path)).toEqual(['/a/app', '/a/docs']);
    expect(r.ok && r.input.decisionStorePath).toBe('/a/docs');
  });

  it('trims label and repo paths', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', '  W  ', '--repo', ' /a/app ']);
    expect(r).toEqual({ ok: true, input: { label: 'W', repos: [{ path: '/a/app' }], decisionStorePath: undefined } });
  });

  it('missing --label → error names the flag', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--repo', '/a/app']);
    expect(!r.ok && r.error).toContain('--label');
  });

  it('blank --label → error (a slug is derived from it)', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', '   ', '--repo', '/a/app']);
    expect(!r.ok && r.error).toContain('--label');
  });

  it('missing --repo → error says the flag is repeatable', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', 'W']);
    expect(!r.ok && r.error).toContain('--repo');
  });

  it('--label with no value → error', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', '--repo', '/a/app']);
    expect(!r.ok && r.error).toContain('--label');
  });

  it('empty --repo value → error', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', 'W', '--repo', '']);
    expect(!r.ok && r.error).toContain('--repo');
  });

  it('--decision-store outside the given repos → error (the store would silently fall back to cwd)', () => {
    const r = parseCreateWorkspaceArgs([
      'create-workspace', '--label', 'W', '--repo', '/a/app', '--decision-store', '/elsewhere/docs',
    ]);
    expect(!r.ok && r.error).toContain('--decision-store');
    expect(!r.ok && r.error).toContain('app'); // names the repos it could be
  });

  it('trailing slashes do not defeat --decision-store matching (same slug normalization as the store)', () => {
    const r = parseCreateWorkspaceArgs([
      'create-workspace', '--label', 'W', '--repo', '/a/docs', '--decision-store', '/a/docs/',
    ]);
    expect(r.ok && r.input.decisionStorePath).toBe('/a/docs/');
  });

  it('a stray positional → error (usage mistakes must not pass silently)', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', 'oops', '--label', 'W', '--repo', '/a/app']);
    expect(!r.ok && r.error).toContain('unexpected argument');
  });

  it('an unknown flag → error listing the known ones', () => {
    const r = parseCreateWorkspaceArgs(['create-workspace', '--label', 'W', '--repo', '/a/app', '--name', 'X']);
    expect(!r.ok && r.error).toContain('--name');
    expect(!r.ok && r.error).toContain('--label');
  });

  it('the global --db pair is skipped wherever it sits', () => {
    const r = parseCreateWorkspaceArgs(['--db', '/tmp/x.db', 'create-workspace', '--label', 'W', '--repo', '/a/app']);
    expect(r.ok && r.input.label).toBe('W');
    const r2 = parseCreateWorkspaceArgs(['create-workspace', '--label', 'W', '--db', '/tmp/x.db', '--repo', '/a/app']);
    expect(r2.ok).toBe(true);
  });
});

describe('parseCreateWorkOrderArgs', () => {
  const base = ['create-work-order', '--workspace', 'docket', '--title', 'CLI bootstrap'];

  it('full happy path → every field explicit', () => {
    const r = parseCreateWorkOrderArgs([
      ...base, '--description', 'headless WO creation', '--track', 'docket', '--review-mode', 'every-step',
    ]);
    expect(r).toEqual({
      ok: true,
      input: {
        workspace: 'docket',
        title: 'CLI bootstrap',
        description: 'headless WO creation',
        tracks: ['docket'],
        reviewMode: 'every-step',
        contextFiles: [],
      },
    });
  });

  it('defaults: description "", tracks [], reviewMode gates', () => {
    const r = parseCreateWorkOrderArgs(base);
    expect(r.ok && r.input.description).toBe('');
    expect(r.ok && r.input.tracks).toEqual([]);
    expect(r.ok && r.input.reviewMode).toBe('gates');
  });

  it('repeatable --track collects in argv order and dedupes', () => {
    const r = parseCreateWorkOrderArgs([...base, '--track', 'app', '--track', 'docs2', '--track', 'app']);
    expect(r.ok && r.input.tracks).toEqual(['app', 'docs2']);
  });

  it('trims workspace, title and description', () => {
    const r = parseCreateWorkOrderArgs([
      'create-work-order', '--workspace', ' docket ', '--title', '  T  ', '--description', '  d  ',
    ]);
    expect(r.ok && r.input.workspace).toBe('docket');
    expect(r.ok && r.input.title).toBe('T');
    expect(r.ok && r.input.description).toBe('d');
  });

  it('missing --workspace → error names the flag', () => {
    const r = parseCreateWorkOrderArgs(['create-work-order', '--title', 'T']);
    expect(!r.ok && r.error).toContain('--workspace');
  });

  it('missing --title → error names the flag', () => {
    const r = parseCreateWorkOrderArgs(['create-work-order', '--workspace', 'docket']);
    expect(!r.ok && r.error).toContain('--title');
  });

  it('blank --title → error (mirrors the GUI, which refuses an empty title)', () => {
    const r = parseCreateWorkOrderArgs(['create-work-order', '--workspace', 'docket', '--title', '   ']);
    expect(!r.ok && r.error).toContain('--title');
  });

  it('invalid --review-mode → error lists both valid values (never silently defaulted)', () => {
    const r = parseCreateWorkOrderArgs([...base, '--review-mode', 'always']);
    expect(!r.ok && r.error).toContain('always');
    expect(!r.ok && r.error).toContain('gates');
    expect(!r.ok && r.error).toContain('every-step');
  });

  it('empty --track value → error', () => {
    const r = parseCreateWorkOrderArgs([...base, '--track', '']);
    expect(!r.ok && r.error).toContain('--track');
  });

  it('unknown flag → error; stray positional → error', () => {
    const bad = parseCreateWorkOrderArgs([...base, '--revew-mode', 'gates']);
    expect(!bad.ok && bad.error).toContain('--revew-mode');
    const stray = parseCreateWorkOrderArgs(['create-work-order', 'WO-0001', '--workspace', 'docket', '--title', 'T']);
    expect(!stray.ok && stray.error).toContain('unexpected argument');
  });

  it('the global --db pair is skipped', () => {
    const r = parseCreateWorkOrderArgs(['--db', '/tmp/x.db', ...base]);
    expect(r.ok && r.input.title).toBe('CLI bootstrap');
  });
});

describe('resolveTracks — code repos minus the decision store (PRODUCT §Decisions 6)', () => {
  it('default (no --track): all code repos, decision store excluded in a multi-repo workspace', () => {
    const r = resolveTracks(['app', 'docs', 'lib'], 'docs', []);
    expect(r).toEqual({ ok: true, tracks: ['app', 'lib'] });
  });

  it('single-repo workspace keeps its one repo (it is both code and the decision store)', () => {
    const r = resolveTracks(['docket'], 'docket', []);
    expect(r).toEqual({ ok: true, tracks: ['docket'] });
  });

  it('explicit tracks are returned in requested order (a subset is fine)', () => {
    const r = resolveTracks(['app', 'docs', 'lib'], 'docs', ['lib', 'app']);
    expect(r).toEqual({ ok: true, tracks: ['lib', 'app'] });
  });

  it('requesting the decision store of a multi-repo workspace → error says WHY', () => {
    const r = resolveTracks(['app', 'docs'], 'docs', ['docs']);
    expect(!r.ok && r.error).toContain('decision store');
  });

  it('the decision store of a single-repo workspace IS requestable', () => {
    const r = resolveTracks(['docket'], 'docket', ['docket']);
    expect(r).toEqual({ ok: true, tracks: ['docket'] });
  });

  it('unknown slug → error lists the valid tracks', () => {
    const r = resolveTracks(['app', 'docs'], 'docs', ['nope']);
    expect(!r.ok && r.error).toContain('nope');
    expect(!r.ok && r.error).toContain('app');
  });

  it('a repo-less workspace with no request → honest error, not an empty track list', () => {
    const r = resolveTracks([], '', []);
    expect(!r.ok && r.error).toContain('no code-repo tracks');
  });
});

describe('repoSlugOf — the store-side repoBase, mirrored', () => {
  it('last path segment', () => {
    expect(repoSlugOf('/a/b/docket')).toBe('docket');
  });
  it('trailing slashes are stripped first', () => {
    expect(repoSlugOf('/a/b/docket///')).toBe('docket');
  });
  it('a bare root degrades to "repo", like the adapter', () => {
    expect(repoSlugOf('/')).toBe('repo');
  });
});

describe('parseCreateWorkOrderArgs — --task (WO-0048)', () => {
  it('parses --task into the draft', () => {
    const r = parseCreateWorkOrderArgs(['create-work-order', '--workspace', 'w', '--title', 'T', '--task', 'f1-t2']);
    expect(r).toMatchObject({ ok: true, input: { task: 'f1-t2' } });
  });

  it('absent --task leaves the draft unlinked', () => {
    const r = parseCreateWorkOrderArgs(['create-work-order', '--workspace', 'w', '--title', 'T']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.task).toBeUndefined();
  });

  it('a valueless --task is a usage error', () => {
    const r = parseCreateWorkOrderArgs(['create-work-order', '--workspace', 'w', '--title', 'T', '--track']);
    expect(r.ok).toBe(false);
  });
});
