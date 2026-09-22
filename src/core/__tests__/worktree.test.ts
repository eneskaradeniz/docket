import { describe, expect, it } from 'vitest';
import { worktreeName, worktreePathUnder } from '../worktree';

// WO-0093 — the worktree convention is pure and therefore test-first: one name, one path, both
// DERIVED from (woId, slug, workspace, appHome), never stored. The app home anchors on the DB
// path's directory (WO-0075), never process.cwd() — that anchoring is the caller's job; these
// tests pin the composition of the segments.

describe('worktreeName (WO-0093)', () => {
  it('lowercases the WO id into the ADR-0017 branch convention: wo-NNNN-<slug>', () => {
    expect(worktreeName('WO-0093', 'worktree-otomasyonu')).toBe('wo-0093-worktree-otomasyonu');
  });

  it('keeps the slug verbatim — the operator reads the same words in branch, dir and order.md', () => {
    expect(worktreeName('WO-0001', 'yeni-is-emri-ornegi')).toBe('wo-0001-yeni-is-emri-ornegi');
  });
});

describe('worktreePathUnder (WO-0093)', () => {
  it('nests worktrees/<workspace>/<wo-NNNN>-<slug> under the given app home', () => {
    expect(worktreePathUnder('/home/op/.docket', 'docket', 'WO-0093', 'worktree-otomasyonu')).toBe(
      '/home/op/.docket/worktrees/docket/wo-0093-worktree-otomasyonu',
    );
  });

  it('a DOCKET_DB_PATH-override home anchors there too — the override wins verbatim (WO-0075)', () => {
    expect(worktreePathUnder('/tmp/docket-e2e-x', 'sorun', 'WO-0098', 'otp-paketi')).toBe(
      '/tmp/docket-e2e-x/worktrees/sorun/wo-0098-otp-paketi',
    );
  });

  it('two work orders of one workspace never collide (the parallel wave)', () => {
    const a = worktreePathUnder('/h/.docket', 'wt', 'WO-0098', 'a-isi');
    const b = worktreePathUnder('/h/.docket', 'wt', 'WO-0099', 'b-isi');
    expect(a).not.toBe(b);
  });
});
