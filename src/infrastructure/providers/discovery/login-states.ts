import type { DiscoveredProvider } from '../../../application/index';

/** The latest login answer discovery produced per provider definition. A listing that needs an
 * account reads it instead of probing again: it holds the answer a discovery pass already paid
 * for, and a provider discovery has not reported on yet reads as `undefined`. */
export interface LoginStates {
  record(result: DiscoveredProvider): void;
  /** `true` logged in, `false` logged out, `null` the probe had no answer (not installed,
   * failed, none defined), `undefined` discovery has not reported this provider. */
  get(providerId: string): boolean | null | undefined;
}

export function createLoginStates(): LoginStates {
  const latest = new Map<string, boolean | null>();
  return {
    record: (result) => {
      latest.set(result.defId, result.loggedIn);
    },
    get: (providerId) => latest.get(providerId),
  };
}
