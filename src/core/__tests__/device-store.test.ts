// src/core/__tests__/device-store.test.ts — the pairing state machine + the DeviceStore port's
// core-side shape (WO-0102, plan §2.4/§2.5). The machine is PURE (pairingVerdict over an injected
// clock); the FakeDeviceStore here applies it exactly as the SQLite half must, so the port's
// semantics are pinned without I/O. The SQLite implementation itself is pinned adapter-side in
// src/adapters/store/store.test.ts.
import { describe, expect, it } from 'vitest';
import {
  PAIRING_MAX_ATTEMPTS,
  grantExpiresAt,
  pairingVerdict,
  type PairingExchangeResult,
  type StoredGrant,
} from '../remote';
import type { DeviceStore } from '../device-store';

const MINT = '2026-09-24T12:00:00.000Z';
const NOW_AT_MINT = MINT;
const AFTER_TTL = '2026-09-24T12:05:00.001Z'; // one tick past expiry
const JUST_BEFORE_TTL = '2026-09-24T12:04:59.999Z';

/** The in-memory port realization the tests drive — applies core's pairingVerdict verbatim
 *  (the same discipline the SQLite adapter must follow; ids/keys are fixture-shaped). */
class FakeDeviceStore implements DeviceStore {
  grants = new Map<string, StoredGrant>();
  devices: Array<{ id: string; name: string; keyHash: string; createdAt: string; lastSeenAt: string | null }> = [];
  private seq = 0;

  async mintGrant(now: string): Promise<{ code: string; expiresAt: string; attemptsLeft: number }> {
    // supersede: one live grant at a time
    this.grants.clear();
    const code = String(100000 + this.seq++).slice(0, 6); // deterministic fixture code
    const grant: StoredGrant = { code, expiresAt: grantExpiresAt(now), attemptsLeft: PAIRING_MAX_ATTEMPTS, used: false };
    this.grants.set(code, grant);
    return { code, expiresAt: grant.expiresAt, attemptsLeft: grant.attemptsLeft };
  }

  async exchange(code: string, deviceName: string, now: string): Promise<PairingExchangeResult> {
    // ONE live grant by construction (mint supersedes) — the lookup fetches THE row, so a wrong
    // code still finds (and strikes) the grant it was guessed against (the SQL half's discipline).
    const grant = [...this.grants.values()][0];
    const verdict = pairingVerdict(grant, code, now);
    if (verdict.kind === 'ok') {
      const id = `dv-${this.seq++}`;
      this.devices.push({ id, name: deviceName, keyHash: `hash-${id}`, createdAt: now, lastSeenAt: null });
      grant!.used = true; // the row stays, marked used: a replayed code reads 'used', the honest reason
      return { kind: 'paired', deviceId: id, deviceKey: `dk-${id}` };
    }
    if (verdict.kind === 'wrong_code') {
      grant!.attemptsLeft = verdict.attemptsLeft;
      return { kind: 'invalid_code', attemptsLeft: verdict.attemptsLeft };
    }
    if (grant !== undefined) this.grants.delete(grant.code); // a dead grant is cleaned up, never resurrected
    return { kind: 'dead', reason: verdict.reason };
  }

  async listDevices() {
    return this.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt }));
  }

  async revokeDevice(id: string) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    return this.devices.length < before;
  }

  async deviceByKeyHash(keyHash: string, now: string) {
    const d = this.devices.find((x) => x.keyHash === keyHash);
    if (!d) return undefined;
    d.lastSeenAt = now;
    return { id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt };
  }
}

describe('pairingVerdict (WO-0102)', () => {
  const grant = (over: Partial<StoredGrant> = {}): StoredGrant => ({
    code: '123456',
    expiresAt: grantExpiresAt(MINT),
    attemptsLeft: PAIRING_MAX_ATTEMPTS,
    used: false,
    ...over,
  });

  it('ok on the right code while live', () => {
    expect(pairingVerdict(grant(), '123456', NOW_AT_MINT)).toEqual({ kind: 'ok' });
    expect(pairingVerdict(grant(), '123456', JUST_BEFORE_TTL)).toEqual({ kind: 'ok' });
  });

  it('wrong code decrements the budget; the last wrong attempt strikes out', () => {
    expect(pairingVerdict(grant({ attemptsLeft: 3 }), '000000', NOW_AT_MINT)).toEqual({
      kind: 'wrong_code',
      attemptsLeft: 2,
    });
    expect(pairingVerdict(grant({ attemptsLeft: 1 }), '000000', NOW_AT_MINT)).toEqual({ kind: 'dead', reason: 'struck' });
  });

  it('dead: unknown / used / expired — in that precedence', () => {
    expect(pairingVerdict(undefined, '123456', NOW_AT_MINT)).toEqual({ kind: 'dead', reason: 'unknown' });
    expect(pairingVerdict(grant({ used: true }), '123456', NOW_AT_MINT)).toEqual({ kind: 'dead', reason: 'used' });
    expect(pairingVerdict(grant({ used: true, expiresAt: MINT }), '123456', AFTER_TTL)).toEqual({ kind: 'dead', reason: 'used' });
    expect(pairingVerdict(grant(), '123456', AFTER_TTL)).toEqual({ kind: 'dead', reason: 'expired' });
    expect(pairingVerdict(grant(), '000000', AFTER_TTL)).toEqual({ kind: 'dead', reason: 'expired' });
  });

  it('grantExpiresAt is mint + PAIRING_TTL_MS', () => {
    expect(grantExpiresAt(MINT)).toBe('2026-09-24T12:05:00.000Z');
  });
});

