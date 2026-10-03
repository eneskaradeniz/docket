/// <reference types="vite/client" />
// radius-scale.test.ts — U-23: corner radius comes from three tokens and nothing else. The
// presentation sources are scanned for any other `rounded-*` utility (the Tailwind steps, the
// bare `rounded`, arbitrary `[..px]` values) and for a hand-typed radius in style props. The
// files are read through the bundler's raw imports — the presentation layer names no Node
// builtin, tests included.
import { describe, expect, it } from 'vitest';

const raw = (glob: Record<string, unknown>): Readonly<Record<string, string>> => glob as Record<string, string>;

const SOURCES = raw(
  import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);

// `rounded` not followed by one of the scale's names (and not part of a longer word).
const OFF_SCALE = /(?<![\w-])rounded(?!-(?:full|control|card|panel)(?![\w-]))/;
const HAND_TYPED = /border-?[Rr]adius/;

describe('radius scale', () => {
  it('U-23: presentation files name only rounded-control, rounded-card, rounded-panel and rounded-full', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) =>
      source.split('\n').flatMap((line, index) => (OFF_SCALE.test(line) || HAND_TYPED.test(line) ? [`${file}:${index + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
