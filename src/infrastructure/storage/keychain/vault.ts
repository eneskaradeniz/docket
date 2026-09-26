// Secret vault over the `secrets` table; Electron's safeStorage is injected as CipherFns so this
// adapter also runs under plain Node and vitest. Plaintext never reaches the database file.
import type { SecretVault } from '../../../application/index';
import type { DocketDb } from '../sqlite/index';

/** Supplied by electron/main.ts from Electron's safeStorage; tests pass a reversible test cipher. */
export interface CipherFns {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Uint8Array;
  decryptString(blob: Uint8Array): string;
}

export function createKeychainVault(db: DocketDb, cipher: CipherFns): SecretVault {
  void [db, cipher];
  throw new Error('not implemented');
}
