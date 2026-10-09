// stores/pool-scope.ts — whether a pool applies to named models only (U-44). A pool whose
// `appliesTo` lists matchers is model-scoped; `all` and `unknown` are not. The meter list tags
// rows by it, and "Aynı hesapta başka modele geç" is offered only on an account that has one.
import type { SettingsPoolView } from '../../api/queries';

export const isModelScoped = (pool: Pick<SettingsPoolView, 'appliesTo'>): boolean => Array.isArray(pool.appliesTo);

/** Whether the account has a model-scoped pool. */
export const hasModelScopedPool = (pools: readonly Pick<SettingsPoolView, 'appliesTo'>[]): boolean => pools.some(isModelScoped);
