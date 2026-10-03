import type { CatalogModel } from '../../domain/index';

/** The id a model's quota pools are matched with. Pools match by model-family id, but a
 *  subscription route runs on alias ids (`opus`), so the alias checks as the id it stands for.
 *  Without a catalog entry that names one, the model itself is the best evidence; no model is `''`. */
export const matchIdFor = (catalog: readonly CatalogModel[], model: string | undefined): string => {
  if (model === undefined) return '';
  return catalog.find((entry) => entry.id === model)?.resolvedId ?? model;
};

/** The catalog is a refinement, never a gate: a failing read leaves the list empty so the model
 *  stands in and dispatch carries on. */
export const catalogOrEmpty = async (read: () => Promise<readonly CatalogModel[]>): Promise<readonly CatalogModel[]> => {
  try {
    return await read();
  } catch {
    return [];
  }
};
