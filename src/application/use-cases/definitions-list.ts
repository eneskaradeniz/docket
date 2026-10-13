// definitions-list.ts — library capability definitions for Settings (A-350): latest version per id,
// filtered by capability kind, with mcp env values never returned on the boundary.
import type { CapabilityDef, VersionRecord } from '../../domain/index';

import type { AppDeps } from '../ports';

export type LibraryCapabilityKind = 'plugin' | 'mcp' | 'skill' | 'command' | 'hook';

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const capabilityKindOf = (body: unknown): CapabilityDef['kind'] | undefined => {
  if (!isRecord(body) || typeof body.kind !== 'string') return undefined;
  const kind = body.kind;
  if (kind === 'mcp' || kind === 'skill' || kind === 'hook' || kind === 'plugin' || kind === 'command' || kind === 'context') {
    return kind;
  }
  return undefined;
};

/** Strips mcp env secret values and secretRef keys; literals stay readable (R-8). */
export const redactCapabilityForList = (body: unknown): unknown => {
  if (!isRecord(body) || body.kind !== 'mcp' || !isRecord(body.env)) return body;
  const env: Record<string, { readonly literal: string } | { readonly secretRef: true }> = {};
  for (const [key, value] of Object.entries(body.env)) {
    if (!isRecord(value)) continue;
    if ('literal' in value && typeof value.literal === 'string') {
      env[key] = { literal: value.literal };
    } else if ('secretRef' in value) {
      env[key] = { secretRef: true };
    }
  }
  return { ...body, env };
};

/** Latest version record per library capability of the requested kind; bodies redacted for the wire. */
export async function listLibraryDefinitionsByKind(
  deps: Pick<AppDeps, 'definitions'>,
  kind: LibraryCapabilityKind,
): Promise<readonly VersionRecord<unknown>[]> {
  const ids = await deps.definitions.listIds('capabilities');
  const records: VersionRecord<unknown>[] = [];
  for (const id of ids) {
    const history = await deps.definitions.listVersions('capabilities', id);
    if (history.length === 0) continue;
    const latest = history[history.length - 1];
    if (capabilityKindOf(latest.body) !== kind) continue;
    records.push({ ...latest, body: redactCapabilityForList(latest.body) });
  }
  return records;
}
