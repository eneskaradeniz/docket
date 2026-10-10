// I-69 — the page-view request shapes and the bounds rules; I-70 — which caller may use the channel.
import { describe, expect, it } from 'vitest';

import { clampBounds, isTrustedPageViewCaller, parsePageViewRequest } from './view-requests';

const ID = '01JZ8K3M4N5P6Q7R8S9T0V1W2X';
const BOUNDS = { x: 10, y: 20, width: 300, height: 200 };

describe('I-69: parsePageViewRequest', () => {
  it('I-69: the three ops', () => {
    expect(parsePageViewRequest({ op: 'open', pageId: ID, version: 2, bounds: BOUNDS })).toEqual({ op: 'open', pageId: ID, version: 2, bounds: BOUNDS });
    expect(parsePageViewRequest({ op: 'setBounds', bounds: BOUNDS })).toEqual({ op: 'setBounds', bounds: BOUNDS });
    expect(parsePageViewRequest({ op: 'close' })).toEqual({ op: 'close' });
  });

  it('I-69: a lower-case page id is normalised to the stored upper-case form', () => {
    expect(parsePageViewRequest({ op: 'open', pageId: ID.toLowerCase(), version: 1, bounds: BOUNDS })).toEqual({ op: 'open', pageId: ID, version: 1, bounds: BOUNDS });
  });

  it('I-69: extra fields are dropped, not forwarded', () => {
    const parsed = parsePageViewRequest({ op: 'close', url: 'https://evil', extra: { a: 1 } });
    expect(parsed).toEqual({ op: 'close' });
    const open = parsePageViewRequest({ op: 'open', pageId: ID, version: 1, bounds: { ...BOUNDS, z: 1 }, url: 'https://evil' });
    expect(open).toEqual({ op: 'open', pageId: ID, version: 1, bounds: BOUNDS });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'open'],
    ['an array', []],
    ['no op', {}],
    ['unknown op', { op: 'navigate', url: 'https://evil' }],
    ['op with another case', { op: 'Open', pageId: ID, version: 1, bounds: BOUNDS }],
    ['an inherited op key', Object.create({ op: 'close' })],
    ['open without a page', { op: 'open', version: 1, bounds: BOUNDS }],
    ['open with a non-ULID page', { op: 'open', pageId: '../../etc', version: 1, bounds: BOUNDS }],
    ['open with a numeric page', { op: 'open', pageId: 7, version: 1, bounds: BOUNDS }],
    ['open with version 0', { op: 'open', pageId: ID, version: 0, bounds: BOUNDS }],
    ['open with a negative version', { op: 'open', pageId: ID, version: -1, bounds: BOUNDS }],
    ['open with a fractional version', { op: 'open', pageId: ID, version: 1.5, bounds: BOUNDS }],
    ['open with a string version', { op: 'open', pageId: ID, version: '1', bounds: BOUNDS }],
    ['open with NaN version', { op: 'open', pageId: ID, version: Number.NaN, bounds: BOUNDS }],
    ['open with an unsafe version', { op: 'open', pageId: ID, version: 2 ** 53, bounds: BOUNDS }],
    ['open without bounds', { op: 'open', pageId: ID, version: 1 }],
    ['setBounds without bounds', { op: 'setBounds' }],
    ['bounds not an object', { op: 'setBounds', bounds: 5 }],
    ['negative x', { op: 'setBounds', bounds: { ...BOUNDS, x: -1 } }],
    ['negative y', { op: 'setBounds', bounds: { ...BOUNDS, y: -1 } }],
    ['fractional width', { op: 'setBounds', bounds: { ...BOUNDS, width: 10.5 } }],
    ['NaN height', { op: 'setBounds', bounds: { ...BOUNDS, height: Number.NaN } }],
    ['Infinity width', { op: 'setBounds', bounds: { ...BOUNDS, width: Number.POSITIVE_INFINITY } }],
    ['a string coordinate', { op: 'setBounds', bounds: { ...BOUNDS, x: '1' } }],
    ['a missing coordinate', { op: 'setBounds', bounds: { x: 0, y: 0, width: 5 } }],
    ['zero width', { op: 'setBounds', bounds: { ...BOUNDS, width: 0 } }],
    ['zero height', { op: 'setBounds', bounds: { ...BOUNDS, height: 0 } }],
    ['an unsafe integer', { op: 'setBounds', bounds: { ...BOUNDS, x: 2 ** 53 } }],
    ['negative zero is fine but -0 width is not', { op: 'setBounds', bounds: { ...BOUNDS, width: -0 } }],
  ])('I-69: refuses %s', (_label, value) => {
    expect(parsePageViewRequest(value)).toBeUndefined();
  });

  it('I-69: a zero origin is valid', () => {
    expect(parsePageViewRequest({ op: 'setBounds', bounds: { x: 0, y: 0, width: 1, height: 1 } })).toEqual({ op: 'setBounds', bounds: { x: 0, y: 0, width: 1, height: 1 } });
  });
});

