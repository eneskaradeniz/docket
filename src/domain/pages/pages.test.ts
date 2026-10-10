// Rules R-74 … R-80 of docs/v2/domain.md: the pages module.
import { describe, expect, it } from 'vitest';

import { parseUlid, type Actor, type PageId, type RoleSlug, type RunId, type Ulid } from '../shared';

import {
  PAGE_LIMITS,
  addComment,
  addVersion,
  decideApproval,
  markDelivered,
  publishPage,
  requestApproval,
  sha256Hex,
  pathsCollide,
  validatePageContent,
  validatePagePath,
  type Page,
  type PageComment,
  type PageFileRef,
  type PageKind,
} from './index';

const ulid = <B extends string>(s: string): Ulid<B> => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const PAGE_ID: PageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const C1 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const C2 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FB2');
const C3 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');
const USER: Actor = { kind: 'user', id: 'u1' };
const AGENT: Actor = { kind: 'agent', runId: ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1') as RunId, role: 'writer' as RoleSlug };
const SYSTEM: Actor = { kind: 'system', component: 'dispatcher' };
const HASH = 'a'.repeat(64);

const file = (path: string, bytes = 10): PageFileRef => ({ path, bytes, sha256: HASH });
const base = (kind: PageKind = 'html', files: readonly PageFileRef[] = [file('index.html')], entry = 'index.html') => ({
  title: 'Login mockup',
  kind,
  by: AGENT,
  entry,
  files,
});

const published = (): Page => {
  const r = publishPage(base(), 100, PAGE_ID);
  if (!r.ok) throw new Error('fixture page must publish');
  return r.value;
};
const withApproval = (page: Page, approval: Page['approval']): Page => ({ ...page, approval });
const versioned = (page: Page): Page => {
  const r = addVersion(page, { by: AGENT, entry: 'index.html', files: [file('index.html', 20)] }, 200);
  if (!r.ok) throw new Error('fixture version must add');
  return r.value;
};

const BAD_PATHS: readonly string[] = [
  '',
  '..',
  '.',
  '../x',
  'a/../../x',
  'a/..',
  'a/./b',
  './a',
  '/etc/passwd',
  '/',
  'C:\\x',
  'C:/x',
  'c:x',
  'a\\b',
  '\\\\server\\share',
  'a//b',
  'a/',
  'a/b/',
  'a\u0000b',
  'a\u0000',
  'a:b',
  'a b./c',
  'a/b.',
  'a/ ',
  'a\nb',
  'a\u007fb',
  '\uFF0E\uFF0E/x', // fullwidth full stops fold to ".." under NFKC
  'a/\u2025/x', // two-dot leader folds to ".."
  '\uFF0F\uFF0Fetc', // fullwidth solidus folds to "/"
  'a\uFF3Cb', // fullwidth reverse solidus folds to a backslash
  'a'.repeat(201),
  `${'a/'.repeat(100)}b`,
];

describe('R-74: page file paths', () => {
  it('R-74: accepts plain relative, slash-separated paths', () => {
    for (const p of ['index.html', 'a/b/c.css', 'assets/img-1.png', 'ünïcode/ç.md', 'a..b/c', '.hidden', 'a'.repeat(200)]) {
      expect(validatePagePath(p), p).toBe(true);
    }
  });

  it.each(BAD_PATHS.map((p) => [JSON.stringify(p), p] as const))('R-74: refuses %s', (_label, p) => {
    expect(validatePagePath(p)).toBe(false);
  });

  it('R-74: a bad path in a file set is bad_path, for publish and for a new version', () => {
    for (const bad of BAD_PATHS) {
      const files = [file('index.html'), file(bad)];
      const first = publishPage(base('html', files), 1, PAGE_ID);
      expect(first.ok ? 'ok' : first.error.code, JSON.stringify(bad)).toBe('bad_path');
      const next = addVersion(published(), { by: AGENT, entry: 'index.html', files }, 2);
      expect(next.ok ? 'ok' : next.error.code, JSON.stringify(bad)).toBe('bad_path');
    }
  });

  it('R-74: a duplicate path, or one that differs only by case or Unicode form, is bad_path (it would collide on disk)', () => {
    for (const files of [
      [file('index.html'), file('index.html')],
      [file('index.html'), file('INDEX.html')],
      [file('index.html'), file('x/a.css'), file('X/A.css')],
      [file('index.html'), file('\u00e9.css'), file('e\u0301.css')],
      [file('index.html'), file('a'), file('a/b.css')], // a file cannot also be a directory
      [file('index.html'), file('A/b/c.css'), file('a/b')],
    ]) {
      const r = validatePageContent('html', files, 'index.html');
      expect(r.ok ? 'ok' : r.error.code).toBe('bad_path');
    }
  });
});

describe('R-74: path collisions', () => {
  it('R-74: pathsCollide is true for duplicates, folded duplicates and file-versus-directory pairs only', () => {
    expect(pathsCollide(['a.html', 'b.html', 'c/d.css', 'c/e.css'])).toBe(false);
    expect(pathsCollide(['a/b', 'a/c', 'ab'])).toBe(false);
    expect(pathsCollide([])).toBe(false);
    for (const paths of [['a', 'a'], ['a', 'A'], ['a', 'a/b'], ['a/b/c', 'a/b'], ['x', 'a/b', 'A']]) {
      expect(pathsCollide(paths), paths.join(',')).toBe(true);
    }
  });
});

describe('R-75: entry and kind', () => {
  it('R-75: the entry must be one of the files', () => {
    const r = validatePageContent('html', [file('index.html')], 'other.html');
    expect(r.ok ? 'ok' : r.error.code).toBe('entry_missing');
    expect(validatePageContent('html', [file('a/index.html')], 'index.html').ok).toBe(false);
  });

  it('R-75: each kind accepts only its entry extensions, case-insensitively', () => {
    const accepted: readonly (readonly [PageKind, string])[] = [
      ['html', 'a.html'], ['html', 'A.HTML'],
      ['diagram', 'a.mmd'], ['diagram', 'a.mermaid'],
      ['markdown', 'a.md'],
      ['table', 'a.csv'], ['table', 'a.json'],
      ['image', 'a.png'], ['image', 'a.jpg'], ['image', 'a.jpeg'], ['image', 'a.gif'], ['image', 'a.webp'],
      ['report', 'a.html'], ['report', 'a.md'],
    ];
    for (const [kind, entry] of accepted) {
      expect(validatePageContent(kind, [file(entry)], entry).ok, `${kind} ${entry}`).toBe(true);
    }
    const refused: readonly (readonly [PageKind, string])[] = [
      ['html', 'a.md'], ['html', 'a.htm'], ['html', 'a'], ['html', 'a.html.exe'],
      ['diagram', 'a.md'], ['markdown', 'a.html'], ['table', 'a.txt'], ['table', 'a.csv.html'],
      ['image', 'a.html'], ['image', 'a.bmp'], ['report', 'a.csv'], ['report', 'a.mmd'],
    ];
    for (const [kind, entry] of refused) {
      const r = validatePageContent(kind, [file(entry)], entry);
      expect(r.ok ? 'ok' : r.error.code, `${kind} ${entry}`).toBe('bad_kind');
    }
  });

  it('R-75: an image entry is never an svg, in any case', () => {
    for (const entry of ['a.svg', 'a.SVG', 'a.svgz']) {
      const r = validatePageContent('image', [file(entry)], entry);
      expect(r.ok ? 'ok' : r.error.code, entry).toBe('bad_kind');
    }
  });

  it('R-75: an unknown kind is bad_kind', () => {
    const r = validatePageContent('pdf' as PageKind, [file('a.pdf')], 'a.pdf');
    expect(r.ok ? 'ok' : r.error.code).toBe('bad_kind');
  });

  it('R-75: a title is trimmed, non-empty and at most 120 characters', () => {
    const empty = publishPage({ ...base(), title: '  \n ' }, 1, PAGE_ID);
    expect(empty.ok ? 'ok' : empty.error.code).toBe('empty_title');
    const long = publishPage({ ...base(), title: 'x'.repeat(PAGE_LIMITS.titleMax + 1) }, 1, PAGE_ID);
    expect(long.ok ? 'ok' : long.error.code).toBe('title_too_long');
    const exact = publishPage({ ...base(), title: `  ${'x'.repeat(PAGE_LIMITS.titleMax)}  ` }, 1, PAGE_ID);
    expect(exact.ok && exact.value.title.length).toBe(PAGE_LIMITS.titleMax);
  });
});

describe('R-76: limits and hashing', () => {
  it('R-76: the limits are the contract constants', () => {
    expect(PAGE_LIMITS).toEqual({ titleMax: 120, filesMax: 64, fileMaxBytes: 5_000_000, pageMaxBytes: 20_000_000, commentMax: 4_000 });
  });

  it('R-76: no files is no_files; more than 64 is too_many_files', () => {
    const none = validatePageContent('html', [], 'index.html');
    expect(none.ok ? 'ok' : none.error.code).toBe('no_files');
    const many = Array.from({ length: 65 }, (_, i) => file(i === 0 ? 'index.html' : `f${i}.css`));
    const tooMany = validatePageContent('html', many, 'index.html');
    expect(tooMany.ok ? 'ok' : tooMany.error.code).toBe('too_many_files');
    expect(validatePageContent('html', many.slice(0, 64), 'index.html').ok).toBe(true);
  });

  it('R-76: a file over 5 MB is file_too_large; so is a negative or fractional size', () => {
    expect(validatePageContent('html', [file('index.html', 5_000_000)], 'index.html').ok).toBe(true);
    for (const bytes of [5_000_001, -1, 1.5, Number.NaN]) {
      const r = validatePageContent('html', [file('index.html', bytes)], 'index.html');
      expect(r.ok ? 'ok' : r.error.code, String(bytes)).toBe('file_too_large');
    }
  });

  it('R-76: a total over 20 MB is page_too_large', () => {
    const four = ['index.html', 'a.css', 'b.css', 'c.css'].map((p) => file(p, 5_000_000));
    expect(validatePageContent('html', four, 'index.html').ok).toBe(true);
    const r = validatePageContent('html', [...four, file('d.css', 1)], 'index.html');
    expect(r.ok ? 'ok' : r.error.code).toBe('page_too_large');
  });

  it('R-76: sha256Hex matches the standard test vectors and does not touch its input', () => {
    const enc = new TextEncoder();
    expect(sha256Hex(enc.encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    const input = enc.encode('abc');
    sha256Hex(input);
    expect(Array.from(input)).toEqual([97, 98, 99]);
  });
});

describe('R-77: publishing and versions', () => {
  it('R-77: publishPage makes version 1 with approval none and the creator recorded', () => {
    const r = publishPage({ ...base(), workOrder: ulid('01ARZ3NDEKTSV4RRFFQ69G5FC1'), title: '  Login mockup ' }, 100, PAGE_ID);
    expect(r).toEqual({
      ok: true,
      value: {
        id: PAGE_ID,
        title: 'Login mockup',
        kind: 'html',
        workOrder: '01ARZ3NDEKTSV4RRFFQ69G5FC1',
        createdBy: AGENT,
        createdAt: 100,
        versions: [{ n: 1, createdAt: 100, by: AGENT, entry: 'index.html', files: [file('index.html')] }],
        approval: 'none',
      },
    });
  });

  it('R-77: addVersion appends n+1 and never edits an earlier version or the input', () => {
    const v1 = published();
    const snapshot = JSON.stringify(v1);
    const v2 = versioned(v1);
    const v3 = versioned(v2);
    expect(v3.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    expect(v3.versions[0]).toEqual(v1.versions[0]);
    expect(v3.versions[1]).toEqual(v2.versions[1]);
    expect(JSON.stringify(v1)).toBe(snapshot);
    expect(v2.versions[1]).toEqual({ n: 2, createdAt: 200, by: AGENT, entry: 'index.html', files: [file('index.html', 20)] });
  });

  it('R-77: addVersion validates the content against the page kind and changes nothing on refusal', () => {
    const page = published();
    const r = addVersion(page, { by: AGENT, entry: 'a.md', files: [file('a.md')] }, 5);
    expect(r.ok ? 'ok' : r.error.code).toBe('bad_kind');
    const t = addVersion(page, { by: AGENT, entry: 'index.html', files: [file('../x'), file('index.html')] }, 5);
    expect(t.ok ? 'ok' : t.error.code).toBe('bad_path');
    expect(page.versions).toHaveLength(1);
  });

  it('R-77: a new version resets pending, approved and rejected approval to none and drops approvedVersion', () => {
    for (const approval of ['pending', 'approved', 'rejected'] as const) {
      const page: Page = { ...withApproval(published(), approval), ...(approval === 'approved' ? { approvedVersion: 1 } : {}) };
      const next = versioned(page);
      expect(next.approval, approval).toBe('none');
      expect('approvedVersion' in next, approval).toBe(false);
    }
    expect(versioned(published()).approval).toBe('none');
  });
});

describe('R-78: approval', () => {
  it('R-78: requestApproval moves none or rejected to pending; pending and approved are refused', () => {
    const a = requestApproval(published());
    expect(a.ok && a.value.approval).toBe('pending');
    const b = requestApproval(withApproval(published(), 'rejected'));
    expect(b.ok && b.value.approval).toBe('pending');
    for (const approval of ['pending', 'approved'] as const) {
      const r = requestApproval(withApproval(published(), approval));
      expect(r.ok ? 'ok' : r.error.code, approval).toBe('not_pending');
    }
  });

  it('R-78: the approval is of the latest version, which a decision must name', () => {
    const page = withApproval(versioned(published()), 'pending');
    const stale = decideApproval(page, 'approved', USER, 1);
    expect(stale.ok ? 'ok' : stale.error.code).toBe('stale_version');
    const future = decideApproval(page, 'approved', USER, 3);
    expect(future.ok ? 'ok' : future.error.code).toBe('stale_version');
    const fine = decideApproval(page, 'approved', USER, 2);
    expect(fine.ok && fine.value.approval).toBe('approved');
    expect(fine.ok && fine.value.approvedVersion).toBe(2);
  });

  it('R-78: a decision needs a pending approval', () => {
    for (const approval of ['none', 'approved', 'rejected'] as const) {
      const r = decideApproval(withApproval(published(), approval), 'approved', USER, 1);
      expect(r.ok ? 'ok' : r.error.code, approval).toBe('not_pending');
    }
  });

  it('R-78: an agent or system actor can neither approve nor reject (self_approval)', () => {
    const page = withApproval(published(), 'pending');
    for (const by of [AGENT, SYSTEM]) {
      for (const decision of ['approved', 'rejected'] as const) {
        const r = decideApproval(page, decision, by, 1);
        expect(r.ok ? 'ok' : r.error.code).toBe('self_approval');
      }
    }
  });

  it('R-78: a rejection records no approvedVersion and leaves versions untouched', () => {
    const page = withApproval(published(), 'pending');
    const r = decideApproval(page, 'rejected', USER, 1);
    expect(r.ok && r.value.approval).toBe('rejected');
    expect(r.ok && 'approvedVersion' in r.value).toBe(false);
    expect(r.ok && r.value.versions).toEqual(page.versions);
    expect(page.approval).toBe('pending');
  });
});

describe('R-79: comments', () => {
  const input = { version: 1, by: USER, text: '  Make it blue  ' };

  it('R-79: a user comment is trimmed and pinned to a version', () => {
    const r = addComment(published(), { ...input, anchor: 'btn-1' }, 300, C1);
    expect(r).toEqual({ ok: true, value: { id: C1, page: PAGE_ID, version: 1, by: USER, at: 300, text: 'Make it blue', anchor: 'btn-1' } });
    const plain = addComment(published(), input, 300, C1);
    expect(plain.ok && 'anchor' in plain.value).toBe(false);
    expect(plain.ok && 'deliveredAt' in plain.value).toBe(false);
  });

  it('R-79: empty or whitespace text is empty_comment; over 4000 characters is comment_too_long', () => {
    for (const text of ['', '   \n\t']) {
      const r = addComment(published(), { ...input, text }, 1, C1);
      expect(r.ok ? 'ok' : r.error.code).toBe('empty_comment');
    }
    const long = addComment(published(), { ...input, text: 'x'.repeat(PAGE_LIMITS.commentMax + 1) }, 1, C1);
    expect(long.ok ? 'ok' : long.error.code).toBe('comment_too_long');
    expect(addComment(published(), { ...input, text: ` ${'x'.repeat(PAGE_LIMITS.commentMax)} ` }, 1, C1).ok).toBe(true);
  });

  it('R-79: a version that does not exist is unknown_version', () => {
    for (const version of [0, 2, -1, 1.5]) {
      const r = addComment(published(), { ...input, version }, 1, C1);
      expect(r.ok ? 'ok' : r.error.code, String(version)).toBe('unknown_version');
    }
    expect(addComment(versioned(published()), { ...input, version: 2 }, 1, C1).ok).toBe(true);
  });

  it('R-79: only a user may comment in this slice', () => {
    for (const by of [AGENT, SYSTEM]) {
      const r = addComment(published(), { ...input, by }, 1, C1);
      expect(r.ok ? 'ok' : r.error.code).toBe('self_approval');
    }
  });
});

describe('R-80: markDelivered', () => {
  const comment = (id: Ulid<'page-comment'>, extra: Partial<PageComment> = {}): PageComment => ({
    id, page: PAGE_ID, version: 1, by: USER, at: 1, text: 't', ...extra,
  });

  it('R-80: stamps only the named undelivered comments, in order, without mutating the input', () => {
    const input = [comment(C1), comment(C2), comment(C3)];
    const snapshot = JSON.stringify(input);
    const out = markDelivered(input, [C1, C3], 50);
    expect(out.map((c) => c.deliveredAt)).toEqual([50, undefined, 50]);
    expect(out.map((c) => c.id)).toEqual([C1, C2, C3]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect('deliveredAt' in (out[1] as PageComment)).toBe(false);
  });

  it('R-80: is idempotent — a second pass, even later, changes nothing and keeps the first time', () => {
    const once = markDelivered([comment(C1), comment(C2)], [C1], 50);
    expect(markDelivered(once, [C1], 99)).toEqual(once);
    expect(markDelivered(once, [], 99)).toEqual(once);
    expect(markDelivered(once, [C3], 99)).toEqual(once);
    expect(markDelivered(once, [C1, C1, C2], 60)[1]?.deliveredAt).toBe(60);
    expect(markDelivered(once, [C1, C1, C2], 60)[0]?.deliveredAt).toBe(50);
  });
});
