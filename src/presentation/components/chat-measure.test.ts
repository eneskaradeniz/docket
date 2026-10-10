/// <reference types="vite/client" />
// chat-measure.test.ts — U-123 (copy only through the bundles), U-124 (measure) and U-125 (motion and
// focus) read straight off the chat's own sources, the way U-90 reads the library's: a rule that
// lives in a class string cannot be seen in a store test. The sources are read through the
// bundler's raw imports — the presentation layer names no Node builtin, tests included.
import { describe, expect, it } from 'vitest';

import { LABEL_KEYS } from '../labels/keys';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';

const RAW = import.meta.glob(
  ['./chat-*.tsx', '../stores/chat-store.ts', '../stores/chat-model.ts', '!./**/*.test.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const SOURCES = Object.entries(RAW);
const COMPONENTS = SOURCES.filter(([path]) => path.endsWith('.tsx'));

/** Source with its comments blanked, so a rule is judged on code and not on prose about it. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const classStringsOf = (source: string): string[] =>
  [...source.matchAll(/(?:className=\{?|\b[A-Z_]+ =\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

const allClasses = COMPONENTS.flatMap(([, source]) => classStringsOf(code(source)));
const joined = COMPONENTS.map(([, source]) => code(source)).join('\n');

describe('the sources exist', () => {
  it('U-124: the chat\'s own sources are found and carry class strings to scan', () => {
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(4);
    expect(SOURCES.some(([path]) => path.endsWith('chat-store.ts'))).toBe(true);
    expect(allClasses.length).toBeGreaterThan(40);
  });
});

describe('copy through the bundles (U-123)', () => {
  const chatKeys = LABEL_KEYS.filter((key) => key.startsWith('chat.'));

  it('U-123: every chat label exists, non-empty, in both locales', () => {
    expect(chatKeys.length).toBeGreaterThan(100);
    for (const key of chatKeys) {
      expect(TR[key].length, `tr ${key}`).toBeGreaterThan(0);
      expect(EN[key].length, `en ${key}`).toBeGreaterThan(0);
    }
  });

  it('U-123: both locales carry the same placeholders for a key', () => {
    for (const key of chatKeys) {
      const names = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(names(EN[key]), key).toBe(names(TR[key]));
    }
  });

  it('U-123: no Turkish copy is written inline in a component or the store', () => {
    for (const [path, source] of SOURCES) {
      const literals = [...code(source).matchAll(/'([^'\n]*)'|"([^"\n]*)"|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
      for (const literal of literals) expect(literal, `${path}: ${literal}`).not.toMatch(/[çğışöüÇĞİŞÖÜ]/);
    }
  });
});

describe('measure (U-124)', () => {
  it('U-124: lengths are rem — no px length in a class or a style, except the 1 px hairline border', () => {
    expect(joined).not.toMatch(/\[\s*-?\d*\.?\d+px\s*\]/);
    expect(joined).not.toMatch(/\d+px['"` ;}]/);
    expect(joined).not.toMatch(/style=\{\{[^}]*px/);
  });

  it('U-124: every sized text line has an explicit leading', () => {
    for (const classes of allClasses) {
      if (/(?:^|\s)text-\[[\d.]+rem\]/.test(classes) || /(?:^|\s)text-(?:xs|sm|base|lg)(?:\s|$)/.test(classes)) {
        expect(classes, classes).toMatch(/(?:^|\s)leading-/);
      }
    }
  });

  it('U-124: radii come from the three tokens and rounded-full only', () => {
    for (const classes of allClasses) {
      for (const radius of classes.match(/(?<![\w-])rounded[\w-]*/g) ?? []) {
        expect(['rounded-control', 'rounded-card', 'rounded-panel', 'rounded-full']).toContain(radius);
      }
    }
    expect(joined).not.toMatch(/border-?[Rr]adius/);
  });

  it('U-124: spacing steps are on the 4·8·12·16·20·24·32 scale (rem)', () => {
    const allowed = new Set(['0', '1', '2', '3', '4', '5', '6', '8']);
    for (const classes of allClasses) {
      for (const match of classes.matchAll(/(?:^|\s)(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
        expect(allowed.has(match[1] ?? ''), `${match[0].trim()} in ${classes}`).toBe(true);
      }
    }
  });

  it('U-124: no vendor-named class or string — a disabled control uses pointer-events-none', () => {
    const lower = joined.toLowerCase();
    expect(lower).not.toContain('cursor');
    for (const vendor of ['claude', 'anthropic', 'openai', 'codex', 'copilot', 'opencode', 'antigravity', 'gemini', 'zai', 'glm']) {
      expect(lower, vendor).not.toContain(vendor);
    }
  });
});

describe('untrusted text (U-116)', () => {
  it('U-116: no markup is built from text — no innerHTML, no markdown renderer, no link', () => {
    expect(joined).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/);
    expect(joined).not.toMatch(/react-markdown|rehype|remark|marked|DOMParser/);
    expect(joined).not.toMatch(/<a[\s>]|href=/);
    expect(joined).not.toMatch(/\beval\(|new Function\(/);
  });

  it('U-116: every text-bearing surface wraps preformatted text and long words', () => {
    expect(joined).toContain('whitespace-pre-wrap');
    expect(joined).toContain('[overflow-wrap:anywhere]');
  });
});

describe('motion and focus (U-125)', () => {
  it('U-125: every transition and animation sits behind motion-safe: or motion-reduce:', () => {
    for (const classes of allClasses) {
      for (const token of classes.split(/\s+/)) {
        if (/(^|:)(transition|duration|ease|animate)(-|$)/.test(token)) {
          expect(token, `${token} in ${classes}`).toMatch(/^(motion-safe|motion-reduce):/);
        }
      }
    }
  });

  it('U-125: the panel opens by transform and opacity under motion-safe and has a reduced-motion face', () => {
    expect(joined).toContain('motion-safe:transition');
    expect(joined).toContain('motion-reduce:');
  });

  it('U-125: every button, textarea and input names a visible keyboard ring', () => {
    for (const [path, source] of COMPONENTS) {
      const body = code(source);
      if (/<(button|textarea|input)\b/.test(body)) expect(body, path).toMatch(/focus-visible:outline|\bFOCUS\b|ICON_BUTTON|BUTTON/);
    }
  });

  it('U-125: focus returns to the round button when the panel closes by Esc', () => {
    expect(joined).toMatch(/fabRef/);
    expect(joined).toMatch(/fabRef\.current\?\.focus\(\)/);
  });
});
