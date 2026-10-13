// Target paths of the YAML definition store and content hashing for optimistic writes.
import { createHash } from 'node:crypto';

import { parseSlug } from '../../../domain/index';

export type DefinitionKind = 'roles' | 'flows' | 'capabilities' | 'memory';

export type ParsedTarget =
  | { readonly kind: DefinitionKind; readonly id: string; readonly version: number }
  | { readonly kind: 'project' }
  | { readonly kind: 'repo' }
  | { readonly kind: 'roadmap' };

const KINDS: readonly DefinitionKind[] = ['roles', 'flows', 'capabilities', 'memory'];
const LIBRARY_ROOT = 'library';
const PROJECTS_ROOT = 'projects';
const REPOS_ROOT = 'repos';
// A version file name: v plus a positive integer without a leading zero.
const VERSION_FILE = /^v([1-9][0-9]*)\.yaml$/;

const isDefinitionKind = (value: string): value is DefinitionKind =>
  (KINDS as readonly string[]).includes(value);

const isSlugSegment = (value: string): boolean => parseSlug(value).ok;

/**
 * Recognises exactly the store's own relative targets under the global root. Everything a path
 * can do to escape the root — absolute prefixes, `..`/`.` segments, backslashes, deeper folders,
 * other extensions, upper case — fails the segment shapes or the domain slug pattern, so the
 * caller can join the target onto the root without a traversal check of its own.
 */
export function parseTarget(target: string): ParsedTarget | undefined {
  // Backslashes are never separators here: a target carrying one is not a store file.
  if (target.includes('\\')) return undefined;

  const parts = target.split('/');
  if (parts.includes('') || parts.includes('.') || parts.includes('..')) return undefined;

  if (parts.length === 4 && parts[0] === LIBRARY_ROOT) {
    const [, kind, id, fileName] = parts;
    if (!isDefinitionKind(kind)) return undefined;
    if (!isSlugSegment(id)) return undefined;
    const version = VERSION_FILE.exec(fileName);
    return version === null ? undefined : { kind, id, version: Number(version[1]) };
  }

  if (parts.length === 3 && parts[0] === PROJECTS_ROOT) {
    const [, slug, fileName] = parts;
    if (!isSlugSegment(slug)) return undefined;
    if (fileName === 'project.yaml') return { kind: 'project' };
    if (fileName === 'roadmap.yaml') return { kind: 'roadmap' };
    return undefined;
  }

  if (parts.length === 3 && parts[0] === REPOS_ROOT) {
    const [, slug, fileName] = parts;
    if (!isSlugSegment(slug)) return undefined;
    if (fileName === 'repo.yaml') return { kind: 'repo' };
    return undefined;
  }

  return undefined;
}

/** sha256 over the UTF-8 bytes, lowercase hex — the optimistic-write content hash. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
