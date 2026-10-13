import { describe, expect, it } from 'vitest';

import { WORK_ORDER_DESCRIPTION_MAX_CHARS, normalizeWorkOrderDescription, workOrderRequestSection } from './description';

const TOKEN = `sk-${'k'.repeat(32)}`;

describe('normalizeWorkOrderDescription', () => {
  it('R-145: a blank description is absent, and a description over 4000 characters is refused', () => {
    expect(normalizeWorkOrderDescription(undefined)).toEqual({ ok: true, value: undefined });
    for (const blank of ['', '   ', ' \n\t ']) {
      expect(normalizeWorkOrderDescription(blank)).toEqual({ ok: true, value: undefined });
    }

    const capped = 'x'.repeat(WORK_ORDER_DESCRIPTION_MAX_CHARS);
    expect(WORK_ORDER_DESCRIPTION_MAX_CHARS).toBe(4_000);
    expect(normalizeWorkOrderDescription(`  ${capped}  `)).toEqual({ ok: true, value: capped });
    expect(normalizeWorkOrderDescription(`${capped}y`)).toEqual({ ok: false, error: 'description_too_long' });
  });

  it('R-145: secret-shaped text is redacted and the input is left unchanged', () => {
    const raw = `  keep ${TOKEN} tail  `;
    const result = normalizeWorkOrderDescription(raw);

    expect(raw).toBe(`  keep ${TOKEN} tail  `);
    expect(result).toEqual({ ok: true, value: 'keep [redacted] tail' });
  });
});

describe('workOrderRequestSection', () => {
  it('R-145: the Request section carries the title and the description; a missing description adds no section', () => {
    expect(workOrderRequestSection('Fix the login', undefined)).toBeUndefined();
    expect(workOrderRequestSection('Fix the login', '   ')).toBeUndefined();

    const section = workOrderRequestSection('Fix the login', `session drops\n${TOKEN}`);
    expect(section).toContain('## Request');
    expect(section).toContain('Fix the login');
    expect(section).toContain('session drops');
    expect(section).toContain('[redacted]');
    expect(section).not.toContain(TOKEN);
  });
});
