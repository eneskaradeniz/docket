// page-view-host.test.ts — U-76: the isolated view's lifecycle as the page screen drives it. A
// fake `pageView` bridge records every call; a fake frame queue stands in for requestAnimationFrame.
// The pure half (which rectangle, when the view must not exist at all) is tested on its own.
import { describe, expect, it } from 'vitest';

import {
  clipRect,
  createPageViewHost,
  previewTarget,
  rectsIntersect,
  type PageViewPort,
  type Rect,
} from './page-viewer';

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

interface FakePort extends PageViewPort {
  readonly calls: string[];
  openReply: { ok: true } | { ok: false; code: 'invalid' | 'not_found' | 'forbidden' };
  failOpen: boolean;
  /** Fires the main process's "the view died" notice. */
  die(): void;
  readonly listeners: number;
}

const fakePort = (): FakePort => {
  const closedListeners = new Set<() => void>();
  const port: FakePort = {
    calls: [],
    openReply: { ok: true },
    failOpen: false,
    open: async (request) => {
      port.calls.push(`open ${request.pageId} v${request.version} ${request.bounds.x},${request.bounds.y} ${request.bounds.width}x${request.bounds.height}`);
      if (port.failOpen) throw new Error('ipc gone');
      return port.openReply;
    },
    setBounds: async ({ bounds }) => {
      port.calls.push(`setBounds ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`);
      return { ok: true };
    },
    close: async () => {
      port.calls.push('close');
      return { ok: true };
    },
    onClosed: (listener) => {
      closedListeners.add(listener);
      return () => closedListeners.delete(listener);
    },
    die: () => {
      for (const listener of [...closedListeners]) listener();
    },
    get listeners() {
      return closedListeners.size;
    },
  };
  return port;
};

