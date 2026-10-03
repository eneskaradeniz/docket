// The effort scale and the user's thinking choice. Shared because the resolver (role bindings) and
// providers (capability records) both speak them. Contract: docs/v2/domain.md section 1.

/**
 * Effort levels in ascending order. `'none'` is the provider's thinking-off setting — the lowest
 * step, not the absence of the list — and `'ultra'` is the deepest step reported today.
 */
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/** One of the three user levels, or an exact effort from advanced settings (the only way to reach
 *  `max` and `ultra`). */
export type ThinkingChoice =
  | { readonly level: 'fast' | 'balanced' | 'deep' }
  | { readonly effort: EffortLevel };

/** A model class a route resolves to a concrete model; shared because definitions (stages), the
 *  resolver (bindings) and providers (capability records) all name it. */
export type Tier = 'strong' | 'balanced' | 'fast';
