/// <reference types="vite/client" />
// elevation-scale.test.ts — U-374: elevation is three levels, each a token (`elevation-flat`,
// `elevation-card`, `elevation-overlay`), and a surface takes its level from the token — no
// hand-tuned shadow beside them (U-23's discipline, for depth). The presentation sources are
// scanned for any other `shadow-*` utility; the token sheet itself is checked for the three
// definitions and their Tailwind bridge. The one exemption is the 1 px inset ring: focus and
// selection indicators drawn as a box-shadow are rings, not depth, and stay hand-named — the
// ring is a hairline at a token colour, never a blur or an offset.
import { describe, expect, it } from 'vitest';

const raw = (glob: Record<string, unknown>): Readonly<Record<string, string>> => glob as Record<string, string>;

const SOURCES = raw(
  import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);

const STYLES = raw(import.meta.glob(['./styles/*.css'], { query: '?raw', import: 'default', eager: true }));

/** Every `shadow-*` utility a line names, spelled as written (`shadow-2xl`, `shadow-[…]`, …). */
const SHADOW_UTILITY = /(?<![\w-])shadow-(?:[\w-]+|\[[^\]]*\])/g;

/** A 1 px inset ring at a token colour — an indicator, not an elevation. */
const RING = /^shadow-\[inset_0_0_0_(?:1px|0\.0625rem)_var\(--/;

/** The scale itself: the only shadow utilities a presentation file may name. */
const ON_SCALE = /^shadow-elevation-(?:flat|card|overlay)$/;

describe('elevation scale', () => {
  it('U-374: the token sheet defines the three levels and bridges them into Tailwind', () => {
    const tokens = STYLES['./styles/tokens.css'] ?? '';
    expect(tokens, 'the token sheet is read').not.toBe('');
    for (const level of ['flat', 'card', 'overlay'] as const) {
      expect(tokens, `--elevation-${level}`).toContain(`--elevation-${level}:`);
      expect(tokens, `--shadow-elevation-${level}`).toContain(`--shadow-elevation-${level}: var(--elevation-${level})`);
    }
  });

  it('U-374: presentation files name no shadow utility outside the three tokens and the 1 px inset ring', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) =>
      source.split('\n').flatMap((line, index) => {
        if (line.trimStart().startsWith('//')) return [];
        return [...line.matchAll(SHADOW_UTILITY)]
          .filter((match) => !ON_SCALE.test(match[0]) && !RING.test(match[0]))
          .map((match) => `${file}:${index + 1} ${match[0]}`);
      }),
    );
    expect(offenders).toEqual([]);
  });
});