const fakeFrames = () => {
  let queue: (() => void)[] = [];
  return {
    frame: (callback: () => void): (() => void) => {
      queue.push(callback);
      return () => {
        queue = queue.filter((entry) => entry !== callback);
      };
    },
    /** Runs one animation frame: every callback queued before it. */
    tick: async (): Promise<void> => {
      const run = queue;
      queue = [];
      for (const callback of run) callback();
      await settle();
    },
    get pending() {
      return queue.length;
    },
  };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const setup = () => {
  const port = fakePort();
  const frames = fakeFrames();
  const host = createPageViewHost({ port, frame: frames.frame });
  return { port, frames, host };
};

const BOUNDS = R(300, 120, 640, 420);
const target = (pageId = 'P', version = 2, bounds = BOUNDS) => ({ pageId, version, bounds });

describe('page view host', () => {
  it('U-76: the view opens once with the rounded rectangle and an unchanged update calls nothing', async () => {
    const { port, host } = setup();
    host.update(target());
    await settle();
    expect(port.calls).toEqual(['open P v2 300,120 640x420']);
    expect(host.state().status).toBe('open');
    host.update(target());
    await settle();
    expect(port.calls).toHaveLength(1);
  });

  it('U-76: bounds changes become setBounds, at most one per animation frame, the last rectangle winning', async () => {
    const { port, frames, host } = setup();
    host.update(target());
    await settle();
    host.update(target('P', 2, R(300, 120, 650, 420)));
    host.update(target('P', 2, R(300, 120, 660, 420)));
    host.update(target('P', 2, R(300, 130, 700, 420)));
    await settle();
    // Nothing goes out between frames.
    expect(port.calls).toEqual(['open P v2 300,120 640x420']);
    await frames.tick();
    expect(port.calls).toEqual(['open P v2 300,120 640x420', 'setBounds 300,130 700x420']);
    await frames.tick();
    expect(port.calls).toHaveLength(2);
  });

  it('U-76: a version or page change closes the view and opens the new one — never two at once', async () => {
    const { port, host } = setup();
    host.update(target('P', 2));
    await settle();
    host.update(target('P', 1));
    await settle();
    host.update(target('Q', 1));
    await settle();
    expect(port.calls).toEqual(['open P v2 300,120 640x420', 'close', 'open P v1 300,120 640x420', 'close', 'open Q v1 300,120 640x420']);
  });

  it('U-76: no target (Fark, an overlay, an unmount) closes the view, and closing nothing calls nothing', async () => {
    const { port, host } = setup();
    host.update(null);
    await settle();
    expect(port.calls).toEqual([]);
    host.update(target());
    await settle();
    host.update(null);
    await settle();
    expect(port.calls).toEqual(['open P v2 300,120 640x420', 'close']);
    expect(host.state().status).toBe('idle');
    // Coming back reopens.
    host.update(target());
    await settle();
    expect(port.calls[port.calls.length - 1]).toBe('open P v2 300,120 640x420');
  });

  it('U-76: an updated target that arrives while an open is in flight is applied after it, in order', async () => {
    const { port, host } = setup();
    host.update(target('P', 1));
    host.update(target('P', 2));
    host.update(null);
    await settle();
    expect(port.calls).toEqual(['open P v1 300,120 640x420', 'close']);
    expect(host.state().status).toBe('idle');
  });

  it('U-76: a refused open is the error state — no retry loop, no blank — and Yeniden dene opens again', async () => {
    const { port, frames, host } = setup();
    port.openReply = { ok: false, code: 'not_found' };
    host.update(target());
    await settle();
    expect(host.state().status).toBe('error');
    host.update(target('P', 2, R(300, 120, 700, 420)));
    await frames.tick();
    await settle();
    expect(port.calls).toEqual(['open P v2 300,120 640x420']);
    port.openReply = { ok: true };
    host.retry();
    await settle();
    expect(host.state().status).toBe('open');
    expect(port.calls[port.calls.length - 1]).toBe('open P v2 300,120 700x420');
  });

  it('U-76: a bridge that throws is the error state too', async () => {
    const { port, host } = setup();
    port.failOpen = true;
    host.update(target());
    await settle();
    expect(host.state().status).toBe('error');
  });

  it('U-76: a new target after an error is tried at once (another version may well show)', async () => {
    const { port, host } = setup();
    port.openReply = { ok: false, code: 'not_found' };
    host.update(target('P', 2));
    await settle();
    port.openReply = { ok: true };
    host.update(target('P', 1));
    await settle();
    expect(host.state().status).toBe('open');
  });

  it('U-76: the main process reporting the view dead is the error state, and retry reopens it', async () => {
    const { port, host } = setup();
    host.update(target());
    await settle();
    port.die();
    expect(host.state().status).toBe('error');
    host.update(target('P', 2, R(300, 120, 700, 420)));
    await settle();
    expect(port.calls).toHaveLength(1);
    host.retry();
    await settle();
    expect(host.state().status).toBe('open');
    expect(port.calls).toHaveLength(2);
  });

  it('U-76: a death notice while no view is wanted changes nothing', async () => {
    const { port, host } = setup();
    port.die();
    expect(host.state().status).toBe('idle');
  });

  it('U-76: dispose closes the view, drops the notice listener and stops answering frames', async () => {
    const { port, frames, host } = setup();
    host.update(target());
    await settle();
    expect(port.listeners).toBe(1);
    host.update(target('P', 2, R(300, 120, 700, 420)));
    host.dispose();
    await settle();
    expect(port.listeners).toBe(0);
    expect(port.calls[port.calls.length - 1]).toBe('close');
    const before = port.calls.length;
    await frames.tick();
    expect(port.calls).toHaveLength(before);
  });
});

describe('page view target', () => {
  const base = { pageId: 'P', version: 2 as number | null, mode: 'preview' as const, overlayOpen: false, toastRect: null, rect: BOUNDS, clip: R(0, 0, 1280, 800) };

  it('U-76: the preview rectangle is rounded to whole CSS pixels and keeps its page and version', () => {
    expect(previewTarget({ ...base, rect: R(300.4, 120.5, 640.2, 419.6) })).toEqual({ pageId: 'P', version: 2, bounds: R(300, 121, 640, 420) });
  });

  it('U-76: Fark, an open overlay, a missing version or a missing rectangle leave no view at all', () => {
    expect(previewTarget({ ...base, mode: 'diff' })).toBeNull();
    expect(previewTarget({ ...base, overlayOpen: true })).toBeNull();
    expect(previewTarget({ ...base, version: null })).toBeNull();
    expect(previewTarget({ ...base, rect: null })).toBeNull();
  });

  it('U-76: a toast stack lying over the stage closes the view, one elsewhere does not', () => {
    expect(previewTarget({ ...base, toastRect: R(900, 100, 380, 70) })).toBeNull();
    expect(previewTarget({ ...base, toastRect: R(1100, 16, 160, 70), rect: R(300, 200, 640, 420) })).not.toBeNull();
  });

  it('U-76: the view never paints outside the main column — scrolled partly away it is clipped, fully away it closes', () => {
    const clip = R(264, 40, 1016, 760);
    expect(previewTarget({ ...base, rect: R(300, 20, 640, 420), clip })?.bounds).toEqual(R(300, 40, 640, 400));
    expect(previewTarget({ ...base, rect: R(300, -500, 640, 420), clip })).toBeNull();
    expect(previewTarget({ ...base, rect: R(100, 100, 640, 420), clip })?.bounds).toEqual(R(264, 100, 476, 420));
  });

  it('U-76: rectangle helpers — clip is the intersection, touching edges do not intersect', () => {
    expect(clipRect(R(0, 0, 10, 10), R(5, 5, 10, 10))).toEqual(R(5, 5, 5, 5));
    expect(clipRect(R(0, 0, 10, 10), R(10, 0, 10, 10))).toBeNull();
    expect(rectsIntersect(R(0, 0, 10, 10), R(9, 9, 5, 5))).toBe(true);
    expect(rectsIntersect(R(0, 0, 10, 10), R(10, 10, 5, 5))).toBe(false);
  });
});
