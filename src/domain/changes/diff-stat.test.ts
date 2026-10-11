// R-119: a unified patch becomes per-file added/removed counts. The patch text itself is not a result.
import { describe, expect, it } from 'vitest';

import { diffStatOf } from './index';

const TEXT = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' kept',
  '-old',
  '+new',
  '+another',
  ' tail',
].join('\n');

describe('diffStatOf', () => {
  it('R-119: per-file added and removed counts ignore +++ and --- headers', () => {
    expect(diffStatOf(TEXT)).toEqual([{ path: 'src/a.ts', added: 2, removed: 1, binary: false }]);
  });

  it('R-119: a line whose text starts with ++ still counts as one added line once a hunk has started', () => {
    const patch = ['diff --git a/f.ts b/f.ts', '--- a/f.ts', '+++ b/f.ts', '@@ -1 +1 @@', '+++still added', '---still removed'].join('\n');
    expect(diffStatOf(patch)).toEqual([{ path: 'f.ts', added: 1, removed: 1, binary: false }]);
  });

  it('R-119: an empty patch yields no files', () => {
    expect(diffStatOf('')).toEqual([]);
    expect(diffStatOf('\n\n')).toEqual([]);
  });

  it('R-119: a rename is reported at the destination path', () => {
    const patch = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    expect(diffStatOf(patch)).toEqual([{ path: 'new.ts', added: 1, removed: 1, binary: false }]);
  });

  it('R-119: a quoted rename destination wins over the header path', () => {
    const patch = ['diff --git "a/old name.ts" "b/old name.ts"', 'rename from old name.ts', 'rename to "dir/new name.ts"'].join('\n');
    expect(diffStatOf(patch)).toEqual([{ path: 'dir/new name.ts', added: 0, removed: 0, binary: false }]);
  });

  it('R-119: binary markers contribute a file and no line counts', () => {
    const marker = ['diff --git a/logo.png b/logo.png', 'index 111..222', 'Binary files a/logo.png and b/logo.png differ'].join('\n');
    const literal = ['diff --git a/blob.bin b/blob.bin', 'GIT binary patch', 'literal 4', '+not-a-source-line', '-also-not'].join('\n');
    expect(diffStatOf(`${marker}\n${literal}`)).toEqual([
      { path: 'logo.png', added: 0, removed: 0, binary: true },
      { path: 'blob.bin', added: 0, removed: 0, binary: true },
    ]);
  });

  it('R-119: a deleted file keeps the source path and a new file the destination', () => {
    const removed = ['diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-only'].join('\n');
    const added = ['diff --git a/fresh.ts b/fresh.ts', '--- /dev/null', '+++ b/fresh.ts', '@@ -0,0 +1 @@', '+only'].join('\n');
    expect(diffStatOf(`${removed}\n${added}`)).toEqual([
      { path: 'gone.ts', added: 0, removed: 1, binary: false },
      { path: 'fresh.ts', added: 1, removed: 0, binary: false },
    ]);
  });

  it('R-119: the same patch always yields the same stats and the patch text is left unchanged', () => {
    const patch = TEXT;
    const first = diffStatOf(patch);
    const second = diffStatOf(patch);
    expect(second).toEqual(first);
    expect(patch).toBe(TEXT);
  });
});
