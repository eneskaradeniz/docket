// src/cli/__tests__/roadmap.test.ts — the CLI's pure roadmap presentation (WO-0048): show lines,
// validate exit codes, the --task resolution. English host chrome (the WO-0047 ruling); the antreo
// fixture's Turkish values print verbatim as data.
import { describe, expect, it } from 'vitest';
import { formatRoadmapShow, formatRoadmapValidate, resolveTaskRef } from '../roadmap';
import { deriveRoadmapView } from '../../core/roadmap';
import { roadmapDiagnostics } from '../../core/roadmap-md';
import { ANTREO_REPOS, ANTREO_WORKSPACE, antreoOrderFacts, antreoRoadmapMd } from '../../core/__tests__/antreo-roadmap';

const antreoView = () =>
  deriveRoadmapView({ roadmapMd: antreoRoadmapMd, workspaceSlug: ANTREO_WORKSPACE, knownRepos: ANTREO_REPOS, orders: antreoOrderFacts });

describe('formatRoadmapShow', () => {
  it('absent → one honest line', () => {
    expect(formatRoadmapShow({ kind: 'absent' })).toBe('no roadmap.md — nothing planned yet.');
  });

  it('invalid → the named reasons, one per line', () => {
    const out = formatRoadmapShow({ kind: 'invalid', reasons: [{ code: 'duplicate_id', severity: 'error', detail: 'f1' }] });
    expect(out).toContain('roadmap.md is invalid:');
    expect(out).toContain('error: duplicate_id — f1');
  });

  it('ready → the head line, faz/task rows, the sıradaki line, open-WO chips', () => {
    const out = formatRoadmapShow(antreoView());
    expect(out).toContain('faz 1/4 tamam · 4 open work order(s) · $14.02 observed');
    expect(out).toContain('f0  tamam');
    expect(out).toContain('5 closed WO(s)  $12.40  Kullanıcı Yönetimi');
    expect(out).toContain('f1  kosuyor');
    expect(out).toContain('▸ WO-0012');
    expect(out).toContain('siradaki: f1-t2 — Doğrulama akışı');
    expect(out).toContain('f2  bekliyor');
    expect(out).toContain('(bloke: f4)');
  });
});

describe('formatRoadmapValidate', () => {
  it('absent file → exit 0 (the invitation state is legitimate)', () => {
    expect(formatRoadmapValidate('absent')).toEqual({ text: 'no roadmap.md — nothing to validate', exitCode: 0 });
  });

  it('clean document → ok, exit 0', () => {
    const diags = roadmapDiagnostics(antreoRoadmapMd, { workspaceSlug: ANTREO_WORKSPACE, knownRepos: ANTREO_REPOS });
    expect(formatRoadmapValidate(diags)).toEqual({ text: 'ok — no diagnostics', exitCode: 0 });
  });

  it('any error line → exit 1; warnings alone stay green', () => {
    const err = formatRoadmapValidate([{ code: 'duplicate_id', severity: 'error', detail: 'f1' }]);
    expect(err.exitCode).toBe(1);
    expect(err.text).toBe('error: duplicate_id — f1');
    const warn = formatRoadmapValidate([{ code: 'cyclic_blocked_by', severity: 'warning', detail: 'fa · fb' }]);
    expect(warn.exitCode).toBe(0);
  });
});

describe('resolveTaskRef — create-work-order --task', () => {
  it('a known task id resolves', () => {
    expect(resolveTaskRef(antreoRoadmapMd, 'f1-t2')).toEqual({ ok: true });
  });

  it('an unknown ref is refused, listing the roadmap’s task ids (the resolveTracks voice)', () => {
    const r = resolveTaskRef(antreoRoadmapMd, 'f9-t9');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('unknown task "f9-t9"');
      expect(r.error).toContain('f0-t1');
      expect(r.error).toContain('f4-t3');
    }
  });

  it('an absent or broken roadmap fails closed', () => {
    expect(resolveTaskRef('', 'f1-t2')).toEqual({ ok: false, error: expect.stringContaining('roadmap validate') });
    expect(resolveTaskRef('---\nworkspace: x\n---\n\nno fence', 'f1-t2')).toEqual({ ok: false, error: expect.stringContaining('roadmap validate') });
  });
});
