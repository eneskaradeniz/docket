/// <reference types="vite/client" />
// setup-chat-measure.test.ts — U-389 read straight off the setup screen's own sources, the way
// U-124 reads the chat's: one setup label pack with every sentence at most 8 words in both locales
// (U-178), no inline copy (U-123's discipline), and the dock's own measures — rem lengths, the
// spacing scale, the three radius tokens, explicit leadings, focus rings, motion behind
// motion-safe/motion-reduce. A rule that lives in a class string cannot be seen in a store test.
import { describe, expect, it } from 'vitest';

import { LABEL_KEYS } from '../labels/keys';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';

const RAW = import.meta.glob(['./setup-chat.tsx', '../stores/setup-chat.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SOURCES = Object.entries(RAW);
const COMPONENTS = SOURCES.filter(([path]) => path.endsWith('.tsx'));

/** Source with its comments blanked, so a rule is judged on code and not on prose about it. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const classStringsOf = (source: string): string[] =>
  [...source.matchAll(/(?:className=\{?|\b[A-Z_]+ =\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

const allClasses = COMPONENTS.flatMap(([, source]) => classStringsOf(code(source)));
const joined = SOURCES.map(([, source]) => code(source)).join('\n');

/** The sentences U-386 … U-388 name for the screen, pack-local or reused from the setup pack. */
const SCREEN_SENTENCES = [
  'setup.title',
  'setup.ai.title',
  'setup.ai.desc',
  'setup.ai.start',
  'setup.chat.heading',
  'setup.chat.folder',
  'setup.chat.folder.placeholder',
  'setup.chat.alt',
  'setup.chat.existing',
  'setup.chat.firstMessage',
  'setup.chat.row',
  'setup.chat.feed',
] as const;

const words = (sentence: string): number => sentence.trim().split(/\s+/).filter((word) => word !== '').length;

describe('one setup label pack (U-389)', () => {
  it('U-389: the pack exists, in both locales, with the same placeholders', () => {
    expect(LABEL_KEYS.filter((key) => key.startsWith('setup.chat.')).length).toBe(8);
    for (const key of SCREEN_SENTENCES) {
      expect(TR[key].length, `tr ${key}`).toBeGreaterThan(0);
      expect(EN[key].length, `en ${key}`).toBeGreaterThan(0);
      const names = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(names(EN[key]), key).toBe(names(TR[key]));
    }
  });

  it('U-389: every sentence the screen shows is at most 8 words, in both locales (U-178)', () => {
    for (const key of SCREEN_SENTENCES) {
      // The first message's sentence carries the path as one placeholder-sized word.
      expect(words(TR[key].replace('{path}', 'x')), `tr ${key}`).toBeLessThanOrEqual(8);
      expect(words(EN[key].replace('{path}', 'x')), `en ${key}`).toBeLessThanOrEqual(8);
    }
  });

  it('U-389: no Turkish copy is written inline in the screen or the store', () => {
    for (const [path, source] of SOURCES) {
      const literals = [...code(source).matchAll(/'([^'\n]*)'|"([^"\n]*)"|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
      for (const literal of literals) expect(literal, `${path}: ${literal}`).not.toMatch(/[çğışöüÇĞİŞÖÜ]/);
    }
  });

  it('U-389: the first message sentence names the path, and the pills keep their own words', () => {
    expect(TR['setup.chat.firstMessage']).toBe('Kur: {path}');
    expect(EN['setup.chat.firstMessage']).toBe('Set up: {path}');
    expect(TR['setup.chat.existing']).toBe('Var olan klasör');
    expect(EN['setup.chat.existing']).toBe('Existing folder');
    expect(TR['setup.ai.desc']).toBe('Klasörü salt-okunur tarar ve kurulum önerisi hazırlar.');
    expect(EN['setup.ai.desc']).toBe('Scans read-only; prepares a setup proposal.');
  });
});

describe('the dock\'s own measures on the setup screen (U-389, U-124)', () => {
  it('U-389: the sources exist and carry class strings to scan', () => {
    expect(COMPONENTS.length).toBe(1);
    expect(SOURCES.some(([path]) => path.endsWith('setup-chat.ts'))).toBe(true);
    expect(allClasses.length).toBeGreaterThan(20);
  });

  it('U-389: lengths are rem — no px length in a class, except the 1 px hairline border', () => {
    expect(joined).not.toMatch(/\[\s*-?\d*\.?\d+px\s*\]/);
    expect(joined).not.toMatch(/\d+px['"` ;}]/);
  });

  it('U-389: every sized text line has an explicit leading', () => {
    for (const classes of allClasses) {
      if (/(?:^|\s)text-\[[\d.]+rem\]/.test(classes) || /(?:^|\s)text-(?:xs|sm|base|lg)(?:\s|$)/.test(classes)) {
        expect(classes, classes).toMatch(/(?:^|\s)leading-/);
      }
    }
  });

  it('U-389: radii come from the three tokens and rounded-full only (U-23)', () => {
    for (const classes of allClasses) {
      for (const radius of classes.match(/(?<![\w-])rounded[\w-]*/g) ?? []) {
        expect(['rounded-control', 'rounded-card', 'rounded-panel', 'rounded-full']).toContain(radius);
      }
    }
    expect(joined).not.toMatch(/border-?[Rr]adius/);
  });

  it('U-389: spacing steps are on the 4·8·12·16·20·24·32 scale (rem)', () => {
    const allowed = new Set(['0', '1', '2', '3', '4', '5', '6', '8']);
    for (const classes of allClasses) {
      for (const match of classes.matchAll(/(?:^|\s)(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
        expect(allowed.has(match[1] ?? ''), `${match[0].trim()} in ${classes}`).toBe(true);
      }
    }
  });

  it('U-389: no vendor name, and the only cursor a disabled control names is not-allowed', () => {
    const lower = joined.toLowerCase();
    expect(lower).not.toMatch(/cursor-(?!not-allowed\b)\w/);
    for (const vendor of ['claude', 'anthropic', 'openai', 'codex', 'copilot', 'opencode', 'antigravity', 'gemini', 'zai', 'glm']) {
      expect(lower, vendor).not.toContain(vendor);
    }
  });
});

describe('untrusted text (U-116 on the setup screen)', () => {
  it('U-389: no markup is built from text — no innerHTML, no markdown renderer, no link', () => {
    expect(joined).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/);
    expect(joined).not.toMatch(/react-markdown|rehype|remark|marked|DOMParser/);
    expect(joined).not.toMatch(/<a[\s>]|href=/);
  });

  it('U-389: every text-bearing surface wraps preformatted text and long words', () => {
    expect(joined).toContain('whitespace-pre-wrap');
    expect(joined).toContain('[overflow-wrap:anywhere]');
  });
});

describe('motion and focus (U-389, U-125)', () => {
  it('U-389: every transition and animation sits behind motion-safe: or motion-reduce:', () => {
    for (const classes of allClasses) {
      for (const token of classes.split(/\s+/)) {
        if (/(^|:)(transition|duration|ease|animate)(-|$)/.test(token)) {
          expect(token, `${token} in ${classes}`).toMatch(/^(motion-safe|motion-reduce):/);
        }
      }
    }
  });

  it('U-389: every button and input names a visible keyboard ring', () => {
    for (const [path, source] of COMPONENTS) {
      const body = code(source);
      if (/<(button|textarea|input)\b/.test(body)) expect(body, path).toMatch(/focus-visible:outline|\bFOCUS\b|BUTTON\b/);
    }
  });
});
