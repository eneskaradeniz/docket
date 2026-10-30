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
// The shell's own measures, read for the full-mode geometry pins only (U-193): they are not the
// chat's sources, so the U-124 scans must not judge them (the title bar is a px-fixed surface).
const SHELL_RAW = import.meta.glob(['./sidebar-geometry.ts', './title-bar.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

  it('U-124: no vendor-named class or string — the only cursor a disabled control names is not-allowed (U-375)', () => {
    const lower = joined.toLowerCase();
    // U-124 froze the pointer; U-375 (later) trades that for the not-allowed cursor. Any other
    // cursor utility still names a vendor's glyph choice and stays out.
    expect(lower).not.toMatch(/cursor-(?!not-allowed\b)\w/);
    for (const vendor of ['claude', 'anthropic', 'openai', 'codex', 'copilot', 'opencode', 'antigravity', 'gemini', 'zai', 'glm']) {
      expect(lower, vendor).not.toContain(vendor);
    }
  });
});

describe('full-screen geometry and measure (U-193, U-194, U-198)', () => {
  const sourceOf = (end: string): string => code(SOURCES.find(([path]) => path.endsWith(end))?.[1] ?? '');
  const dock = sourceOf('chat-dock.tsx');
  const feed = sourceOf('chat-feed.tsx');
  const composer = sourceOf('chat-composer.tsx');
  const model = sourceOf('chat-model.ts');
  const shellOf = (end: string): string => SHELL_RAW[Object.keys(SHELL_RAW).find((path) => path.endsWith(end)) ?? ''] ?? '';

  it('U-193: full mode anchors to the shell\'s real tokens — the sidebar\'s column and the title bar\'s height — never the prototype\'s own widths', () => {
    const geometry = shellOf('sidebar-geometry.ts');
    const bar = shellOf('title-bar.tsx');
    expect(geometry).toContain('16.5rem');
    expect(dock).toContain('left-[16.5rem]');
    // the prototype's 15rem/240px sidebar is an artifact and must not come back
    expect(dock).not.toContain('left-[15rem]');
    expect(dock).not.toMatch(/240px/);
    // the top edge is the title bar's bottom: the bar's own px height equals the panel's rem inset at the 16px root
    const barPx = parseFloat(bar.match(/data-title-bar\b[\s\S]{0,400}?h-\[(\d+(?:\.\d+)?)px\]/)?.[1] ?? '0');
    const topRem = parseFloat(dock.match(/top-\[(\d+(?:\.\d+)?)rem\]/)?.[1] ?? '0');
    expect(barPx).toBeGreaterThan(0);
    expect(topRem).toBeGreaterThan(0);
    expect(barPx).toBe(topRem * 16);
  });

  it('U-194: the reading column, the wide gutter and the artifact caps are named rem values', () => {
    expect(model).toContain('(min-width: 64rem)');
    // the feed centres the column and the dock's own rows align to it
    for (const source of [feed, composer]) expect(source).toContain('minmax(0,48rem)');
    // a wide artifact reaches one 8px gutter further each side, and no further
    expect(feed).toMatch(/-mx-2[^2]/);
    // the diff scrolls from 18rem in full mode (11rem in the panel); a table from 20rem
    expect(feed).toContain('max-h-[18rem]');
    expect(feed).toContain('max-h-44');
    expect(feed).toContain('max-h-[20rem]');
  });

  it('U-198: foundations over the prototype — the header buttons sit 8px apart and the assistant text keeps 14/20', () => {
    expect(dock).toMatch(/items-center gap-2 pb-2/);
    // 15/20 and 15/24 text are not in the scale and must not appear for the full mode
    expect(feed).not.toContain('text-[0.9375rem]');
    expect(feed).not.toContain('leading-6 text-[0.9375rem]');
    expect(feed).toContain('text-[0.875rem] leading-5');
  });

  it('U-199: Genişlet, Küçült and Kapat live in both bundles and never inline in a source', () => {
    for (const key of ['chat.full.expand', 'chat.full.collapse', 'chat.close'] as const) {
      expect(TR[key].length, `tr ${key}`).toBeGreaterThan(0);
      expect(EN[key].length, `en ${key}`).toBeGreaterThan(0);
    }
    for (const word of ['Genişlet', 'Küçült', 'Kapat']) {
      for (const [path, source] of SOURCES) expect(code(source), `${path}: ${word}`).not.toContain(word);
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
