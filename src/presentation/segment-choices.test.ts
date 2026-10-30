/// <reference types="vite/client" />
// segment-choices.test.ts — U-371: every exclusive choice of two to four options is one segment
// control; a Listbox appears only where the choice holds five or more options. The presentation
// sources are scanned for every <Listbox call site: each must sit in the map below with the exact
// count its file holds, and none may name two to four inline options — a new listbox, or a small
// one quietly returning, fails here first.
import { describe, expect, it } from 'vitest';

const raw = (glob: Record<string, unknown>): Readonly<Record<string, string>> => glob as Record<string, string>;

const SOURCES = raw(
  import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);

/** Files that still hold a Listbox, with the count each holds and the choice that keeps it. */
const ALLOWED: Readonly<Record<string, number>> = {
  // The wizard budget drawer's limit-policy choice — the one exemption U-371 grants: its options
  // carry a per-option description sentence, and the editor draws the same choice as radio cards.
  './screens/wizard.tsx': 1,
};

/** Every <Listbox call site, from the tag to its self-close. */
const callSites = (source: string): readonly string[] =>
  [...source.matchAll(/<Listbox\b/g)].map((match) => source.slice(match.index ?? 0, source.indexOf('/>', match.index) + 2));

/** The expression the `options` attribute holds, or null when the call site names none. */
const optionsExpression = (site: string): string | null => {
  const at = site.indexOf('options={');
  if (at < 0) return null;
  let depth = 0;
  let quote = '';
  for (let i = at + 'options={'.length - 1; i < site.length; i += 1) {
    const ch = site[i];
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return site.slice(at + 'options={'.length, i);
    }
  }
  return null;
};

/** The elements of an inline array literal at bracket depth zero; null when the expression is not
 *  one (an identifier, a `.map` call — a set the source cannot count, left to the map above). */
const inlineElements = (expression: string): readonly string[] | null => {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const body = trimmed.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '[' || ch === '{' || ch === '(') {
      depth += 1;
    } else if (ch === ']' || ch === '}' || ch === ')') {
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
};

describe('segment choices', () => {
  it('U-371: a Listbox stands only where the map allows it — five or more options, or the card exemption', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const held = Object.entries(SOURCES)
      .map(([file, source]) => [file, source.match(/<Listbox\b/g)?.length ?? 0] as const)
      .filter(([, count]) => count > 0);
    const offenders = [
      ...held.filter(([file]) => !(file in ALLOWED)).map(([file, count]) => `${file}: ${count} listbox(es), no allowance`),
      ...Object.entries(ALLOWED)
        .filter(([file]) => (held.find(([heldFile]) => heldFile === file)?.[1] ?? 0) !== ALLOWED[file])
        .map(([file]) => `${file}: allowance ${ALLOWED[file]}, found ${held.find(([heldFile]) => heldFile === file)?.[1] ?? 0}`),
    ];
    expect(offenders).toEqual([]);
  });

  it('U-371: no Listbox names two to four inline options — that choice is a segment control', () => {
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) =>
      callSites(source).flatMap((site) => {
        const expression = optionsExpression(site);
        const parts = expression === null ? null : inlineElements(expression);
        if (parts === null || parts.length < 2 || parts.length > 4 || parts.some((part) => part.startsWith('...'))) return [];
        return [`${file}: a listbox of ${parts.length} options`];
      }),
    );
    expect(offenders).toEqual([]);
  });
});
