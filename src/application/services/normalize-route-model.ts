import type { CatalogModel, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

export type NormalizeRouteModelError = { readonly code: 'unknown_model'; readonly models: readonly string[] };

/** A-389: when the catalog is non-empty, accept a row id or its resolvedId (rewritten to the alias);
 *  otherwise pass the id through. An empty catalog does not reject — the list is not authoritative yet. */
export const normalizeRouteModel = (
  catalog: readonly CatalogModel[],
  model: string,
): Result<string, NormalizeRouteModelError> => {
  if (catalog.length === 0) return ok(model);
  if (catalog.some((entry) => entry.id === model)) return ok(model);
  const alias = catalog.find((entry) => entry.resolvedId === model);
  if (alias !== undefined) return ok(alias.id);
  return err({ code: 'unknown_model', models: catalog.map((entry) => entry.id) });
};
