// viewport-heights.test.ts — U-152: content boxes that show long text grow with the window.
// A fixed rem ceiling stays short on a tall window; each box keeps its old size as the floor.
import { describe, expect, it } from 'vitest';

// The bundler's raw imports — the presentation layer names no Node builtin, tests included.
const RAW = import.meta.glob(['./proposals.tsx', './page-viewer.tsx', './detail.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const source = (name: string): string => RAW[`./${name}`] ?? '';

describe('viewport heights', () => {
  it('U-152: the proposals diff, the page diff and the expected-file preview follow the window height', () => {
    expect(source('proposals.tsx')).toContain('max-h-[max(26rem,calc(100vh-22rem))]');
    expect(source('page-viewer.tsx')).toContain('max-h-[max(28rem,calc(100vh-24rem))]');
    expect(source('detail.tsx')).toContain('h-[clamp(12.5rem,calc(100vh-30rem),32rem)]');
    expect(source('proposals.tsx')).not.toContain('max-h-[26rem]');
    expect(source('page-viewer.tsx')).not.toContain('max-h-[28rem]');
    expect(source('detail.tsx')).not.toContain('h-[12.5rem]');
  });
});