describe('I-69: clampBounds', () => {
  const content = { width: 1000, height: 600 };

  it('I-69: bounds inside the content stay as they are', () => {
    expect(clampBounds(BOUNDS, content)).toEqual(BOUNDS);
    expect(clampBounds({ x: 0, y: 0, width: 1000, height: 600 }, content)).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });

  it('I-69: width and height are cut at the content edge', () => {
    expect(clampBounds({ x: 900, y: 500, width: 500, height: 500 }, content)).toEqual({ x: 900, y: 500, width: 100, height: 100 });
    expect(clampBounds({ x: 0, y: 0, width: 99999, height: 99999 }, content)).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });

  it('I-69: an origin outside the content is pulled to the last pixel and keeps a 1px view', () => {
    expect(clampBounds({ x: 5000, y: 5000, width: 10, height: 10 }, content)).toEqual({ x: 999, y: 599, width: 1, height: 1 });
    expect(clampBounds({ x: 1000, y: 600, width: 10, height: 10 }, content)).toEqual({ x: 999, y: 599, width: 1, height: 1 });
  });

  it('I-69: the result always has width and height of at least 1 and stays inside the content', () => {
    for (const x of [0, 1, 500, 999, 1000, 2000, 1e9]) {
      for (const w of [1, 2, 500, 1000, 1e9]) {
        const out = clampBounds({ x, y: x, width: w, height: w }, content);
        expect(out).toBeDefined();
        if (out === undefined) continue;
        expect(out.width).toBeGreaterThanOrEqual(1);
        expect(out.height).toBeGreaterThanOrEqual(1);
        expect(out.x + out.width).toBeLessThanOrEqual(content.width);
        expect(out.y + out.height).toBeLessThanOrEqual(content.height);
      }
    }
  });

  it('I-69: an unusable content size (zero, negative, fractional, NaN) answers undefined', () => {
    for (const bad of [{ width: 0, height: 600 }, { width: 1000, height: 0 }, { width: -5, height: 600 }, { width: Number.NaN, height: 600 }, { width: 10.5, height: 10 }]) {
      expect(clampBounds(BOUNDS, bad)).toBeUndefined();
    }
  });
});

describe('I-70: isTrustedPageViewCaller', () => {
  it('I-70: only the main frame of the main window', () => {
    expect(isTrustedPageViewCaller({ webContentsId: 3, isMainFrame: true }, 3)).toBe(true);
  });

  it('I-70: a sub-frame of the main window is refused', () => {
    expect(isTrustedPageViewCaller({ webContentsId: 3, isMainFrame: false }, 3)).toBe(false);
  });

  it('I-70: every other web contents is refused (another window, the page view itself)', () => {
    expect(isTrustedPageViewCaller({ webContentsId: 4, isMainFrame: true }, 3)).toBe(false);
  });

  it('I-70: with no main window, or no frame information, nobody is trusted', () => {
    expect(isTrustedPageViewCaller({ webContentsId: 3, isMainFrame: true }, undefined)).toBe(false);
    expect(isTrustedPageViewCaller(undefined, 3)).toBe(false);
    expect(isTrustedPageViewCaller({ webContentsId: Number.NaN, isMainFrame: true }, Number.NaN)).toBe(false);
  });
});
