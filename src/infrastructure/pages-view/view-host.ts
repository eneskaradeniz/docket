// The isolated page view host: where an agent-written page is shown without being trusted. The
// options a view is built with and every handler installed on its contents and session are decided
// here, against structural slices of the Electron objects (electron/page-view.ts adapts the real
// ones), so a unit test can pin the exact options and wiring without the runtime.
import type { Page, PageId } from '../../domain/index';
import type { PageRepo } from '../../application/index';

import { isAllowedNavigation, isAllowedRequest } from './allow';
import { PAGE_SCHEME } from './page-url';
import type { PageResponder, PageServed } from './responder';
import { clampBounds, isTrustedPageViewCaller, parsePageViewRequest } from './view-requests';
import type { PageViewCaller, ViewBounds } from './view-requests';

/** The web preferences a page view sets; a structural slice of Electron's own type. */
export interface PageViewPreferences {
  readonly partition: string;
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  readonly nodeIntegrationInSubFrames: boolean;
  readonly webSecurity: boolean;
  readonly allowRunningInsecureContent: boolean;
  readonly webviewTag: boolean;
  readonly navigateOnDragDrop: boolean;
  readonly spellcheck: boolean;
  readonly devTools: boolean;
}

export interface PageSchemeRegistration {
  readonly scheme: string;
  readonly privileges: {
    readonly standard: boolean;
    readonly secure: boolean;
    readonly supportFetchAPI: boolean;
    readonly corsEnabled: boolean;
    readonly stream: boolean;
  };
}

/** No `persist:` prefix: the partition lives in memory and dies with the process. */
export const PAGE_PARTITION = 'docket-pages';

/** The whole of a page view's web preferences. No preload: a page has no channel to Docket. */
export const PAGE_VIEW_WEB_PREFERENCES: PageViewPreferences = {
  partition: PAGE_PARTITION,
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
};

/** Standard and secure give the scheme real origins (storage, 'self' in the CSP); fetch, CORS and
 *  streaming stay off. */
export const PAGE_SCHEME_PRIVILEGES: readonly PageSchemeRegistration[] = [
  { scheme: PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } },
];

// --- the structural slices of Electron this file touches ---------------------------------------------------

export interface PageContentsLike {
  on(event: string, listener: (...args: never[]) => void): unknown;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
  setAudioMuted(muted: boolean): void;
  setWebRTCIPHandlingPolicy(policy: 'disable_non_proxied_udp'): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  close(): void;
  isDestroyed(): boolean;
}

export interface PageSessionLike {
  protocol: { handle(scheme: string, handler: (request: Request) => Promise<Response>): void };
  setPermissionRequestHandler(handler: ((webContents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null): void;
  setPermissionCheckHandler(handler: (() => boolean) | null): void;
  webRequest: {
    onBeforeRequest(
      listener: (details: { url: string; resourceType?: string }, callback: (response: { cancel: boolean }) => void) => void,
    ): void;
  };
  on(event: 'will-download', listener: (event: { preventDefault(): void }) => void): unknown;
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
}

export interface PageViewHandle {
  readonly webContents: PageContentsLike;
  setBounds(bounds: ViewBounds): void;
}

export interface PageViewWindow {
  /** The window's web contents id, compared with the caller's. */
  readonly webContentsId: number;
  contentSize(): { readonly width: number; readonly height: number };
  addView(view: PageViewHandle): void;
  removeView(view: PageViewHandle): void;
}

// --- scheme and session ------------------------------------------------------------------------------------

/** Must run before the app is ready. */
export const registerPageScheme = (protocol: { registerSchemesAsPrivileged(schemes: PageSchemeRegistration[]): void }): void => {
  protocol.registerSchemesAsPrivileged([...PAGE_SCHEME_PRIVILEGES]);
};

/** A null-body status (or an empty body) must not carry a body: the Response constructor throws. */
export const servePage = async (responder: PageResponder, request: Request): Promise<Response> => {
  const answer = await responder.respond({ method: request.method, url: request.url });
  const empty = answer.body.length === 0 || answer.status === 204;
  return new Response(empty ? null : (answer.body as unknown as ConstructorParameters<typeof Response>[0]), { status: answer.status, headers: { ...answer.headers } });
};

export interface PageSessionDeps {
  readonly session: PageSessionLike;
  readonly responder: PageResponder;
  /** The page currently shown; with none, no page URL is allowed. */
  readonly currentPageId: () => string | undefined;
  readonly onBlocked: (url: string) => void;
}

/** Hardens the pages partition's session. The scheme handler is installed here and nowhere else:
 *  the app's own session never learns the scheme, so the app window cannot load a page by URL. */
export const installPageSession = (deps: PageSessionDeps): void => {
  const { session } = deps;
  session.protocol.handle(PAGE_SCHEME, (request) => servePage(deps.responder, request));
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    const pageId = deps.currentPageId();
    const allowed =
      pageId !== undefined &&
      isAllowedRequest(details.url, { pageId, ...(details.resourceType === undefined ? {} : { resourceType: details.resourceType }) });
    if (!allowed) deps.onBlocked(details.url);
    callback({ cancel: !allowed });
  });
  session.on('will-download', (event) => event.preventDefault());
};

