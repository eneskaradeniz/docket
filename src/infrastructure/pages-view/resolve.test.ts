// I-64 — resolveFile is an exact match against the version's recorded paths; I-65 — the content
// type table is fixed and an unknown extension has no type (the responder answers 415).
import { describe, expect, it } from 'vitest';

import type { PageVersion } from '../../domain/index';

import { contentTypeFor, resolveFile } from './resolve';

const version = (entry: string, paths: readonly string[]): PageVersion => ({
  n: 1,
  createdAt: 1 as PageVersion['createdAt'],
  by: { kind: 'user', id: 'u', label: 'U' },
  entry,
  files: paths.map((path) => ({ path, bytes: 1, sha256: 'x' })),
});

describe('I-64: resolveFile', () => {
  const v = version('index.html', ['index.html', 'assets/app.js', 'Data.JSON']);

  it('I-64: a recorded path resolves to itself', () => {
    expect(resolveFile(v, 'index.html')).toBe('index.html');
    expect(resolveFile(v, 'assets/app.js')).toBe('assets/app.js');
  });

  it('I-64: the empty path resolves to the version entry', () => {
    expect(resolveFile(v, '')).toBe('index.html');
  });

  it('I-64: an entry that is not among the recorded files resolves to nothing', () => {
    expect(resolveFile(version('missing.html', ['index.html']), '')).toBeUndefined();
  });

  it('I-64: only an exact string match counts: case, prefixes, joins and listings never resolve', () => {
    for (const miss of ['INDEX.HTML', 'data.json', 'assets', 'assets/', 'assets/app.js/', './index.html', 'index', 'index.htm', 'secret', 'assets/../index.html', ' index.html', 'index.html ', '/index.html']) {
      expect(resolveFile(v, miss)).toBeUndefined();
    }
  });

  it('I-64: a name that is only an inherited object key never resolves', () => {
    for (const miss of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(resolveFile(v, miss)).toBeUndefined();
    }
  });

  it('I-64: no index fallback: a version without files resolves nothing, not even the empty path', () => {
    expect(resolveFile(version('index.html', []), '')).toBeUndefined();
    expect(resolveFile(version('index.html', []), 'index.html')).toBeUndefined();
  });
});

describe('I-65: contentTypeFor', () => {
  it.each([
    ['a.html', 'text/html; charset=utf-8'],
    ['dir/a.htm', 'text/html; charset=utf-8'],
    ['a.css', 'text/css; charset=utf-8'],
    ['a.js', 'text/javascript; charset=utf-8'],
    ['a.mjs', 'text/javascript; charset=utf-8'],
    ['a.json', 'application/json; charset=utf-8'],
    ['a.csv', 'text/plain; charset=utf-8'],
    ['a.md', 'text/plain; charset=utf-8'],
    ['a.mmd', 'text/plain; charset=utf-8'],
    ['a.mermaid', 'text/plain; charset=utf-8'],
    ['a.txt', 'text/plain; charset=utf-8'],
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.webp', 'image/webp'],
    ['a.svg', 'image/svg+xml'],
    ['a.woff2', 'font/woff2'],
  ])('I-65: %s is %s', (path, type) => {
    expect(contentTypeFor(path)).toBe(type);
  });

  it('I-65: the extension is read from the last segment, case-insensitively', () => {
    expect(contentTypeFor('A.HTML')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('dir.html/readme')).toBeUndefined();
    expect(contentTypeFor('x.png.exe')).toBeUndefined();
  });

  it('I-65: an unknown extension, no extension or a bare dot-name has no type (the caller answers 415)', () => {
    for (const path of ['a.exe', 'a.wasm', 'a.xml', 'a.php', 'a.swf', 'a', '.html', 'dir/.png', 'a.', 'a.htmlx', 'a.constructor', 'a.__proto__']) {
      expect(contentTypeFor(path)).toBeUndefined();
    }
  });
});
