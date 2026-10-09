// Pure classification of the account test's result. Contract: docs/v2/domain.md "Account test classification".
import type { AgentEvent } from './agent-event';

export type AccountTestClass = 'auth' | 'limit' | 'model' | 'network' | 'install' | 'unknown';
export type AccountTestStartFailure = 'not_installed' | 'not_logged_in' | 'spawn_failed' | 'unsupported';
export type AccountTestOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly class: AccountTestClass; readonly detail: string };
export interface AccountTestInput {
  readonly startFailure?: { readonly code: AccountTestStartFailure; readonly message: string };
  readonly events: readonly AgentEvent[];
  readonly timedOut: boolean;
}

/** The fixed request. English, no tools, one word back. */
export const ACCOUNT_TEST_PROMPT = 'Reply with the single word OK. Do not use any tools.';
/** Shared bound; applied by the storing adapter after redaction. */
export const ACCOUNT_TEST_DETAIL_MAX_CHARS = 300;

const MODEL_PROBLEM = /\bmodel\b[\s\S]*\b(not found|not available|unavailable|not supported|unsupported|invalid|does not exist|no access|not allowed)\b/i;

// The detail is returned whole: the cut to ACCOUNT_TEST_DETAIL_MAX_CHARS belongs to the adapter, after
// redaction, so a token straddling the bound is never split into an unrecognisable fragment.
const failed = (cls: AccountTestClass, detail: string): AccountTestOutcome => ({ ok: false, class: cls, detail });

export function classifyAccountTest(input: AccountTestInput): AccountTestOutcome {
  const { startFailure, events, timedOut } = input;
  if (startFailure !== undefined) {
    const cls: AccountTestClass =
      startFailure.code === 'not_logged_in' ? 'auth' : startFailure.code === 'unsupported' ? 'unknown' : 'install';
    return failed(cls, startFailure.message);
  }
  if (events.some((e) => e.type === 'limit_hit')) return failed('limit', '');
  if (timedOut) return failed('network', 'timeout');
  for (const e of events) {
    if (e.type !== 'error') continue;
    if (e.class === 'auth') return failed('auth', e.message);
    if (e.class === 'network' || e.class === 'timeout') return failed('network', e.message);
    return failed(MODEL_PROBLEM.test(e.message) ? 'model' : 'unknown', e.message);
  }
  for (const e of events) {
    if (e.type !== 'finished') continue;
    if (e.reason === 'completed') return { ok: true };
    return failed(e.reason === 'limit' ? 'limit' : 'unknown', '');
  }
  return failed('unknown', '');
}
