// capability-candidates.ts — the query side of capability discovery (A-90 … A-92): scan the
// accounts the store holds, merge same-identity finds (R-63), and answer the candidate list the
// Yetenekler surfaces render. A read: no actor, no audit entry (the A-81 stance).
import type { CapabilityCandidate, CapabilityDef, CapabilitySlug } from '../../domain/index';
import { capabilitySlugOf, identityOfDefinition, mergeCandidates } from '../../domain/index';
import type { AppDeps } from '../ports/deps';
import type { CapabilityScanAccount } from '../ports/capability-discovery';

export const CAPABILITY_CANDIDATES_MAX = 200; // the merged list the query answers
export const CAPABILITY_DESCRIPTION_MAX = 300; // code points, the view's description cut

export interface CapabilityCandidateView {
  readonly identity: string; // mergeCandidates' canonical form (R-63)
  readonly kind: 'mcp' | 'skill' | 'context';
  readonly name: string;
  readonly sources: readonly string[]; // account ids, sorted, unique — plain strings on the wire
  readonly command?: string; // mcp only
  readonly path?: string; // skill / context; the source file's absolute path
  readonly description?: string; // ≤ CAPABILITY_DESCRIPTION_MAX code points
  readonly imported: boolean;
}

export interface CapabilityCandidatesView {
  readonly candidates: readonly CapabilityCandidateView[]; // identity, code-point order
  readonly truncated: boolean; // the port found more than the cap
}

/** The raw scan behind both the query and the import: the store's accounts mapped to the one
 *  shape the scan reads (A-90), then the port. Every failure is empty — a broken account never
 *  stops the rest. */
export async function scanRawCandidates(
  deps: Pick<AppDeps, 'accounts' | 'capabilityDiscovery'>,
): Promise<readonly CapabilityCandidate[]> {
  let accounts: readonly CapabilityScanAccount[] = [];
  try {
    accounts = (await deps.accounts.list()).map((account): CapabilityScanAccount => ({
      id: account.id,
      provider: account.provider,
      ...(account.identityDir === undefined ? {} : { identityDir: account.identityDir }),
    }));
  } catch {
    accounts = [];
  }
  try {
    return await deps.capabilityDiscovery.scan(accounts);
  } catch {
    return [];
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Unquotes a YAML scalar the store's serializer can write; undefined = outside the flat subset. */
const scalarOf = (value: string): string | undefined => {
  if (value === '' || value.startsWith('|') || value.startsWith('>') || value.startsWith('[') || value.startsWith('{')) {
    return undefined;
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
};

/** The identity fields of a stored capability file, or undefined when it does not parse. The real
 *  store's files are flat YAML mappings (one definition per file); the fake's are JSON, bare or
 *  wrapped. Only kind, name and command are ever read — a stored env block is never touched, so
 *  the application layer needs no YAML package for the identity check. */
export const definitionOfContent = (content: string): CapabilityDef | undefined => {
  const ofMapping = (mapping: Readonly<Record<string, unknown>>): CapabilityDef | undefined => {
    const kind = mapping['kind'];
    const name = mapping['name'];
    const id = mapping['id'];
    if (typeof kind !== 'string' || typeof name !== 'string' || typeof id !== 'string') return undefined;
    if (kind === 'mcp') {
      const command = mapping['command'];
      return typeof command === 'string' ? { kind, id: id as CapabilitySlug, name, command, args: [], env: {} } : undefined;
    }
    if (kind === 'skill' || kind === 'context') {
      const path = mapping['path'];
      return typeof path === 'string' ? { kind, id: id as CapabilitySlug, name, path } : undefined;
    }
    return undefined; // 'hook' has no candidate kind; it can never match an import identity
  };

  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) return undefined;
      const wrapped = parsed['capabilities'];
      if (Array.isArray(wrapped) && isRecord(wrapped[0])) return ofMapping(wrapped[0]);
      return ofMapping(parsed);
    } catch {
      return undefined;
    }
  }
  const fields = new Map<string, string>();
  for (const line of content.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ ]+(.*))?$/.exec(line);
    if (match === null || fields.has(match[1])) continue;
    const value = match[2] === undefined ? undefined : scalarOf(match[2]);
    if (value !== undefined) fields.set(match[1], value);
  }
  if (fields.size === 0) return undefined;
  return ofMapping(Object.fromEntries(fields));
};

/** A-92: the identity a stored target carries — `undefined` when the target is missing or its
 *  file does not parse. One target per candidate: never enumerates the store, never rescans. */
export async function storedIdentityOf(
  definitions: Pick<AppDeps['definitions'], 'readFile'>,
  id: CapabilitySlug,
): Promise<string | undefined> {
  let file: { readonly content: string } | undefined;
  try {
    file = await definitions.readFile({ kind: 'global' }, `capabilities/${id}.yaml`);
  } catch {
    return undefined;
  }
  if (file === undefined) return undefined;
  const def = definitionOfContent(file.content);
  return def === undefined ? undefined : identityOfDefinition(def);
}

/** A-92: `imported` against the global store, target-wise — the id R-67 derives from the
 *  candidate's own name; a file that exists, parses and carries the candidate's identity → true. */
export async function isImported(
  definitions: Pick<AppDeps['definitions'], 'readFile'>,
  candidate: CapabilityCandidate,
): Promise<boolean> {
  const slug = capabilitySlugOf(candidate.name);
  if (!slug.ok) return false;
  return (await storedIdentityOf(definitions, slug.value)) === candidate.identity;
}

export async function capabilityCandidates(
  deps: Pick<AppDeps, 'accounts' | 'capabilityDiscovery' | 'definitions'>,
): Promise<CapabilityCandidatesView> {
  const found = await scanRawCandidates(deps);
  // A-91: merge (R-63), sort by identity in code-point order, cap with `truncated`.
  const merged = [...mergeCandidates(found)].sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  const truncated = merged.length > CAPABILITY_CANDIDATES_MAX;

  const candidates: CapabilityCandidateView[] = [];
  for (const candidate of merged.slice(0, CAPABILITY_CANDIDATES_MAX)) {
    const description = candidate.description === undefined
      ? undefined
      : [...candidate.description].slice(0, CAPABILITY_DESCRIPTION_MAX).join('');
    candidates.push({
      identity: candidate.identity,
      kind: candidate.kind,
      name: candidate.name,
      sources: [...candidate.sources],
      ...(candidate.command === undefined ? {} : { command: candidate.command }),
      ...(candidate.path === undefined ? {} : { path: candidate.path }),
      ...(description === undefined ? {} : { description }),
      imported: await isImported(deps.definitions, candidate),
    });
  }
  return { candidates, truncated };
}
