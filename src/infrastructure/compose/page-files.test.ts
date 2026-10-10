// I-53 (path containment, symlink refusal) and I-54 (atomic write, create-only, remove) for the
// PageFiles port: the same behaviour cases run on the fake and on the file-system adapter, and the
// adversarial cases once more against the real disk.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PageFiles } from '../../application/index';
import { createFakePageFiles } from '../../application/ports/fakes/index';
import { parseUlid, type PageId } from '../../domain/index';

import { createFsPageFiles } from './page-files';

const id = (s: string): PageId => {
  const parsed = parseUlid<'page'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};
const PAGE = id('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const OTHER = id('01ARZ3NDEKTSV4RRFFQ69G5FAW');

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | undefined): string | undefined => (bytes === undefined ? undefined : new TextDecoder().decode(bytes));

let root: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'docket-page-files-'));
  root = join(base, 'data');
  outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside secret');
});

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true });
});

const BAD_PATHS: readonly string[] = [
  '../x',
  'a/../../x',
  '..',
  '/etc/passwd',
  'C:\\x',
  'C:/x',
  'a\\b',
  'a//b',
  'a\u0000b',
  '\uFF0E\uFF0E/x',
  '\uFF0F\uFF0Fetc',
  '',
  '%2e%2e/x',
  '\u202Ex.html',
  `${'a/'.repeat(101)}b`,
  'a'.repeat(5000),
];

describe.each([
  ['fake', (): PageFiles => createFakePageFiles()],
  ['fs', (): PageFiles => createFsPageFiles(root)],
])('PageFiles behaviour: %s', (_kind, make) => {
  it('I-54: write then read round-trips every file byte for byte, nested paths and binary included', async () => {
    const files = make();
    const binary = new Uint8Array([0, 255, 1, 2, 128, 0]);
    await files.write(PAGE, 1, [
      { path: 'index.html', bytes: enc('<h1>hi ünï</h1>') },
      { path: 'assets/css/site.css', bytes: enc('a{}') },
      { path: 'img.png', bytes: binary },
      { path: 'empty.txt', bytes: new Uint8Array(0) },
    ]);
    expect(dec(await files.read(PAGE, 1, 'index.html'))).toBe('<h1>hi ünï</h1>');
    expect(dec(await files.read(PAGE, 1, 'assets/css/site.css'))).toBe('a{}');
    expect(Array.from((await files.read(PAGE, 1, 'img.png')) ?? [])).toEqual(Array.from(binary));
    expect((await files.read(PAGE, 1, 'empty.txt'))?.length).toBe(0);
  });

  it('I-54: reads of a missing file, version or page answer undefined; versions of one page do not mix', async () => {
    const files = make();
    await files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('v1') }]);
    await files.write(PAGE, 2, [{ path: 'index.html', bytes: enc('v2') }]);
    expect(await files.read(PAGE, 1, 'nope.html')).toBeUndefined();
    expect(await files.read(PAGE, 3, 'index.html')).toBeUndefined();
    expect(await files.read(OTHER, 1, 'index.html')).toBeUndefined();
    expect(dec(await files.read(PAGE, 1, 'index.html'))).toBe('v1');
    expect(dec(await files.read(PAGE, 2, 'index.html'))).toBe('v2');
  });

  it('I-54: a version is created once — writing it again rejects and leaves the first files as they were', async () => {
    const files = make();
    await files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('first') }]);
    await expect(files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('second') }])).rejects.toThrow();
    expect(dec(await files.read(PAGE, 1, 'index.html'))).toBe('first');
  });

  it('I-54: remove deletes the whole version, only that version, and a missing version is not an error', async () => {
    const files = make();
    await files.write(PAGE, 1, [{ path: 'a/b/c.txt', bytes: enc('1') }]);
    await files.write(PAGE, 2, [{ path: 'index.html', bytes: enc('2') }]);
    await files.remove(PAGE, 1);
    expect(await files.read(PAGE, 1, 'a/b/c.txt')).toBeUndefined();
    expect(dec(await files.read(PAGE, 2, 'index.html'))).toBe('2');
    await files.remove(PAGE, 1);
    await files.remove(OTHER, 7);
    await files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('again') }]);
    expect(dec(await files.read(PAGE, 1, 'index.html'))).toBe('again');
  });

  it('I-53: writing any traversal, absolute, backslash, NUL, drive-prefix, empty-segment or overlong path rejects', async () => {
    const files = make();
    for (const bad of BAD_PATHS) {
      await expect(files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('ok') }, { path: bad, bytes: enc('x') }]), JSON.stringify(bad).slice(0, 40)).rejects.toThrow();
    }
    expect(await files.read(PAGE, 1, 'index.html')).toBeUndefined();
  });

  it('I-53: paths that collide on disk (duplicates, case or Unicode twins, file versus directory) reject', async () => {
    const files = make();
    for (const paths of [['a.html', 'a.html'], ['a.html', 'A.HTML'], ['a', 'a/b'], ['\u00e9', 'e\u0301']]) {
      await expect(files.write(PAGE, 1, paths.map((path) => ({ path, bytes: enc('x') })))).rejects.toThrow();
    }
    expect(await files.read(PAGE, 1, 'a.html')).toBeUndefined();
  });

  it('I-53: reading an invalid path answers undefined and never reaches outside the version', async () => {
    const files = make();
    await files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('x') }]);
    await files.write(PAGE, 2, [{ path: 'other.html', bytes: enc('y') }]);
    for (const bad of [...BAD_PATHS, '../v2/other.html', '../../outside/secret.txt', `../../../outside/secret.txt`]) {
      expect(await files.read(PAGE, 1, bad), JSON.stringify(bad).slice(0, 40)).toBeUndefined();
    }
  });

  it('I-53: an invalid page id or version number is refused before any path is built', async () => {
    const files = make();
    const files1 = [{ path: 'index.html', bytes: enc('x') }];
    for (const badPage of ['../x', '', 'not-a-ulid', '01ARZ3NDEKTSV4RRFFQ69G5FAV/../..']) {
      await expect(files.write(badPage as PageId, 1, files1)).rejects.toThrow();
      expect(await files.read(badPage as PageId, 1, 'index.html')).toBeUndefined();
      await expect(files.remove(badPage as PageId, 1)).rejects.toThrow();
    }
    for (const n of [0, -1, 1.5, Number.NaN]) {
      await expect(files.write(PAGE, n, files1)).rejects.toThrow();
      expect(await files.read(PAGE, n, 'index.html')).toBeUndefined();
      await expect(files.remove(PAGE, n)).rejects.toThrow();
    }
  });
});

