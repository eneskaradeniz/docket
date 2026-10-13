// use-cases/library.ts — A-343: the A-327 use case. A role, flow, capability or memory library
// edit becomes the definition's next version: the body is validated before anything is written,
// the port's `appendVersion` is the only write (`stale` when a concurrent writer got there
// first), and one `library.version_created` audit lands per created version.
import type { Actor, DefinitionIssue, Result, VersionRecord } from '../../domain/index';
import { err, ok, validateDefinitions } from '../../domain/index';

import type { AppDeps, DefinitionKind } from '../ports';

export type SaveVersionError = 'definitions_invalid' | 'stale';

/** The body validated as the only definition of its kind: `validateDefinitions` narrows its
 *  shape and its internal references. The cross-definition context (a role's capabilities,
 *  which live in other library files) reaches this path with the YAML adapter (#1009), which
 *  owns the library files the histories mirror; the memory kind has no validation model until
 *  its own issues land, so those bodies pass through unvalidated. */
const validateBody = (kind: DefinitionKind, body: unknown): Result<void, readonly DefinitionIssue[]> => {
  if (kind === 'memory') return ok(undefined);
  const validated = validateDefinitions({
    roles: kind === 'roles' ? [body] : [],
    flows: kind === 'flows' ? [body] : [],
    capabilities: kind === 'capabilities' ? [body] : [],
  });
  return validated.ok ? ok(undefined) : err(validated.error);
};

export async function saveVersion(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'definitions'>,
  input: { readonly kind: DefinitionKind; readonly id: string; readonly body: unknown; readonly actor: Actor },
): Promise<Result<VersionRecord<unknown>, SaveVersionError>> {
  const checked = validateBody(input.kind, input.body);
  if (!checked.ok) return err('definitions_invalid');

  const appended = await deps.definitions.appendVersion(input.kind, input.id, input.body, deps.clock.now());
  if (!appended.ok) return err('stale');

  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: appended.value.recordedAt,
    actor: input.actor,
    action: 'library.version_created',
    subject: { kind: 'definition', id: input.id },
    detail: { kind: input.kind, id: input.id, version: appended.value.version },
  });
  return ok(appended.value);
}
