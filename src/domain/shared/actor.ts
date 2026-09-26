import type { RoleSlug, RunId } from './ids';

export type Actor =
  | { readonly kind: 'user'; readonly id: string; readonly label?: string }
  | { readonly kind: 'agent'; readonly runId: RunId; readonly role: RoleSlug }
  | { readonly kind: 'system'; readonly component: string };