describe('createFsPageFiles on disk', () => {
  const versionDir = (n: number): string => join(root, 'pages', PAGE, `v${n}`);
  const names = (dir: string): readonly string[] => readdirSync(dir).sort();

  it('I-54: files land at <root>/pages/<pageId>/v<n>/<path>', async () => {
    await createFsPageFiles(root).write(PAGE, 3, [{ path: 'a/b.txt', bytes: enc('x') }, { path: 'index.html', bytes: enc('y') }]);
    expect(readFileSync(join(versionDir(3), 'a', 'b.txt'), 'utf8')).toBe('x');
    expect(names(versionDir(3))).toEqual(['a', 'index.html']);
  });

  it('I-54: a successful write leaves no temporary file or directory behind', async () => {
    await createFsPageFiles(root).write(PAGE, 1, [{ path: 'a/b.txt', bytes: enc('x') }]);
    expect(names(join(root, 'pages', PAGE))).toEqual(['v1']);
  });

  it('I-54: a rejected write leaves neither the version directory nor a temporary directory', async () => {
    const files = createFsPageFiles(root);
    await expect(files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('x') }, { path: '../escape', bytes: enc('x') }])).rejects.toThrow();
    expect(existsSync(versionDir(1))).toBe(false);
    const pageDir = join(root, 'pages', PAGE);
    expect(existsSync(pageDir) ? names(pageDir) : []).toEqual([]);
    expect(existsSync(join(root, 'escape'))).toBe(false);
    expect(existsSync(join(root, 'pages', 'escape'))).toBe(false);
  });

  it('I-54: a path already occupied where the version directory belongs is refused untouched and no staging is left', async () => {
    const files = createFsPageFiles(root);
    mkdirSync(join(root, 'pages', PAGE), { recursive: true });
    writeFileSync(join(root, 'pages', PAGE, 'v1'), 'a file where the version directory goes');
    await expect(files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('x') }])).rejects.toThrow();
    expect(names(join(root, 'pages', PAGE))).toEqual(['v1']);
    expect(readFileSync(join(root, 'pages', PAGE, 'v1'), 'utf8')).toBe('a file where the version directory goes');
  });

  it('I-53: a symlink inside a version is never followed on read, whether it points outside or inside', async () => {
    const files = createFsPageFiles(root);
    await files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('x') }, { path: 'real.txt', bytes: enc('real') }]);
    symlinkSync(join(outside, 'secret.txt'), join(versionDir(1), 'leak.txt'));
    symlinkSync(join(versionDir(1), 'real.txt'), join(versionDir(1), 'alias.txt'));
    symlinkSync(outside, join(versionDir(1), 'dir'));
    expect(await files.read(PAGE, 1, 'leak.txt')).toBeUndefined();
    expect(await files.read(PAGE, 1, 'alias.txt')).toBeUndefined();
    expect(await files.read(PAGE, 1, 'dir/secret.txt')).toBeUndefined();
    expect(dec(await files.read(PAGE, 1, 'real.txt'))).toBe('real');
  });

  it('I-53: a version directory that is itself a symlink is not read through', async () => {
    const files = createFsPageFiles(root);
    mkdirSync(join(root, 'pages', PAGE), { recursive: true });
    writeFileSync(join(outside, 'index.html'), 'outside page');
    symlinkSync(outside, versionDir(1));
    expect(await files.read(PAGE, 1, 'index.html')).toBeUndefined();
    // remove drops the link itself and never the directory it points at
    await files.remove(PAGE, 1);
    expect(lstatSync(outside).isDirectory()).toBe(true);
    expect(readFileSync(join(outside, 'index.html'), 'utf8')).toBe('outside page');
    expect(existsSync(versionDir(1))).toBe(false);
  });

  it('I-53: a pages directory or page directory that is a symlink refuses the write and writes nothing through it', async () => {
    const files = createFsPageFiles(root);
    symlinkSync(outside, join(root, 'pages'));
    await expect(files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('x') }])).rejects.toThrow();
    expect(names(outside)).toEqual(['secret.txt']);
    rmSync(join(root, 'pages'));

    mkdirSync(join(root, 'pages'));
    symlinkSync(outside, join(root, 'pages', PAGE));
    await expect(files.write(PAGE, 1, [{ path: 'index.html', bytes: enc('x') }])).rejects.toThrow();
    expect(names(outside)).toEqual(['secret.txt']);
  });

  it('I-53: a file read is bounded to regular files — a directory path answers undefined', async () => {
    const files = createFsPageFiles(root);
    await files.write(PAGE, 1, [{ path: 'a/b.txt', bytes: enc('x') }]);
    expect(await files.read(PAGE, 1, 'a')).toBeUndefined();
  });
});
