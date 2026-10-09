// definitions/candidates.ts — capability candidates found in an account's config, before the user
// imports them into their definitions (#715 part 1). Pure identity/merge rule + CapabilityDef mapping.
import { err, ok, type AccountId, type CapabilitySlug, type Result } from '../shared';
import type { CapabilityDef } from './types';

export type CapabilityCandidateKind = 'mcp' | 'skill' | 'context'; // 'hook' is deferred (executable code)

export interface CapabilityCandidate {
  readonly identity: string; // see R-62; mergeCandidates writes the canonical form into its output
  readonly kind: CapabilityCandidateKind;
  readonly name: string;
  readonly sources: readonly AccountId[]; // sorted, unique
  readonly command?: string; // mcp
  readonly path?: string; // skill / context
  readonly description?: string;
}

/** R-62: `kind + ':' + name` for skill/context (case-sensitive), `'mcp:' + name + '|' + command` for
 *  mcp. A missing mcp command joins as the empty string — identity is total; the gap surfaces at
 *  import time as `missing_command` (R-65), never as a merge error. */
const identityOf = (c: CapabilityCandidate): string =>
  c.kind === 'mcp' ? `mcp:${c.name}|${c.command ?? ''}` : `${c.kind}:${c.name}`;

type ConflictField = 'command' | 'path' | 'description';

/** R-63: merge candidates with equal identity into one. The merge key is the identity derived from
 *  the candidate's own fields (R-62), so a scanner that builds the `identity` string differently
 *  cannot split or glue capabilities; the output carries the canonical identity. */
export function mergeCandidates(found: readonly CapabilityCandidate[]): readonly CapabilityCandidate[] {
  interface Group {
    readonly kind: CapabilityCandidateKind;
    readonly name: string;
    readonly sources: Set<AccountId>;
    // per conflicting field: the smallest backing account seen so far and the value it backs.
    // A tie keeps the first-seen value, which makes merging a merged output again a no-op.
    // `account` undefined = a sourceless candidate's value: first-seen among its own, but any
    // account-backed value beats it (the smallest account's value is what the rule keeps).
    readonly picks: Map<ConflictField, { readonly account: AccountId | undefined; readonly value: string }>;
  }
  const groups = new Map<string, Group>();

  for (const c of found) {
    const key = identityOf(c);
    let group = groups.get(key);
    if (group === undefined) {
      group = { kind: c.kind, name: c.name, sources: new Set<AccountId>(), picks: new Map() };
      groups.set(key, group);
    }
    // every source account backs this candidate's values; only the smallest can ever win,
    // so comparing minima is enough to find the lexicographically smallest backer.
    const smallest: AccountId | undefined = [...c.sources].sort()[0];
    for (const field of ['command', 'path', 'description'] as const) {
      const value = c[field];
      if (value === undefined) continue;
      const held = group.picks.get(field);
      if (held === undefined) group.picks.set(field, { account: smallest, value });
      else if (smallest !== undefined && (held.account === undefined || smallest < held.account)) {
        group.picks.set(field, { account: smallest, value });
      }
    }
    for (const source of c.sources) group.sources.add(source);
  }

  const merged: CapabilityCandidate[] = [];
  for (const [identity, group] of groups) {
    merged.push({
      identity,
      kind: group.kind,
      name: group.name,
      sources: [...group.sources].sort(),
      ...(group.picks.has('command') ? { command: group.picks.get('command')?.value } : {}),
      ...(group.picks.has('path') ? { path: group.picks.get('path')?.value } : {}),
      ...(group.picks.has('description') ? { description: group.picks.get('description')?.value } : {}),
    });
  }
  return merged;
}

/** R-64/R-65: map an imported candidate to a `CapabilityDef`. mcp copies only the command string —
 *  `args` and `env` start empty: a candidate carries no environment values, so the imported server
 *  runs with nothing until the user adds what it needs. `description` has no place in a
 *  `CapabilityDef` and is dropped. */
export function candidateToDefinition(
  c: CapabilityCandidate,
  id: CapabilitySlug,
): Result<CapabilityDef, 'unsupported_kind' | 'missing_command' | 'missing_path'> {
  switch (c.kind) {
    case 'mcp':
      if (c.command === undefined) return err('missing_command');
      return ok({ kind: 'mcp', id, name: c.name, command: c.command, args: [], env: {} });
    case 'skill':
    case 'context':
      if (c.path === undefined) return err('missing_path');
      return ok({ kind: c.kind, id, name: c.name, path: c.path });
    default:
      // 'hook' is deferred (executable code) and anything else is not a candidate kind; a
      // plain-JS caller can still pass one, so the switch keeps a runtime way out.
      return err('unsupported_kind');
  }
}
