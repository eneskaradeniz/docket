// results.test.ts — U-8: every CommandResult/QueryFailure the UI can receive maps to a label key;
// an unknown code falls back to the generic failure key, never to a raw or empty string.
import { describe, expect, it } from 'vitest';

import type { CommandResult } from '../../api/commands';
import { GENERIC_FAILURE_KEY, KNOWN_FAILURE_CODES, commandResultKey, failureKey, isQueryFailure, queryFailureKey } from './results';

describe('results mapping', () => {
  it('U-8: every known failure code maps to its own label key and an unknown code to the generic one', () => {
    expect(KNOWN_FAILURE_CODES.length).toBeGreaterThan(0);
    for (const code of KNOWN_FAILURE_CODES) {
      const key = failureKey(code);
      expect(key, `code ${code}`).not.toBe(GENERIC_FAILURE_KEY);
      expect(key, `code ${code}`).toBe(`error.${code}`);
    }

    // Unknown codes — including the empty string — never reach the user raw or blank.
    expect(failureKey('mystery_code')).toBe(GENERIC_FAILURE_KEY);
    expect(failureKey('')).toBe(GENERIC_FAILURE_KEY);
    expect(GENERIC_FAILURE_KEY).toBe('error.unknown');
  });

  it('U-8: the attach refusals not_a_repo, no_project_yaml and repo_not_in_project have their own keys', () => {
    for (const code of ['not_a_repo', 'no_project_yaml', 'repo_not_in_project']) {
      expect(KNOWN_FAILURE_CODES, code).toContain(code);
      expect(failureKey(code), code).toBe(`error.${code}`);
    }
  });

  it('U-8: a successful result maps to the command\'s confirmation key, a failure to the code\'s key', () => {
    const commands = [
      'workOrder.open',
      'workOrder.block',
      'workOrder.unblock',
      'workOrder.close',
      'workOrder.enqueue',
      'gate.decide',
      'proposal.decide',
    ] as const;
    for (const command of commands) {
      const success: CommandResult = { ok: true };
      expect(commandResultKey(command, success), `success of ${command}`).toBe(`success.${command}`);
      expect(commandResultKey(command, success).startsWith('success.'), `success of ${command} is a confirmation key`).toBe(true);
    }

    const failure: CommandResult = { ok: false, code: 'not_pending' };
    expect(commandResultKey('gate.decide', failure)).toBe('error.not_pending');
    const unknown: CommandResult = { ok: false, code: 'brand_new_code' };
    expect(commandResultKey('gate.decide', unknown)).toBe(GENERIC_FAILURE_KEY);
  });

  it('U-8: a query failure narrows from an unknown reply and maps like a command failure', () => {
    expect(isQueryFailure({ ok: false, code: 'definitions_invalid' })).toBe(true);
    expect(isQueryFailure({ ok: true })).toBe(false);
    expect(isQueryFailure({ ok: false })).toBe(false);
    expect(isQueryFailure(null)).toBe(false);
    expect(isQueryFailure('nope')).toBe(false);

    if (isQueryFailure({ ok: false, code: 'definitions_invalid' })) {
      expect(queryFailureKey({ ok: false, code: 'definitions_invalid' })).toBe('error.definitions_invalid');
    }
    expect(queryFailureKey({ ok: false, code: 'never_seen' })).toBe(GENERIC_FAILURE_KEY);
  });
});
