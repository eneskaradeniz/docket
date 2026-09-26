// Target paths of the YAML definition store and content hashing for optimistic writes.
import type { DefinitionScope } from '../../../application/index';

export type DefinitionKind = 'roles' | 'flows' | 'capabilities';

export type ParsedTarget =
  | { readonly kind: DefinitionKind; readonly id: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'roadmap' };

export function parseTarget(scope: DefinitionScope, target: string): ParsedTarget | undefined {
  void [scope, target];
  throw new Error('not implemented');
}

export function hashContent(content: string): string {
  void content;
  throw new Error('not implemented');
}
