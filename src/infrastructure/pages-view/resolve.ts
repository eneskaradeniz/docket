// What a requested path may resolve to, and what type it is served as. Nothing here touches
// storage: the recorded file list of the version is the whole universe.
import type { PageVersion } from '../../domain/index';

/** Exact string match against the version's recorded paths; '' is the version's entry. No join,
 *  no listing, no index fallback, no case folding. Answers the recorded path or undefined. */
export const resolveFile = (version: PageVersion, path: string): string | undefined => {
  const wanted = path === '' ? version.entry : path;
  return version.files.some((file) => file.path === wanted) ? wanted : undefined;
};

const TEXT = 'text/plain; charset=utf-8';
/** A Map: an extension such as "constructor" must not find an inherited entry. */
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['html', 'text/html; charset=utf-8'],
  ['htm', 'text/html; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'],
  ['mjs', 'text/javascript; charset=utf-8'],
  ['json', 'application/json; charset=utf-8'],
  ['csv', TEXT],
  ['md', TEXT],
  ['mmd', TEXT],
  ['mermaid', TEXT],
  ['txt', TEXT],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['woff2', 'font/woff2'],
]);

/** The fixed table; an extension outside it has no type and the responder answers 415. */
export const contentTypeFor = (path: string): string | undefined => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return CONTENT_TYPES.get(name.slice(dot + 1).toLowerCase());
};
