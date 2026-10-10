// I-63 — parsePageUrl is the only door from a URL a page (or the browser) produced to a page id,
// a version and a file path. Every hostile form must answer undefined.
import { describe, expect, it } from 'vitest';

import { pageUrlQuery, parsePageUrl } from './page-url';

const ID = '01JZ8K3M4N5P6Q7R8S9T0V1W2X';
const base = `docket-page://${ID}`;

describe('I-63: parsePageUrl accepts the one well-formed shape', () => {
  it('I-63: page id, version and a plain file path', () => {
    expect(parsePageUrl(`${base}/v1/index.html`)).toEqual({ pageId: ID, version: 1, path: 'index.html' });
    expect(parsePageUrl(`${base}/v12/assets/app.js`)).toEqual({ pageId: ID, version: 12, path: 'assets/app.js' });
  });

  it('I-63: the host is case-normalised to the id the repo stores (the URL parser lowercases hosts)', () => {
    expect(parsePageUrl(`docket-page://${ID.toLowerCase()}/v3/a.css`)).toEqual({ pageId: ID, version: 3, path: 'a.css' });
  });

  it('I-63: /v<n>/ alone is the entry shortcut (empty path)', () => {
    expect(parsePageUrl(`${base}/v2/`)).toEqual({ pageId: ID, version: 2, path: '' });
  });

  it('I-63: query and fragment are stripped, they never reach file lookup', () => {
    expect(parsePageUrl(`${base}/v1/index.html?x=../../etc`)).toEqual({ pageId: ID, version: 1, path: 'index.html' });
    expect(parsePageUrl(`${base}/v1/index.html#frag/../x`)).toEqual({ pageId: ID, version: 1, path: 'index.html' });
    expect(parsePageUrl(`${base}/v1/index.html#a?b`)).toEqual({ pageId: ID, version: 1, path: 'index.html' });
    expect(parsePageUrl(`${base}/v1/__report?a=1&b=%2e%2e`)).toEqual({ pageId: ID, version: 1, path: '__report' });
    expect(parsePageUrl(`${base}/v1/?q`)).toEqual({ pageId: ID, version: 1, path: '' });
  });

  it('I-63: a single percent-escape is decoded once, to a name that must still validate', () => {
    expect(parsePageUrl(`${base}/v1/my%20file.txt`)).toEqual({ pageId: ID, version: 1, path: 'my file.txt' });
    expect(parsePageUrl(`${base}/v1/%73ecret`)).toEqual({ pageId: ID, version: 1, path: 'secret' });
    expect(parsePageUrl(`${base}/v1/%C3%BC.txt`)).toEqual({ pageId: ID, version: 1, path: 'ü.txt' });
  });
});

describe('I-63: look-alike separators stay literal', () => {
  it('I-63: a fullwidth slash is an ordinary character of one file name, never a directory separator', () => {
    // The page-path rules accept the name (its folded form a/b is a plain path); because resolution is
    // an exact match, it can only ever name a recorded file spelled with that very character.
    expect(parsePageUrl(`${base}/v1/a／b`)).toEqual({ pageId: ID, version: 1, path: 'a／b' });
    expect(parsePageUrl(`${base}/v1/a%EF%BC%8Fb`)).toEqual({ pageId: ID, version: 1, path: 'a／b' });
  });
});

