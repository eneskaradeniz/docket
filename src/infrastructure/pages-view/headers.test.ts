// I-66 — the header set every response carries, pinned exactly.
import { describe, expect, it } from 'vitest';

import { PAGE_CSP, pageHeaders } from './headers';

describe('I-66: pageHeaders', () => {
  it('I-66: the exact CSP string', () => {
    expect(PAGE_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; frame-ancestors 'none'",
    );
  });

  it('I-66: the exact header set, content type included', () => {
    expect(pageHeaders('text/html; charset=utf-8')).toEqual({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy':
        'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), usb=(), serial=(), hid=(), payment=(), fullscreen=()',
    });
  });

  it('I-66: the CSP never allows a network scheme, a wildcard or eval', () => {
    for (const forbidden of ['http:', 'https:', 'ws:', 'wss:', '*', 'unsafe-eval', 'file:']) {
      expect(PAGE_CSP).not.toContain(forbidden);
    }
  });
});
