import { describe, expect, it } from 'vitest';

import { createFakeSecretVault } from './fake-secret-vault';

describe('createFakeSecretVault', () => {
  it('put/get round-trip a value and a later put overwrites it', async () => {
    const vault = createFakeSecretVault();
    await vault.put('account/1/token', 'secret-one');
    expect(await vault.get('account/1/token')).toBe('secret-one');

    await vault.put('account/1/token', 'secret-two');
    expect(await vault.get('account/1/token')).toBe('secret-two');
  });

  it('get of a missing ref is undefined', async () => {
    const vault = createFakeSecretVault();
    expect(await vault.get('missing')).toBeUndefined();
  });

  it('remove deletes the value and is a no-op on missing refs', async () => {
    const vault = createFakeSecretVault();
    await vault.put('account/1/token', 'secret-one');

    await vault.remove('account/1/token');
    expect(await vault.get('account/1/token')).toBeUndefined();
    await expect(vault.remove('account/1/token')).resolves.toBeUndefined();
  });
});
