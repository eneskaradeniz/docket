// chat-image-preview.test.ts — lazy-load observer options must match real browser rules (U-331).
import { describe, expect, it } from 'vitest';

import { CHAT_IMAGE_PREVIEW_LAZY_ROOT_MARGIN } from './chat-image-preview';

const BROWSER_ROOT_MARGIN_RE = /^(-?\d+(\.\d+)?(px|%)\s*){1,4}$/;

const ROOT_MARGIN_ERROR = "Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.";

const assertBrowserRootMargin = (rootMargin: unknown): void => {
  if (rootMargin === undefined) return;
  if (typeof rootMargin !== 'string' || !BROWSER_ROOT_MARGIN_RE.test(rootMargin.trim())) {
    throw new Error(ROOT_MARGIN_ERROR);
  }
};

/** Fake IntersectionObserver that rejects rootMargin values a real browser would reject. */
const createStrictIntersectionObserver = (): typeof IntersectionObserver => {
  return class StrictIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly scrollMargin: string = '';
    readonly thresholds: readonly number[] = [];

    constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      assertBrowserRootMargin(options?.rootMargin);
    }

    disconnect(): void {
      return;
    }

    observe(_target: Element): void {
      return;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    unobserve(_target: Element): void {
      return;
    }
  };
};

describe('chat image preview observer (U-331)', () => {
  it('U-331: the lazy-load observer is constructed with a browser-valid rootMargin', () => {
    const StrictIntersectionObserver = createStrictIntersectionObserver();
    expect(() => new StrictIntersectionObserver(() => undefined, { rootMargin: '3rem' })).toThrow(ROOT_MARGIN_ERROR);
    expect(() => new StrictIntersectionObserver(() => undefined, { rootMargin: '48px' })).not.toThrow();
    expect(() =>
      new StrictIntersectionObserver(() => undefined, { rootMargin: CHAT_IMAGE_PREVIEW_LAZY_ROOT_MARGIN }),
    ).not.toThrow();
  });
});
