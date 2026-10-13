import { describe, expect, it } from 'vitest';
import type { CapabilitySlug } from '../shared';
import { commandPlaceholders, renderCommand } from './command-template';
import type { CapabilityDef } from './types';

const command: Extract<CapabilityDef, { readonly kind: 'command' }> = {
  kind: 'command',
  id: 'review' as CapabilitySlug,
  name: 'Review',
  template: 'Review {{target}} with focus on {{ focus }}. Again: {{target}}.',
  arguments: [
    { name: 'target', required: true },
    { name: 'focus', required: false },
  ],
};

describe('command template', () => {
  it('R-141: placeholders are substituted by Docket without any provider slash command', () => {
    const rendered = renderCommand(command, { target: 'src/app.ts', focus: 'security' });
    expect(rendered).toEqual({ ok: true, value: 'Review src/app.ts with focus on security. Again: src/app.ts.' });
  });

  it('R-141 edge: an optional argument renders empty and a missing required one names itself', () => {
    expect(renderCommand(command, { target: 'a' })).toEqual({ ok: true, value: 'Review a with focus on . Again: a.' });
    expect(renderCommand(command, {})).toEqual({ ok: false, error: { missing: ['target'] } });
    expect(commandPlaceholders(command.template)).toEqual(['target', 'focus']);
  });
});
