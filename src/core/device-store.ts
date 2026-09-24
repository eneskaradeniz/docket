// src/core/device-store.ts — the paired-device registry PORT (WO-0102, ADR-0020 #3).
//
// The pairing state machine is PURE and lives in remote.ts (pairingVerdict, over an injected
// clock — randomness is adapter-side). This port is the persistence surface around it: the same
// SQLite Store that implements WorkOrderSource + SessionStore + AppSettings implements this too
// (the `device` + `pairing_token` tables in the app-home db, ~/.docket/docket.db). Core sees key
// HASHES only: the device key's plaintext exists in the /pair response and on the phone — never
// in a row, an event, a log line, or wo_event.detail (Records & PRs, extended by ADR-0020 #3).
import type {
  DeviceView,
  PairingExchangeResult,
  PairingGrantView,
} from './remote';

export interface DeviceStore {
  /** Mint the ONE live grant (minting supersedes any prior grant): the adapter draws the random
   *  code; the TTL and attempt budget come from core's constants. */
  mintGrant(now: string): Promise<PairingGrantView>;
  /** The single-use / TTL / attempt-cap exchange, applying core's pairingVerdict. On 'paired'
   *  the device row is inserted with the HASHED key and the grant dies; the plaintext key is
   *  returned ONCE, here. On 'wrong_code' the budget is decremented (0 = struck, the row dies);
   *  on 'dead' the row is cleaned up. */
  exchange(code: string, deviceName: string, now: string): Promise<PairingExchangeResult>;
  /** Paired devices, createdAt ascending. */
  listDevices(): Promise<DeviceView[]>;
  /** Revoke by id. false = unknown id (already revoked). */
  revokeDevice(id: string): Promise<boolean>;
  /** Auth lookup by key hash — a hit stamps lastSeenAt (= now). undefined = unknown bearer. */
  deviceByKeyHash(keyHash: string, now: string): Promise<DeviceView | undefined>;
}
