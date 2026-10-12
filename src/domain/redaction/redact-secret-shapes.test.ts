import { describe, expect, it } from 'vitest';

import { redactSecretShapes } from './redact-secret-shapes';

const SHAPES: readonly { readonly label: string; readonly secret: string }[] = [
  { label: 'private key', secret: '-----BEGIN RSA PRIVATE KEY-----' },
  { label: 'aws access key', secret: `AKIA${'A1B2C3D4E5F6G7H8'}` },
  { label: 'aws session key', secret: `ASIA${'A1B2C3D4E5F6G7H8'}` },
  { label: 'github token', secret: `ghp_${'a'.repeat(36)}` },
  { label: 'github fine-grained token', secret: `github_pat_${'b'.repeat(60)}` },
  { label: 'sk token', secret: `sk-${'k'.repeat(32)}` },
  { label: 'slack token', secret: `xoxb-${'1'.repeat(10)}` },
  { label: 'google api key', secret: `AIza${'c'.repeat(35)}` },
  { label: 'stripe live key', secret: `sk_live_${'d'.repeat(24)}` },
  { label: 'assigned secret', secret: `api_key="${'e'.repeat(16)}"` },
];

describe('redactSecretShapes', () => {
  it('R-125: each secret shape is replaced, normal text is untouched, and the function is idempotent and pure', () => {
    const prose = 'The login form keeps the session. A short sk-note and the word password stay.';
    expect(redactSecretShapes(prose)).toBe(prose);

    for (const shape of SHAPES) {
      const raw = `keep ${shape.secret} tail`;
      const once = redactSecretShapes(raw);
      expect(once, shape.label).toBe('keep [redacted] tail');
      expect(once, shape.label).not.toContain(shape.secret);
      expect(raw, shape.label).toContain(shape.secret);
    }

    const combined = SHAPES.map((shape) => shape.secret).join('\n');
    const redacted = redactSecretShapes(combined);
    for (const shape of SHAPES) expect(redacted, shape.label).not.toContain(shape.secret);
    expect(redactSecretShapes(redacted)).toBe(redacted);
    expect(redactSecretShapes(combined)).toBe(redacted);
    expect(combined).toBe(SHAPES.map((shape) => shape.secret).join('\n'));
  });
});
