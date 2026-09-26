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
  // Checked per call, not at creation: availability can change (e.g. a login/logout in between).
  const requireEncryption = (): void => {
    if (!cipher.isEncryptionAvailable()) throw new Error('secret storage unavailable');
  };
  return {
    async put(ref: string, value: string): Promise<void> {
      requireEncryption();
      const blob = cipher.encryptString(value);
      db.raw
        .prepare(
          'INSERT INTO secrets (ref, blob) VALUES (?, ?) ON CONFLICT (ref) DO UPDATE SET blob = excluded.blob',
        )
        .run(ref, blob);
    },
    async get(ref: string): Promise<string | undefined> {
      requireEncryption();
      const row = db.raw.prepare('SELECT blob FROM secrets WHERE ref = ?').get(ref);
      if (row === undefined) return undefined;
      const blob = row.blob;
      if (!(blob instanceof Uint8Array)) throw new Error('secrets.blob did not hold bytes');
      return cipher.decryptString(blob);
    },
    async remove(ref: string): Promise<void> {
      db.raw.prepare('DELETE FROM secrets WHERE ref = ?').run(ref);
    },
  };
}
