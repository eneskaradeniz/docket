// I-68: the view host's options and handler wiring, pinned without Electron.
// Everything Electron-shaped (the view constructor, the session, the window) arrives as a fake, so
// the test sees exactly which options and handlers the host installs and which decisions it takes
// from the pure policy module.
import { describe, expect, it, vi } from 'vitest';

import type { Page, PageId } from '../../domain/index';

import {
  PAGE_PARTITION,
  PAGE_WEBRTC_POLICY,
  PAGE_SCHEME_PRIVILEGES,
  PAGE_VIEW_WEB_PREFERENCES,
  createPageViewHost,
  createPageViewTrace,
  hardenPageContents,
  installPageSession,
  registerPageScheme,
  servePage,
} from './view-host';
import { createPageResponder } from './responder';
import type { PageContentsLike, PageSessionLike, PageViewHandle } from './view-host';

const ID = '01JZ8K3M4N5P6Q7R8S9T0V1W2X' as PageId;
const OTHER = '01JZ8K3M4N5P6Q7R8S9T0V1W2Y';
const actor = { kind: 'user', id: 'u', label: 'U' } as const;
const page = {
  id: ID,
  title: 't',
  kind: 'html',
  createdBy: actor,
  createdAt: 1,
  versions: [{ n: 1, createdAt: 1, by: actor, entry: 'index.html', files: [] }],
  approval: 'none',
} as unknown as Page;

// --- fakes ---------------------------------------------------------------------------------------------

type Listener = (...args: never[]) => void;

const fakeContents = () => {
  const listeners = new Map<string, Listener[]>();
  const state = { openHandler: undefined as undefined | (() => { action: string }), muted: undefined as undefined | boolean, webrtc: undefined as undefined | string, loaded: [] as string[], closed: 0, url: '' };
  const contents: PageContentsLike = {
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    setWindowOpenHandler: (handler) => {
      state.openHandler = handler;
    },
    setWebRTCIPHandlingPolicy: (policy) => {
      state.webrtc = policy;
    },
    setAudioMuted: (muted) => {
      state.muted = muted;
    },
    loadURL: async (url) => {
      state.loaded.push(url);
      state.url = url;
    },
    getURL: () => state.url,
    close: () => {
      state.closed += 1;
    },
    isDestroyed: () => state.closed > 0,
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  };
  return { contents, state, emit, listeners };
};

const fakeSession = () => {
  const calls = {
    handled: [] as string[],
    permissionRequest: undefined as undefined | ((...a: unknown[]) => void),
    permissionCheck: undefined as undefined | (() => boolean),
    beforeRequest: undefined as undefined | ((details: { url: string; resourceType?: string }, cb: (r: { cancel: boolean }) => void) => void),
    download: undefined as undefined | ((event: { preventDefault(): void }) => void),
    cleared: 0,
    cacheCleared: 0,
  };
  const session: PageSessionLike = {
    protocol: {
      handle: (scheme) => {
        calls.handled.push(scheme);
      },
    },
    setPermissionRequestHandler: (handler) => {
      calls.permissionRequest = handler as (...a: unknown[]) => void;
    },
    setPermissionCheckHandler: (handler) => {
      calls.permissionCheck = handler as () => boolean;
    },
    webRequest: {
      onBeforeRequest: (listener) => {
        calls.beforeRequest = listener;
      },
    },
    on: (_event, listener) => {
      calls.download = listener;
    },
    clearStorageData: async () => {
      calls.cleared += 1;
    },
    clearCache: async () => {
      calls.cacheCleared += 1;
    },
  };
  return { session, calls };
};

const nav = (url: string) => {
  const event = { url, preventDefault: vi.fn() };
  return event;
};

// --- the pinned options --------------------------------------------------------------------------------

describe('I-68: the view options', () => {
  it('I-68: the partition has no persist: prefix, so nothing outlives the process', () => {
    expect(PAGE_PARTITION).toBe('docket-pages');
    expect(PAGE_PARTITION.startsWith('persist:')).toBe(false);
  });

  it('I-68: the exact webPreferences, and no preload', () => {
    expect(PAGE_VIEW_WEB_PREFERENCES).toEqual({
      partition: 'docket-pages',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: false,
    });
    expect('preload' in PAGE_VIEW_WEB_PREFERENCES).toBe(false);
  });

  it('I-68: the scheme is privileged as standard and secure with fetch, cors and streaming off', () => {
    expect(PAGE_SCHEME_PRIVILEGES).toEqual([
      { scheme: 'docket-page', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } },
    ]);
    const registered: unknown[] = [];
    registerPageScheme({ registerSchemesAsPrivileged: (schemes) => registered.push(schemes) });
    expect(registered).toEqual([PAGE_SCHEME_PRIVILEGES]);
  });
});

// --- the contents hardening ----------------------------------------------------------------------------

