// Tests for the keychain vault (rules I-9 and I-10). The cipher is a local reversible function
// (base64 of the reversed bytes) so the vault runs under plain Node; databases are real file
// databases in a temporary folder, never the user's home.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretVault } from '../../../application/index';
import { openDatabase, type DocketDb } from '../sqlite/index';
import { createKeychainVault, type CipherFns } from './vault';

// Credential-looking fixtures are assembled at runtime, never written as one literal.
const VALUE = 'AKIA' + 'X'.repeat(16);
const OTHER_VALUE = 'sk-' + 'y'.repeat(24);
const REF = 'providers/example/api-key';
const OTHER_REF = 'providers/example/secondary-key';

// Reversible test cipher: base64 of the reversed UTF-8 bytes, so the stored blob never holds the
// plaintext and the roundtrip is exact.
function createTestCipher(available: boolean): CipherFns {
  return {
    isEncryptionAvailable: () => available,
    encryptString(plain: string): Uint8Array {
      const reversed = Buffer.from(plain, 'utf8').reverse();
      return Buffer.from(reversed.toString('base64'), 'utf8');
    },
    decryptString(blob: Uint8Array): string {
      return Buffer.from(Buffer.from(blob).toString('utf8'), 'base64').reverse().toString('utf8');
    },
  };
}

describe('createKeychainVault', () => {
  let tmp: string;
  let db: DocketDb;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'docket-keychain-'));
    const result = openDatabase(join(tmp, 'docket.db'));
    if (!result.ok) throw new Error('expected openDatabase to succeed');
    db = result.value;
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  function openVault(available = true): SecretVault {
    return createKeychainVault(db, createTestCipher(available));
  }

  function storedBlob(ref: string): Uint8Array | undefined {
    const row = db.raw.prepare('SELECT blob FROM secrets WHERE ref = ?').get(ref);
    if (row === undefined) return undefined;
    const blob = row.blob;
    return blob instanceof Uint8Array ? blob : undefined;
  }

  function secretsRowCount(): number {
    const row = db.raw.prepare('SELECT COUNT(*) AS n FROM secrets').get();
    return Number(row === undefined ? undefined : row.n);
  }

  async function errorMessage(run: () => Promise<unknown>): Promise<string | undefined> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return undefined;
  }

  it('I-9: put stores encryptString(value) in secrets and get returns decryptString(blob)', async () => {
    const cipher = createTestCipher(true);
    const vault = createKeychainVault(db, cipher);
    await vault.put(REF, VALUE);
    const blob = storedBlob(REF);
    if (blob === undefined) throw new Error('expected a stored blob');
    // Byte comparison: node:sqlite returns a plain Uint8Array while encryptString returns a Buffer.
    expect(Buffer.compare(Buffer.from(blob), Buffer.from(cipher.encryptString(VALUE)))).toBe(0);
    expect(Buffer.from(blob).toString('utf8')).not.toBe(VALUE);
    expect(await vault.get(REF)).toBe(VALUE);
  });

  it('I-9: put on an existing ref upserts', async () => {
    const vault = openVault();
    await vault.put(REF, VALUE);
    await vault.put(REF, OTHER_VALUE);
    expect(secretsRowCount()).toBe(1);
    expect(await vault.get(REF)).toBe(OTHER_VALUE);
  });

  it('I-9: get returns undefined for an unknown ref', async () => {
    const vault = openVault();
    expect(await vault.get(REF)).toBeUndefined();
  });

  it('I-9: remove deletes the secret and is idempotent', async () => {
    const vault = openVault();
    await vault.put(REF, VALUE);
    await vault.remove(REF);
    expect(await vault.get(REF)).toBeUndefined();
    expect(storedBlob(REF)).toBeUndefined();
    await vault.remove(REF);
    expect(secretsRowCount()).toBe(0);
  });

  it('I-9: refs are stored and removed independently', async () => {
    const vault = openVault();
    await vault.put(REF, VALUE);
    await vault.put(OTHER_REF, OTHER_VALUE);
    expect(await vault.get(REF)).toBe(VALUE);
    expect(await vault.get(OTHER_REF)).toBe(OTHER_VALUE);
    await vault.remove(REF);
    expect(await vault.get(REF)).toBeUndefined();
    expect(await vault.get(OTHER_REF)).toBe(OTHER_VALUE);
  });

  it('I-9: after put, the database file bytes and its -wal file do not contain the value', async () => {
    const vault = openVault();
    await vault.put(REF, VALUE);
    for (const name of ['docket.db', 'docket.db-wal']) {
      const path = join(tmp, name);
      if (!existsSync(path)) continue;
      // latin1 maps bytes 1:1 so the check runs on the raw file bytes.
      expect(readFileSync(path).toString('latin1')).not.toContain(VALUE);
    }
  });

  it('I-9: roundtrips an empty value', async () => {
    const vault = openVault();
    await vault.put(REF, '');
    expect(await vault.get(REF)).toBe('');
  });

  it('I-10: put throws secret storage unavailable and stores nothing when encryption is unavailable', async () => {
    const vault = openVault(false);
    const message = await errorMessage(() => vault.put(REF, VALUE));
    expect(message).toBe('secret storage unavailable');
    expect(message).not.toContain(VALUE);
    expect(secretsRowCount()).toBe(0);
  });

  it('I-10: get throws secret storage unavailable when encryption is unavailable', async () => {
    const vault = openVault(false);
    const message = await errorMessage(() => vault.get(REF));
    expect(message).toBe('secret storage unavailable');
    expect(message).not.toContain(VALUE);
  });

  it('I-10: get does not fall back to plaintext when availability flips off after a put', async () => {
    const vault = openVault(true);
    await vault.put(REF, VALUE);
    const locked = openVault(false);
    const message = await errorMessage(() => locked.get(REF));
    expect(message).toBe('secret storage unavailable');
    expect(message).not.toContain(VALUE);
  });
});
