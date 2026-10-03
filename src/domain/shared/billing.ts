// The spend-consent boundary shared by the capability records and the limit policy
// (docs/v2/provider-capabilities.md section 14). It lives in shared because both the providers
// and the quota modules speak it and may import nothing else in common.
/**
 * How a model's use is paid for on a route. `included` and `metered` are verified states;
 * `unknown` is never assumed to be free nor to cost a given amount.
 */
export type Billing = 'included' | 'metered' | 'unknown';
