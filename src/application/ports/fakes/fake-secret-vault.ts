// In-memory SecretVault — refs to values, never inspected by anything else.
import type { SecretVault } from '../secret-vault';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeSecretVault extends SecretVault {}

export const createFakeSecretVault = (): FakeSecretVault => {
  const values = new Map<string, string>();

  return {
    put: async (ref: string, value: string): Promise<void> => {
      values.set(ref, value);
    },

    get: async (ref: string): Promise<string | undefined> => values.get(ref),

    remove: async (ref: string): Promise<void> => {
      values.delete(ref);
    },
  };
};
