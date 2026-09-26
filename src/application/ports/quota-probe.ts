// Quota probe port — one poll of a provider's usage/quota surface. Contract: docs/v2/providers.md
// → "Quota probes (P-18 … P-21)" and docs/v2/application.md § 6. Readings are id-free
// observations; identity is assigned only when the use case persists them.
import type { Meter, ModelMatcher, PoolKind, Result } from '../../domain/index';

export type QuotaProbeError = 'not_installed' | 'not_logged_in' | 'probe_failed' | 'unknown_provider';

export interface MeterReading {
  readonly pool: { readonly label: string; readonly kind: PoolKind; readonly appliesTo: readonly ModelMatcher[] | 'all' };
  readonly meter: Omit<Meter, 'id' | 'poolId'>;
}

export interface QuotaProbe {
  poll(defId: string, binPath: string | null): Promise<Result<readonly MeterReading[], QuotaProbeError>>;
}

export interface QuotaProbeResolver {
  forProvider(defId: string): QuotaProbe | undefined;
}
