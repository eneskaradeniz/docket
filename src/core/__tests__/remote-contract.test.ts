// src/core/__tests__/remote-contract.test.ts — the yaml emitter's PURE pins (WO-0102).
//
// Byte-stability, section order, endpoint order and the constant echoes — no filesystem here
// (c3 bans Node imports under src/core/ with no test exemption; the on-disk byte-compare drift
// guard lives in src/adapters/remote/contract-drift.test.ts, plan §12 finding 1).
import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_DIGITS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_MS,
  REMOTE_API_VERSION,
  REMOTE_DEFAULT_PORT,
  REMOTE_TAIL_WINDOW,
  WS_TICKET_TTL_MS,
} from '../remote';
import { emitEndpointsYaml } from '../remote-contract';

const SECTIONS = ['version:', 'server:', 'pairing:', 'errors:', 'endpoints:', 'websocket:', 'models:'] as const;

// The 13 REST paths in the frozen table order (§2.2), then the WS route.
const ROUTES = [
  '/pair',
  '/console',
  '/settings',
  '/settings',
  '/devices',
  '/devices/{id}',
  '/asks/{requestId}/answer',
  '/drives/{owner}/stop',
  '/drives/{owner}/resume',
  '/budget/raise-and-rerun',
  '/drafts/{workspaceId}/approve',
  '/drafts/{workspaceId}/reject',
  '/ws-ticket',
] as const;

describe('emitEndpointsYaml (WO-0102)', () => {
  it('is byte-stable across calls', () => {
    expect(emitEndpointsYaml()).toBe(emitEndpointsYaml());
  });

  it('carries the sections in the frozen order', () => {
    const yaml = emitEndpointsYaml();
    const at = SECTIONS.map((s) => yaml.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]!);
  });

  it('lists the endpoints in the frozen table order', () => {
    const yaml = emitEndpointsYaml();
    const body = yaml.slice(yaml.indexOf('endpoints:'));
    // A moving search position ("searchAt"), because /settings legitimately appears twice (GET then PUT).
    let searchAt = -1;
    const at: number[] = [];
    for (const r of ROUTES) {
      searchAt = body.indexOf(`path: "${r}"`, searchAt + 1);
      at.push(searchAt);
    }
    expect(at.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]!);
  });

  it('emits every value FROM the core constants (the mirror is a projection of the code)', () => {
    const yaml = emitEndpointsYaml();
    expect(yaml).toContain(`version: ${REMOTE_API_VERSION}`);
    expect(yaml).toContain(`defaultPort: ${REMOTE_DEFAULT_PORT}`);
    expect(yaml).toContain(`codeDigits: ${PAIRING_CODE_DIGITS}`);
    expect(yaml).toContain(`ttlSeconds: ${PAIRING_TTL_MS / 1000}`);
    expect(yaml).toContain(`maxAttempts: ${PAIRING_MAX_ATTEMPTS}`);
    expect(yaml).toContain(`tailWindow: ${REMOTE_TAIL_WINDOW}`);
    expect(yaml).toContain(`ttlSeconds: ${WS_TICKET_TTL_MS / 1000}`);
    expect(yaml).toContain('docket-pair://<host>:<port>?v=1&code=<code>');
  });

  it('carries the amendment texts: diagnostic-only message, the rerun:false semantics, read-only port', () => {
    const yaml = emitEndpointsYaml();
    expect(yaml).toContain('diagnostic-only');
    expect(yaml).toContain('rerun false = the raise stood');
    expect(yaml).toContain('read-only');
  });

  it('is mechanically frozen: exactly one trailing newline, LF only, no tabs', () => {
    const yaml = emitEndpointsYaml();
    expect(yaml.endsWith('\n')).toBe(true);
    expect(yaml.endsWith('\n\n')).toBe(false);
    expect(yaml).not.toContain('\r');
    expect(yaml).not.toContain('\t');
  });
});
