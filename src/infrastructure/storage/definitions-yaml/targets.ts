// Target paths of the YAML definition store and content hashing for optimistic writes.
import { createHash } from 'node:crypto';

import type { DefinitionScope } from '../../../application/index';
import { parseSlug } from '../../../domain/index';

export type DefinitionKind = 'roles' | 'flows' | 'capabilities';

export type ParsedTarget =
  | { readonly kind: DefinitionKind; readonly id: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'roadmap' };

const KINDS: readonly DefinitionKind[] = ['roles', 'flows', 'capabilities'];
const WORKSPACE_ONLY_FILES = ['workspace.yaml', 'roadmap.yaml'] as const;
const EXTENSION = '.yaml';

const isDefinitionKind = (value: string): value is DefinitionKind =>
  (KINDS as readonly string[]).includes(value);

/**
 * Recognises exactly the store's own relative targets. Everything a path can do to escape the
 * root — absolute prefixes, `..`/`.` segments, backslashes, deeper folders, other extensions,
 * upper case — fails either the two-segment shape or the domain slug pattern, so the caller can
 * join the target onto a root without a traversal check of its own.
 */
export function parseTarget(scope: DefinitionScope, target: string): ParsedTarget | undefined {
  // Backslashes are never separators here: a target carrying one is not a store file.
  if (target.includes('\\')) return undefined;

  if ((WORKSPACE_ONLY_FILES as readonly string[]).includes(target)) {
    return scope.kind === 'workspace'
      ? target === 'workspace.yaml'
        ? { kind: 'workspace' }
        : { kind: 'roadmap' }
      : undefined;
  }

  const parts = target.split('/');
  if (parts.length !== 2) return undefined;
  const [folder, fileName] = parts;
  if (!isDefinitionKind(folder)) return undefined;
  if (!fileName.endsWith(EXTENSION)) return undefined;

  const stem = fileName.slice(0, -EXTENSION.length);
  const slug = parseSlug(stem);
  return slug.ok ? { kind: folder, id: slug.value } : undefined;
}

/** sha256 over the UTF-8 bytes, lowercase hex — the optimistic-write content hash. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