describe('FakeDeviceStore over the port (WO-0102 — the shape the SQLite half mirrors)', () => {
  it('exchanges exactly once: the second attempt is dead/used', async () => {
    const store = new FakeDeviceStore();
    const g = await store.mintGrant(MINT);
    const first = await store.exchange(g.code, 'Pixel 9', NOW_AT_MINT);
    expect(first).toMatchObject({ kind: 'paired', deviceKey: expect.stringMatching(/^dk-/) });
    const second = await store.exchange(g.code, 'Pixel 9', NOW_AT_MINT);
    expect(second).toEqual({ kind: 'dead', reason: 'used' });
  });

  it('refuses an expired grant with the named error', async () => {
    const store = new FakeDeviceStore();
    const g = await store.mintGrant(MINT);
    expect(await store.exchange(g.code, 'Pixel 9', AFTER_TTL)).toEqual({ kind: 'dead', reason: 'expired' });
  });

  it('kills the token after five failed exchanges', async () => {
    const store = new FakeDeviceStore();
    const g = await store.mintGrant(MINT);
    for (let i = 0; i < PAIRING_MAX_ATTEMPTS - 1; i++) {
      expect(await store.exchange('000000', 'Pixel 9', NOW_AT_MINT)).toMatchObject({
        kind: 'invalid_code',
        attemptsLeft: PAIRING_MAX_ATTEMPTS - 1 - i,
      });
    }
    expect(await store.exchange('000000', 'Pixel 9', NOW_AT_MINT)).toEqual({ kind: 'dead', reason: 'struck' });
    // struck out = the right code no longer helps
    expect(await store.exchange(g.code, 'Pixel 9', NOW_AT_MINT)).toEqual({ kind: 'dead', reason: 'unknown' });
  });

  it('mints supersede: one live grant at a time', async () => {
    const store = new FakeDeviceStore();
    const g1 = await store.mintGrant(MINT);
    const g2 = await store.mintGrant(MINT);
    expect(g1.code).not.toBe(g2.code);
    // The superseded code no longer matches: the exchange strikes the LIVE grant's budget
    // (invalid_code), never pairs — the one-live-grant invariant holds.
    expect(await store.exchange(g1.code, 'Pixel 9', NOW_AT_MINT)).toEqual({
      kind: 'invalid_code',
      attemptsLeft: PAIRING_MAX_ATTEMPTS - 1,
    });
    expect((await store.exchange(g2.code, 'Pixel 9', NOW_AT_MINT))!.kind).toBe('paired');
  });

  it('lists, stamps lastSeen on the key-hash lookup, and revokes so the key stops resolving', async () => {
    const store = new FakeDeviceStore();
    const g = await store.mintGrant(MINT);
    const paired = (await store.exchange(g.code, 'Pixel 9', NOW_AT_MINT)) as Extract<PairingExchangeResult, { kind: 'paired' }>;
    let devices = await store.listDevices();
    expect(devices).toEqual([
      { id: paired.deviceId, name: 'Pixel 9', createdAt: NOW_AT_MINT, lastSeenAt: null },
    ]);
    // auth lookup by hash stamps lastSeen
    const seen = await store.deviceByKeyHash(`hash-${paired.deviceId}`, '2026-09-24T13:00:00.000Z');
    expect(seen).toMatchObject({ id: paired.deviceId, lastSeenAt: '2026-09-24T13:00:00.000Z' });
    // revoke removes the row; the key no longer resolves
    expect(await store.revokeDevice(paired.deviceId)).toBe(true);
    expect(await store.deviceByKeyHash(`hash-${paired.deviceId}`, NOW_AT_MINT)).toBeUndefined();
    expect(await store.listDevices()).toEqual([]);
    expect(await store.revokeDevice(paired.deviceId)).toBe(false);
  });
});
