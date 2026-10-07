import { describe, expect, it } from 'vitest';

import type { Command } from './commands';
import type { Query } from './queries';
import { COMMAND_REGISTRY, QUERY_REGISTRY } from './registry';

/** Mutual key equality: `true` only when both directions hold, so a missing union member and a
 *  leftover registry row both fail typecheck here — the registry cannot drift from the unions. */
type SameKeys<A, B> = keyof A extends keyof B ? (keyof B extends keyof A ? true : false) : false;

const commandKeysCoverTheUnion: SameKeys<typeof COMMAND_REGISTRY, Record<Command['type'], unknown>> = true;
const queryKeysCoverTheUnion: SameKeys<typeof QUERY_REGISTRY, Record<Query['type'], unknown>> = true;

describe('COMMAND_REGISTRY', () => {
  it('R-a: covers exactly every Command type, no more and no less', () => {
    expect(commandKeysCoverTheUnion).toBe(true);
  });

  it('R-b: every row carries non-blank input text', () => {
    for (const [name, entry] of Object.entries(COMMAND_REGISTRY)) {
      expect(entry.input.trim().length, `input text of ${name}`).toBeGreaterThan(0);
    }
  });

  it('R-c: describes the boundary the dispatcher actually switches on', () => {
    expect(Object.keys(COMMAND_REGISTRY)).toContain('workOrder.open');
    expect(Object.keys(COMMAND_REGISTRY)).toContain('permission.answer');
    expect(COMMAND_REGISTRY['permission.answer'].input).toContain('runId');
    expect(COMMAND_REGISTRY['permission.answer'].input).toContain('askId');
  });
});

describe('QUERY_REGISTRY', () => {
  it('R-a: covers exactly every Query type, no more and no less', () => {
    expect(queryKeysCoverTheUnion).toBe(true);
  });

  it('R-b: every row carries non-blank input text', () => {
    for (const [name, entry] of Object.entries(QUERY_REGISTRY)) {
      expect(entry.input.trim().length, `input text of ${name}`).toBeGreaterThan(0);
    }
  });

  it('R-c: describes the read side the dispatcher actually switches on', () => {
    expect(Object.keys(QUERY_REGISTRY)).toContain('run.events');
    expect(QUERY_REGISTRY['run.events'].input).toContain('runId');
    expect(Object.keys(QUERY_REGISTRY)).toContain('permissions.open');
  });
});
