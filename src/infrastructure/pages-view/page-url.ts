// The one door from a URL to (page id, version, file path). A page is untrusted content, so the
// parser is deliberately strict and hand-written: the platform URL parser would normalise `..`,
// strip tabs and newlines and lower-case hosts before any rule could look at the original text.
import type { PageId } from '../../domain/index';
import { isUlid, validatePagePath } from '../../domain/index';

export const PAGE_SCHEME = 'docket-page';
const PREFIX = `${PAGE_SCHEME}://`;

/** A generous ceiling on the part before the query: the longest valid path is 200 characters and
 *  every character may travel as three (`%XX`). */
const MAX_BEFORE_QUERY = 2048;

// ASCII only: a case-folding or look-alike step must never turn another character into an id one.
const HOST = /^[0-9A-Za-z]{26}$/;
const VERSION = /^v([1-9][0-9]{0,8})$/;
/** An encoded separator would let two spellings name one file, and `%5c`/`%2f` can hide a
 *  traversal from a check that runs before decoding. */
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

export interface ParsedPageUrl {
  readonly pageId: PageId;
  readonly version: number;
  /** The decoded file path, or '' for the version's entry. */
  readonly path: string;
}

const beforeFragment = (url: string): string => {
  const hash = url.indexOf('#');
  return hash < 0 ? url : url.slice(0, hash);
};

export const parsePageUrl = (url: unknown): ParsedPageUrl | undefined => {
  if (typeof url !== 'string' || !url.startsWith(PREFIX)) return undefined;
  const noFragment = beforeFragment(url.slice(PREFIX.length));
  const question = noFragment.indexOf('?');
  const target = question < 0 ? noFragment : noFragment.slice(0, question);
  if (target.length > MAX_BEFORE_QUERY) return undefined;

  const hostEnd = target.indexOf('/');
  if (hostEnd < 0) return undefined;
  const host = target.slice(0, hostEnd);
  if (!HOST.test(host)) return undefined;
  const pageId = host.toUpperCase();
  if (!isUlid(pageId)) return undefined;

  const afterHost = target.slice(hostEnd + 1);
  const versionEnd = afterHost.indexOf('/');
  if (versionEnd < 0) return undefined;
  const versionMatch = VERSION.exec(afterHost.slice(0, versionEnd));
  if (versionMatch === null) return undefined;
  const version = Number(versionMatch[1]);

  const rawPath = afterHost.slice(versionEnd + 1);
  if (rawPath === '') return { pageId: pageId as PageId, version, path: '' };
  if (rawPath.includes('\\') || ENCODED_SEPARATOR.test(rawPath)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(rawPath); // once: a `%` that survives is refused by the validator
  } catch {
    return undefined; // a malformed escape or invalid UTF-8
  }
  if (!validatePagePath(path)) return undefined;
  return { pageId: pageId as PageId, version, path };
};

/** The raw query text (between `?` and `#`), for the test hook only; it never reaches file lookup. */
export const pageUrlQuery = (url: string): string | undefined => {
  const noFragment = beforeFragment(url);
  const question = noFragment.indexOf('?');
  return question < 0 ? undefined : noFragment.slice(question + 1);
};