describe('I-63: parsePageUrl refuses every hostile form', () => {
  const hostile: readonly (readonly [string, string])[] = [
    ['not a url', 'hello'],
    ['empty', ''],
    ['other scheme', `http://${ID}/v1/index.html`],
    ['file scheme', 'file:///etc/hosts'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>1</script>'],
    ['mixed-case scheme', `Docket-Page://${ID}/v1/index.html`],
    ['upper-case scheme', `DOCKET-PAGE://${ID}/v1/index.html`],
    ['single slash after scheme', `docket-page:/${ID}/v1/index.html`],
    ['no slashes after scheme', `docket-page:${ID}/v1/index.html`],
    ['triple slash (empty host)', `docket-page:///${ID}/v1/index.html`],
    ['empty host', 'docket-page:///v1/index.html'],
    ['host is not a ULID', 'docket-page://evil/v1/index.html'],
    ['host too short', `docket-page://${ID.slice(0, 25)}/v1/index.html`],
    ['host too long', `docket-page://${ID}0/v1/index.html`],
    ['host with excluded letters (I L O U)', 'docket-page://01JZ8K3M4N5P6Q7R8S9T0V1WIL/v1/index.html'],
    ['userinfo', `docket-page://${ID}@evil.example/v1/index.html`],
    ['userinfo with the id first', `docket-page://${ID}:pw@${ID}/v1/index.html`],
    ['evil host before id', `docket-page://evil@${ID}/v1/index.html`],
    ['port', `docket-page://${ID}:80/v1/index.html`],
    ['empty port', `docket-page://${ID}:/v1/index.html`],
    ['trailing dot on host', `docket-page://${ID}./v1/index.html`],
    ['percent-encoded host', `docket-page://%30${ID.slice(1)}/v1/index.html`],
    ['unicode look-alike host (fullwidth digit)', `docket-page://０${ID.slice(1)}/v1/index.html`],
    ['cyrillic look-alike host', `docket-page://${ID.replace('K', 'К')}/v1/index.html`],
    ['host followed by backslash', `docket-page://${ID}\\v1\\index.html`],
    ['no path at all', base],
    ['no path with slash only', `${base}/`],
    ['no version', `${base}/index.html`],
    ['version without trailing slash', `${base}/v1`],
    ['version zero', `${base}/v0/index.html`],
    ['zero-padded version', `${base}/v01/index.html`],
    ['double zero-padded', `${base}/v001/index.html`],
    ['negative version', `${base}/v-1/index.html`],
    ['plus version', `${base}/v+1/index.html`],
    ['hex version', `${base}/v0x1/index.html`],
    ['decimal version', `${base}/v1.5/index.html`],
    ['exponent version', `${base}/v1e3/index.html`],
    ['upper-case V', `${base}/V1/index.html`],
    ['version beyond safe integers', `${base}/v99999999999999999999/index.html`],
    ['encoded version', `${base}/%76%31/index.html`],
    ['unicode digit version', `${base}/v١/index.html`],
    ['fullwidth digit version', `${base}/v１/index.html`],
    ['dot-dot', `${base}/v1/../v1/secret`],
    ['leading dot-dot', `${base}/v1/../secret`],
    ['nested dot-dot', `${base}/v1/a/../../secret`],
    ['single dot', `${base}/v1/./index.html`],
    ['encoded dot-dot slash', `${base}/v1/%2e%2e%2fsecret`],
    ['encoded dot-dot slash upper', `${base}/v1/%2E%2E%2Fsecret`],
    ['encoded dot-dot with real slash', `${base}/v1/%2e%2e/secret`],
    ['half encoded dot-dot', `${base}/v1/.%2e/secret`],
    ['half encoded dot-dot (other half)', `${base}/v1/%2e./secret`],
    ['encoded slash inside a name', `${base}/v1/a%2fb`],
    ['encoded slash upper', `${base}/v1/a%2Fb`],
    ['encoded backslash', `${base}/v1/a%5cb`],
    ['raw backslash', `${base}/v1/a\\b`],
    ['backslash traversal', `${base}/v1/..\\secret`],
    ['double encoding of a dot', `${base}/v1/%252e%252e/secret`],
    ['double encoding of a slash', `${base}/v1/a%252fb`],
    ['double encoded percent', `${base}/v1/a%2525b`],
    ['percent that decodes to a percent', `${base}/v1/100%25.txt`],
    ['malformed escape (non-hex)', `${base}/v1/a%zzb`],
    ['malformed escape (truncated)', `${base}/v1/a%2`],
    ['malformed escape (lone percent)', `${base}/v1/a%`],
    ['invalid utf-8 escape', `${base}/v1/%ff%fe.txt`],
    ['encoded NUL', `${base}/v1/index.html%00.png`],
    ['raw NUL', `${base}/v1/index.html\u0000.png`],
    ['raw newline', `${base}/v1/a\nb`],
    ['raw tab', `${base}/v1/a\tb`],
    ['encoded newline', `${base}/v1/a%0ab`],
    ['encoded carriage return', `${base}/v1/a%0db`],
    ['encoded DEL', `${base}/v1/a%7fb`],
    ['empty segment', `${base}/v1/a//b`],
    ['doubled slash right after version', `${base}/v1//index.html`],
    ['trailing slash on a file path', `${base}/v1/assets/`],
    ['trailing dot segment', `${base}/v1/index.html.`],
    ['trailing space segment', `${base}/v1/index.html%20`],
    ['dot dot space', `${base}/v1/..%20/x`],
    ['drive prefix', `${base}/v1/C:/windows`],
    ['encoded colon', `${base}/v1/c%3a/x`],
    ['alternate data stream', `${base}/v1/index.html::$DATA`],
    ['absolute path via encoded slash', `${base}/v1/%2fetc%2fhosts`],
    ['fullwidth dots', `${base}/v1/．．/secret`],
    ['two-dot leader', `${base}/v1/‥/secret`],
    ['right-to-left override', `${base}/v1/a%E2%80%AEb.txt`],
    ['zero-width space', `${base}/v1/a%E2%80%8Bb.txt`],
    ['very long path', `${base}/v1/${'a'.repeat(5000)}`],
    ['path just over the validator limit', `${base}/v1/${'a'.repeat(201)}`],
    ['very long url from encoded dots', `${base}/v1/${'%2e'.repeat(3000)}`],
    ['very long query does not rescue a bad path', `${base}/v1/../x?${'a'.repeat(5000)}`],
  ];

  it.each(hostile)('I-63: %s', (_label, url) => {
    expect(parsePageUrl(url)).toBeUndefined();
  });

  it('I-63: a hostile path stays hostile when a query or fragment is appended', () => {
    for (const suffix of ['?a=b', '#frag', '?a#b', '?#', '#?']) {
      expect(parsePageUrl(`${base}/v1/../secret${suffix}`)).toBeUndefined();
      expect(parsePageUrl(`${base}/v1/%2e%2e%2fsecret${suffix}`)).toBeUndefined();
    }
  });

  it('I-63: the fragment hides nothing: a traversal before it is refused', () => {
    expect(parsePageUrl(`${base}/v1/..#/index.html`)).toBeUndefined();
    expect(parsePageUrl(`${base}/v1/..?/index.html`)).toBeUndefined();
  });

  it('I-63: non-string input answers undefined instead of throwing', () => {
    for (const value of [undefined, null, 5, {}, [], Symbol('x')]) {
      expect(parsePageUrl(value as unknown as string)).toBeUndefined();
    }
  });
});

describe('I-63: pageUrlQuery (the test hook reads the query the parser strips)', () => {
  it('I-63: the text between ? and #, or undefined', () => {
    expect(pageUrlQuery(`${base}/v1/__report?a=1&b=2`)).toBe('a=1&b=2');
    expect(pageUrlQuery(`${base}/v1/__report?a=1#x`)).toBe('a=1');
    expect(pageUrlQuery(`${base}/v1/__report#x?y`)).toBeUndefined();
    expect(pageUrlQuery(`${base}/v1/__report`)).toBeUndefined();
  });
});