// --- one view's contents -----------------------------------------------------------------------------------

export type PageViewClosedReason = 'crashed' | 'unresponsive';

type NavigationEvent = { readonly url?: unknown; preventDefault(): void };

/** CSP does not cover WebRTC: an ICE server URL makes the renderer send UDP to any host and
 *  exposes the machine's addresses. This policy allows UDP only through a proxy, so none leaves. */
export const PAGE_WEBRTC_POLICY = 'disable_non_proxied_udp';

export const hardenPageContents = (contents: PageContentsLike, pageId: string, onGone: (reason: PageViewClosedReason) => void): void => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (event: NavigationEvent): void => {
    if (typeof event.url !== 'string' || !isAllowedNavigation(pageId, event.url)) event.preventDefault();
  };
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) contents.on(name, guard as never);
  contents.setAudioMuted(true);
  contents.setWebRTCIPHandlingPolicy(PAGE_WEBRTC_POLICY);
  contents.on('render-process-gone', (() => onGone('crashed')) as never);
  contents.on('unresponsive', (() => onGone('unresponsive')) as never);
};

// --- the test trace ----------------------------------------------------------------------------------------

export interface PageViewTraceSnapshot {
  readonly served: readonly PageServed[];
  readonly servedCount: number;
  readonly blocked: readonly string[];
  readonly blockedCount: number;
}

/** What the dev bridge shows of the page channel: every answered request and every request the
 *  network filter cancelled, bounded. It exists only in test launches. */
export const createPageViewTrace = (cap = 200) => {
  const served: PageServed[] = [];
  const blocked: string[] = [];
  let servedCount = 0;
  let blockedCount = 0;
  const push = <T,>(list: T[], item: T): void => {
    list.push(item);
    if (list.length > cap) list.shift();
  };
  return {
    onServed: (event: PageServed): void => {
      servedCount += 1;
      push(served, event);
    },
    onBlocked: (url: string): void => {
      blockedCount += 1;
      push(blocked, url);
    },
    snapshot: (): PageViewTraceSnapshot => ({ served: [...served], servedCount, blocked: [...blocked], blockedCount }),
  };
};

// --- the host ----------------------------------------------------------------------------------------------

export type PageViewResult = { readonly ok: true } | { readonly ok: false; readonly code: 'invalid' | 'not_found' | 'forbidden' };

export type PageViewState = { readonly open: false } | { readonly open: true; readonly pageId: string; readonly url: string };

