// capability-import.ts — the command side of capability discovery (A-93): copy selected
// candidates into Docket's own global definitions. Results are per identity — one rejected
// identity never blocks the others. Docket never touches the user's files: the import writes
// <globalRoot>/capabilities/<id>.yaml and nothing else. Every import is audited (A-95): one
// capability.imported entry per imported capability, after the write it reports on.
import type { Actor, CapabilityCandidate, CapabilityDef, CapabilitySlug } from '../../domain/index';
import { candidateToDefinition, capabilitySlugOf, mergeCandidates, suffixedSlug } from '../../domain/index';
import type { AppDeps } from '../ports/deps';

import { scanRawCandidates, storedIdentityOf } from './capability-candidates';

export type CapabilityImportError =
  | 'not_found' // an identity the current scan does not carry
  | 'invalid_name' // R-67 derived an empty slug
  | 'missing_command' // candidateToDefinition, verbatim (R-65)
  | 'missing_path' // candidateToDefinition, verbatim (R-65)
  | 'id_taken' // the target exists with a different identity
  | 'invalid_definition'; // validateCandidate returned issues

export type CapabilityImportResult =
  | { readonly identity: string; readonly status: 'imported'; readonly id: CapabilitySlug }
  | { readonly identity: string; readonly status: 'already_present'; readonly id: CapabilitySlug }
  | { readonly identity: string; readonly status: 'rejected'; readonly reason: CapabilityImportError };

export async function importCapabilities(
  deps: Pick<AppDeps, 'accounts' | 'capabilityDiscovery' | 'definitions' | 'clock' | 'ids' | 'log'>,
  input: { readonly identities: readonly string[]; readonly actor: Actor },
): Promise<readonly CapabilityImportResult[]> {
  const byIdentity = new Map<string, CapabilityCandidate>(
    [...mergeCandidates(await scanRawCandidates(deps))].map((candidate) => [candidate.identity, candidate]),
  );

  // R-67's collision arm: ids are assigned in the order the identities are carried; each takes
  // the first slug (base, base-2, base-3, …) not already assigned in this call.
  const assigned = new Set<CapabilitySlug>();
  const decided = new Map<string, CapabilityImportResult>();
  const toWrite: CapabilityDef[] = [];
  const toAudit: { readonly id: CapabilitySlug; readonly kind: CapabilityCandidate['kind']; readonly identity: string }[] = [];

  const settle = (identity: string, result: CapabilityImportResult, def?: CapabilityDef): void => {
    decided.set(identity, result);
    if (def !== undefined) toWrite.push(def);
  };

  const results: CapabilityImportResult[] = [];
  for (const identity of input.identities) {
    const first = decided.get(identity);
    // A repeated identity echoes its first outcome: this call decides it exactly once.
    if (first !== undefined) {
      results.push(first);
      continue;
    }

    const candidate = byIdentity.get(identity);
    if (candidate === undefined) {
      settle(identity, { identity, status: 'rejected', reason: 'not_found' });
    } else {
      const base = capabilitySlugOf(candidate.name);
      if (!base.ok) {
        settle(identity, { identity, status: 'rejected', reason: 'invalid_name' });
      } else {
        let id = base.value;
        for (let suffix = 2; assigned.has(id); suffix += 1) id = suffixedSlug(base.value, suffix);
        assigned.add(id);
        // A-92's check at the final id: equal identity → idempotent skip; a different one → the
        // file at that target is somebody else's and is never overwritten.
        const stored = await storedIdentityOf(deps.definitions, id);
        if (stored === candidate.identity) {
          settle(identity, { identity, status: 'already_present', id });
        } else if (stored !== undefined) {
          settle(identity, { identity, status: 'rejected', reason: 'id_taken' });
        } else {
          const mapped = candidateToDefinition(candidate, id);
          if (!mapped.ok) {
            // 'unsupported_kind' is the deferred hook reaching a plain-JS caller; on the wire it
            // reads as what it is — a candidate that cannot become a definition.
            settle(identity, {
              identity,
              status: 'rejected',
              reason: mapped.error === 'unsupported_kind' ? 'invalid_definition' : mapped.error,
            });
          } else {
            // JSON is the one serialisation both stores parse — YAML's flow syntax for the real
            // store's validator, plain JSON for the fake's.
            const target = `capabilities/${id}.yaml`;
            const validated = await deps.definitions.validateCandidate({ kind: 'global' }, target, JSON.stringify(mapped.value));
            if (!validated.ok) {
              settle(identity, { identity, status: 'rejected', reason: 'invalid_definition' });
            } else {
              settle(identity, { identity, status: 'imported', id }, mapped.value);
              toAudit.push({ id, kind: candidate.kind, identity });
            }
          }
        }
      }
    }
    const outcome = decided.get(identity);
    if (outcome !== undefined) results.push(outcome);
  }

  if (toWrite.length > 0) await deps.definitions.installCapabilities(toWrite);
  // A-95: one entry per imported capability, subject the stored slug (the id the import
  // returned, so EventLog.list finds the entry from the definition) and a detail that names
  // targets only — the capability's kind and the identity's path/command form. The write the
  // entry reports on is already durable, so an append that fails must not fail or roll it back.
  for (const { id, kind, identity } of toAudit) {
    try {
      await deps.log.append({
        id: deps.ids.next<'audit'>(),
        at: deps.clock.now(),
        actor: input.actor,
        action: 'capability.imported',
        subject: { kind: 'capability', id },
        detail: { kind, identity },
      });
    } catch {
      // The import stands; the audit trail misses this entry, nothing more.
    }
  }
  return results;
}
