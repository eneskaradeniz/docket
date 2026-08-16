// src/core/app-settings.ts — the operator-preferences PORT (WO-0025 / B1).
//
// Operator preferences (the provider key) live in the shared DB so BOTH hosts see them (the Electron GUI and
// the CLI open the same docket.db); theme stays renderer-local localStorage because it is presentation only.
// ADR-0010's observed|owned split gains a third, tiny category here: an operator preference is neither a
// git-observed fact nor a decision about work — it is machine-local app configuration.
import type { ProviderErrorCode } from './runner';
import type { PermissionRule } from './source';

/** Vendor-neutral provider readiness: the happy path names the auth SOURCE (e.g. 'oauth', 'env'); the
 *  failure path carries the classification + the raw message (shown only as a fallback). */
export type ProviderStatus =
  | { ok: true; source: string }
  | { ok: false; code: ProviderErrorCode; message: string };

export interface AppSettings {
  /** The stored provider API key, if the operator saved one. Never logged. */
  getProviderKey(): Promise<string | undefined>;
  /** Store (or clear, on undefined) the provider API key. */
  setProviderKey(key: string | undefined): Promise<void>;
  /** The DEFAULT permission rule (WO-0031c): Settings holds only the default — each work order carries
   *  its own rule (order.md front-matter; changeable from the ask card). 'ask'/'auto' legacy values map
   *  to ask_every/risky_excluded at the store. The fence keeps denying out-of-scope writes under every
   *  rule; scope is the boundary, the rule is cadence. */
  getPermissionRule(): Promise<PermissionRule>;
  setPermissionRule(rule: PermissionRule): Promise<void>;
  /** Full provider check: spawns the provider handshake (no prompt — zero tokens) and reports auth state. */
  checkProvider(): Promise<ProviderStatus>;
}