export interface PageViewHostDeps {
  readonly createView: (options: { readonly webPreferences: PageViewPreferences }) => PageViewHandle;
  readonly pages: Pick<PageRepo, 'get'>;
  readonly window: () => PageViewWindow | undefined;
  readonly session: PageSessionLike;
  /** The renderer is told when the view went away on its own. */
  readonly onClosed: (reason: PageViewClosedReason) => void;
}

interface Open {
  readonly view: PageViewHandle;
  readonly pageId: PageId;
  readonly window: PageViewWindow;
}

export const createPageViewHost = (deps: PageViewHostDeps) => {
  let current: Open | undefined;
  // Requests are served strictly one after another: an open awaits the page repo, and two
  // interleaved opens must not leave two views behind.
  let tail: Promise<unknown> = Promise.resolve();

  const closeCurrent = async (): Promise<void> => {
    const open = current;
    if (open === undefined) return;
    current = undefined;
    try {
      open.window.removeView(open.view);
    } catch {
      // the window may already be gone
    }
    if (!open.view.webContents.isDestroyed()) open.view.webContents.close();
    // The partition is in memory but lives as long as the process: a page's storage must not be
    // there for the next page (or the same page) to read.
    await deps.session.clearStorageData().catch(() => undefined);
    await deps.session.clearCache().catch(() => undefined);
  };

  const fit = (bounds: ViewBounds, window: PageViewWindow): ViewBounds | undefined => clampBounds(bounds, window.contentSize());

  const run = async (caller: PageViewCaller | undefined, payload: unknown): Promise<PageViewResult> => {
    const window = deps.window();
    if (window === undefined || !isTrustedPageViewCaller(caller, window.webContentsId)) return { ok: false, code: 'forbidden' };
    const request = parsePageViewRequest(payload);
    if (request === undefined) return { ok: false, code: 'invalid' };

    if (request.op === 'close') {
      await closeCurrent();
      return { ok: true };
    }
    if (request.op === 'setBounds') {
      if (current === undefined) return { ok: false, code: 'not_found' };
      const bounds = fit(request.bounds, window);
      if (bounds === undefined) return { ok: false, code: 'invalid' };
      current.view.setBounds(bounds);
      return { ok: true };
    }

    const bounds = fit(request.bounds, window);
    if (bounds === undefined) return { ok: false, code: 'invalid' };
    const page: Page | undefined = await deps.pages.get(request.pageId);
    if (page === undefined || !page.versions.some((version) => version.n === request.version)) return { ok: false, code: 'not_found' };

    await closeCurrent();
    const view = deps.createView({ webPreferences: PAGE_VIEW_WEB_PREFERENCES });
    const open: Open = { view, pageId: request.pageId, window };
    current = open;
    hardenPageContents(view.webContents, request.pageId, (reason) => {
      // A stale view (already replaced or closed) is none of the renderer's business.
      if (current !== open) return;
      void closeCurrent().then(() => deps.onClosed(reason));
    });
    view.setBounds(bounds);
    window.addView(view);
    // A refused or failed load leaves the view blank; the page cannot learn why.
    void view.webContents.loadURL(`${PAGE_SCHEME}://${request.pageId.toLowerCase()}/v${request.version}/`).catch(() => undefined);
    return { ok: true };
  };

  return {
    handle: (caller: PageViewCaller | undefined, payload: unknown): Promise<PageViewResult> => {
      const next = tail.then(() => run(caller, payload));
      tail = next.catch(() => undefined);
      return next;
    },
    currentPageId: (): PageId | undefined => current?.pageId,
    state: (): PageViewState =>
      current === undefined
        ? { open: false }
        : { open: true, pageId: current.pageId, url: current.view.webContents.getURL() },
    /** The app is quitting or its window closed. */
    close: (): Promise<void> => {
      const next = tail.then(closeCurrent);
      tail = next.catch(() => undefined);
      return next;
    },
  };
};

export type PageViewHost = ReturnType<typeof createPageViewHost>;