describe('I-68: hardenPageContents', () => {
  it('I-68: popups are denied and audio is muted', () => {
    const { contents, state } = fakeContents();
    hardenPageContents(contents, ID, () => undefined);
    expect(state.openHandler?.()).toEqual({ action: 'deny' });
    expect(state.muted).toBe(true);
  });

  it.each(['will-navigate', 'will-frame-navigate', 'will-redirect'])('I-68: %s is prevented unless it stays on the same page', (eventName) => {
    const { contents, emit } = fakeContents();
    hardenPageContents(contents, ID, () => undefined);
    for (const url of ['https://example.com/', 'file:///etc/hosts', `docket-page://${OTHER}/v1/`, 'javascript:1', 'data:text/html,x', `docket-page://${ID}/v1/../x`, 'about:blank']) {
      const blocked = nav(url);
      emit(eventName, blocked);
      expect(blocked.preventDefault, url).toHaveBeenCalledTimes(1);
    }
    const allowed = nav(`docket-page://${ID.toLowerCase()}/v2/index.html`);
    emit(eventName, allowed);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });

  it('I-68: a navigation event without a readable url is prevented', () => {
    const { contents, emit } = fakeContents();
    hardenPageContents(contents, ID, () => undefined);
    const odd = { preventDefault: vi.fn() };
    emit('will-navigate', odd);
    expect(odd.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('I-68: a crashed or unresponsive renderer is reported', () => {
    const { contents, emit } = fakeContents();
    const gone: string[] = [];
    hardenPageContents(contents, ID, (reason) => gone.push(reason));
    emit('render-process-gone');
    emit('unresponsive');
    expect(gone).toEqual(['crashed', 'unresponsive']);
  });
});

// --- the session hardening -----------------------------------------------------------------------------

describe('I-68: installPageSession', () => {
  const setup = () => {
    const { session, calls } = fakeSession();
    const blocked: string[] = [];
    const responder = createPageResponder({ pages: { get: async () => page }, files: { read: async () => undefined } });
    installPageSession({ session, responder, currentPageId: () => ID, onBlocked: (url) => blocked.push(url) });
    return { calls, blocked };
  };

  it('I-68: the page handler is installed on this session, for the page scheme only', () => {
    expect(setup().calls.handled).toEqual(['docket-page']);
  });

  it('I-68: every permission request and check is refused', () => {
    const { calls } = setup();
    const granted: boolean[] = [];
    calls.permissionRequest?.({}, 'geolocation', (ok: boolean) => granted.push(ok));
    calls.permissionRequest?.({}, 'clipboard-read', (ok: boolean) => granted.push(ok));
    expect(granted).toEqual([false, false]);
    expect(calls.permissionCheck?.()).toBe(false);
  });

  it('I-68: the network filter cancels everything that is not an allowed request and reports it', () => {
    const { calls, blocked } = setup();
    const outcome = (url: string, resourceType?: string): boolean => {
      let cancel: boolean | undefined;
      calls.beforeRequest?.({ url, ...(resourceType === undefined ? {} : { resourceType }) }, (r) => {
        cancel = r.cancel;
      });
      return cancel === true;
    };
    expect(outcome('http://127.0.0.1:1/probe', 'image')).toBe(true);
    expect(outcome('https://example.com/', 'xhr')).toBe(true);
    expect(outcome('file:///etc/hosts', 'script')).toBe(true);
    expect(outcome(`docket-page://${OTHER}/v1/a.png`, 'image')).toBe(true);
    expect(outcome('data:text/html,x', 'subFrame')).toBe(true);
    expect(blocked).toHaveLength(5);
    expect(outcome(`docket-page://${ID}/v1/a.png`, 'image')).toBe(false);
    expect(outcome('data:image/png;base64,AAAA', 'image')).toBe(false);
    expect(blocked).toHaveLength(5);
  });

  it('I-68: with no page open the filter allows nothing', () => {
    const { session, calls } = fakeSession();
    installPageSession({ session, responder: createPageResponder({ pages: { get: async () => undefined }, files: { read: async () => undefined } }), currentPageId: () => undefined, onBlocked: () => undefined });
    let cancel = false;
    calls.beforeRequest?.({ url: `docket-page://${ID}/v1/`, resourceType: 'mainFrame' }, (r) => {
      cancel = r.cancel;
    });
    expect(cancel).toBe(true);
  });

  it('I-68: downloads are prevented', () => {
    const { calls } = setup();
    const event = { preventDefault: vi.fn() };
    calls.download?.(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('I-68: servePage turns a request into a response of the responder\'s answer', () => {
  it('I-68: status, headers and body travel; an empty body and 204 are body-less', async () => {
    const responder = createPageResponder({
      pages: { get: async () => ({ ...page, versions: [{ ...(page.versions[0] as Page['versions'][number]), files: [{ path: 'index.html', bytes: 2, sha256: 'x' }] }] }) },
      files: { read: async () => new TextEncoder().encode('ok') },
    });
    const ok = await servePage(responder, new Request(`docket-page://${ID.toLowerCase()}/v1/`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('ok');
    expect(ok.headers.get('content-security-policy')).toContain("default-src 'none'");
    const head = await servePage(responder, new Request(`docket-page://${ID.toLowerCase()}/v1/`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const miss = await servePage(responder, new Request(`docket-page://${ID.toLowerCase()}/v1/nope.html`));
    expect(miss.status).toBe(404);
  });
});

// --- the host ------------------------------------------------------------------------------------------

const hostSetup = (overrides: { content?: { width: number; height: number }; pages?: (id: PageId) => Promise<Page | undefined> } = {}) => {
  const { session, calls } = fakeSession();
  const views: { handle: PageViewHandle; fake: ReturnType<typeof fakeContents>; bounds: unknown[]; options: unknown }[] = [];
  const added: PageViewHandle[] = [];
  const removed: PageViewHandle[] = [];
  const closedReasons: string[] = [];
  const host = createPageViewHost({
    createView: (options) => {
      const fake = fakeContents();
      const bounds: unknown[] = [];
      const handle: PageViewHandle = { webContents: fake.contents, setBounds: (b) => bounds.push(b) };
      views.push({ handle, fake, bounds, options });
      return handle;
    },
    pages: { get: overrides.pages ?? (async (id) => (id === ID ? page : undefined)) },
    window: () => ({
      webContentsId: 7,
      contentSize: () => overrides.content ?? { width: 1000, height: 600 },
      addView: (view) => added.push(view),
      removeView: (view) => removed.push(view),
    }),
    session,
    onClosed: (reason) => closedReasons.push(reason),
  });
  return { host, views, added, removed, closedReasons, calls };
};

const MAIN = { webContentsId: 7, isMainFrame: true } as const;
const BOUNDS = { x: 10, y: 20, width: 300, height: 200 };
const OPEN = { op: 'open', pageId: ID, version: 1, bounds: BOUNDS } as const;

describe('I-68: the host opens one hardened view per page', () => {
  it('I-68: open builds the view with the pinned options, adds it, sizes it and loads the entry URL', async () => {
    const { host, views, added } = hostSetup();
    expect(await host.handle(MAIN, OPEN)).toEqual({ ok: true });
    expect(views).toHaveLength(1);
    expect(views[0]?.options).toEqual({ webPreferences: PAGE_VIEW_WEB_PREFERENCES });
    expect(added).toEqual([views[0]?.handle]);
    expect(views[0]?.bounds).toEqual([BOUNDS]);
    expect(views[0]?.fake.state.loaded).toEqual([`docket-page://${ID.toLowerCase()}/v1/`]);
    expect(views[0]?.fake.state.muted).toBe(true);
    expect(views[0]?.fake.state.openHandler?.()).toEqual({ action: 'deny' });
    expect(host.currentPageId()).toBe(ID);
  });

  it('I-68: bounds are clamped to the window content', async () => {
    const { host, views } = hostSetup({ content: { width: 400, height: 300 } });
    await host.handle(MAIN, { ...OPEN, bounds: { x: 350, y: 250, width: 900, height: 900 } });
    expect(views[0]?.bounds).toEqual([{ x: 350, y: 250, width: 50, height: 50 }]);
    await host.handle(MAIN, { op: 'setBounds', bounds: { x: 0, y: 0, width: 5000, height: 5000 } });
    expect(views[0]?.bounds[1]).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it('I-68: a caller that is not the main window, or not its top frame, is forbidden and nothing opens', async () => {
    const { host, views } = hostSetup();
    expect(await host.handle({ webContentsId: 9, isMainFrame: true }, OPEN)).toEqual({ ok: false, code: 'forbidden' });
    expect(await host.handle({ webContentsId: 7, isMainFrame: false }, OPEN)).toEqual({ ok: false, code: 'forbidden' });
    expect(await host.handle(undefined, OPEN)).toEqual({ ok: false, code: 'forbidden' });
    expect(await host.handle(MAIN, { op: 'close' })).toEqual({ ok: true });
    expect(views).toHaveLength(0);
    expect(host.currentPageId()).toBeUndefined();
  });

  it('I-68: invalid input is refused as invalid, before anything is looked up', async () => {
    const get = vi.fn(async () => page);
    const { host, views } = hostSetup({ pages: get });
    for (const payload of [undefined, {}, { op: 'open' }, { op: 'open', pageId: 'x', version: 1, bounds: BOUNDS }, { op: 'open', pageId: ID, version: 0, bounds: BOUNDS }, { op: 'open', pageId: ID, version: 1, bounds: { ...BOUNDS, width: -1 } }, { op: 'navigate', url: 'https://x' }]) {
      expect(await host.handle(MAIN, payload)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(get).not.toHaveBeenCalled();
    expect(views).toHaveLength(0);
  });

  it('I-68: an unknown page or version is not_found and opens nothing', async () => {
    const { host, views } = hostSetup();
    expect(await host.handle(MAIN, { ...OPEN, pageId: OTHER })).toEqual({ ok: false, code: 'not_found' });
    expect(await host.handle(MAIN, { ...OPEN, version: 9 })).toEqual({ ok: false, code: 'not_found' });
    expect(views).toHaveLength(0);
  });

  it('I-68: setBounds without an open view is not_found', async () => {
    const { host } = hostSetup();
    expect(await host.handle(MAIN, { op: 'setBounds', bounds: BOUNDS })).toEqual({ ok: false, code: 'not_found' });
  });

  it('I-68: opening again replaces: the old view is removed, closed and its storage cleared; nothing is reused', async () => {
    const { host, views, removed, calls } = hostSetup();
    await host.handle(MAIN, OPEN);
    await host.handle(MAIN, { ...OPEN, version: 1 });
    expect(views).toHaveLength(2);
    expect(removed).toEqual([views[0]?.handle]);
    expect(views[0]?.fake.state.closed).toBe(1);
    expect(views[1]?.fake.state.closed).toBe(0);
    expect(calls.cleared).toBe(1);
    expect(calls.cacheCleared).toBe(1);
  });

  it('I-68: close removes, destroys and clears; closing twice is harmless', async () => {
    const { host, views, removed, calls } = hostSetup();
    await host.handle(MAIN, OPEN);
    expect(await host.handle(MAIN, { op: 'close' })).toEqual({ ok: true });
    expect(await host.handle(MAIN, { op: 'close' })).toEqual({ ok: true });
    expect(removed).toEqual([views[0]?.handle]);
    expect(views[0]?.fake.state.closed).toBe(1);
    expect(calls.cleared).toBe(1);
    expect(host.currentPageId()).toBeUndefined();
  });

  it('I-68: a crashed renderer closes the view and tells the app; a stale view\'s event is ignored', async () => {
    const { host, views, removed, closedReasons } = hostSetup();
    await host.handle(MAIN, OPEN);
    await host.handle(MAIN, OPEN);
    views[0]?.fake.emit('render-process-gone');
    expect(closedReasons).toEqual([]);
    views[1]?.fake.emit('unresponsive');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closedReasons).toEqual(['unresponsive']);
    expect(removed).toHaveLength(2);
    expect(host.currentPageId()).toBeUndefined();
  });

  it('I-68: without a main window nobody is trusted', async () => {
    const { session } = fakeSession();
    const host = createPageViewHost({
      createView: () => {
        throw new Error('must not be called');
      },
      pages: { get: async () => page },
      window: () => undefined,
      session,
      onClosed: () => undefined,
    });
    expect(await host.handle(MAIN, OPEN)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('I-68: the window\'s view is the only thing that can be asked about: state reports url and page', async () => {
    const { host } = hostSetup();
    expect(host.state()).toEqual({ open: false });
    await host.handle(MAIN, OPEN);
    expect(host.state()).toEqual({ open: true, pageId: ID, url: `docket-page://${ID.toLowerCase()}/v1/` });
  });
});

describe('I-68: the test trace', () => {
  it('I-68: records answers and blocked requests with a cap, and counts past it', () => {
    const trace = createPageViewTrace(3);
    for (let n = 0; n < 5; n += 1) {
      trace.onServed({ url: `u${n}`, status: 200 });
      trace.onBlocked(`b${n}`);
    }
    const snapshot = trace.snapshot();
    expect(snapshot.served.map((entry) => entry.url)).toEqual(['u2', 'u3', 'u4']);
    expect(snapshot.blocked).toEqual(['b2', 'b3', 'b4']);
    expect(snapshot.servedCount).toBe(5);
    expect(snapshot.blockedCount).toBe(5);
  });
});

describe('I-71: WebRTC cannot carry data or addresses out of the view', () => {
  it('I-71: hardenPageContents sets the disable_non_proxied_udp policy', () => {
    const { contents, state } = fakeContents();
    hardenPageContents(contents, ID, () => undefined);
    expect(state.webrtc).toBe('disable_non_proxied_udp');
    expect(PAGE_WEBRTC_POLICY).toBe('disable_non_proxied_udp');
  });

  it('I-71: every view the host opens carries the policy before its page loads', async () => {
    const { host, views } = hostSetup();
    await host.handle(MAIN, OPEN);
    expect(views[0]?.fake.state.webrtc).toBe('disable_non_proxied_udp');
    expect(views[0]?.fake.state.loaded).toHaveLength(1);
  });
});
