// stores/page-viewer.ts — the page viewer's stores and rules (U-75 … U-81). Three small machines
// and the plans the screen renders from: the work order's page list (the detail's Sayfalar
// section), the page screen's store (the `page.detail` read for the chosen version, the three page
// commands, the refetch on change events and on a poll, the new-version note) and the host that
// drives the native isolated view from the stage's rectangle. A page's text — diff lines, comment
// text, titles — is untrusted data: this module only carries it to the screen, which renders it as
// text nodes; nothing here builds markup from it or puts a page address into Docket's own DOM.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { PageCommentView, PageDetailView, PageListItem, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure, pageDecideKey } from './results';

/** The coarse change events the api emits (U-12); the page stores re-read on work-order changes —
 *  a page's version, comment and approval changes ride the same notification. */
export type PageChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' }
  // The chat members (U-97) ride the same push channel; stores that do not serve a chat ignore them.
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string };

/** Subscription to the change events; the api's `subscribe` satisfies it as-is. */
export type PageChangeSignal = (listener: (change: PageChange) => void) => () => void;

/** A comment's size ceiling (the domain's rule, mirrored so the screen can refuse before sending)
 *  and the length from which the composer shows its counter. */
export const COMMENT_MAX = 4000;
export const COMMENT_COUNTER_FROM = 3500;

/** How often an open page is re-read, besides the change events. */
export const PAGE_POLL_MS = 5000;

// --- the work order's page list -----------------------------------------------------------------

export interface PageListState {
  readonly items: readonly PageListItem[];
  readonly loading: boolean;
}

export interface PageListStore {
  load(workOrderId: string): Promise<void>;
  state(): PageListState;
  subscribe(listener: () => void): () => void;
}

export interface PageListStoreDeps {
  readonly api: Pick<Api, 'query'>;
  readonly changes: PageChangeSignal;
}

export const createPageListStore = (deps: PageListStoreDeps): PageListStore => {
  const { api, changes } = deps;
  let state: PageListState = { items: [], loading: false };
  let workOrder: string | null = null;
  let attempts = 0;
  const listeners = new Set<() => void>();
  const set = (next: PageListState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const read = async (): Promise<void> => {
    if (workOrder === null) return;
    const attempt = attempts + 1;
    attempts = attempt;
    const asked = workOrder;
    const reply: unknown = await api.query({ type: 'pages.list', workOrder: asked } satisfies Query);
    if (attempt !== attempts || asked !== workOrder) return;
    // A failed read keeps the rows on screen: the section must not vanish under a hiccup.
    if (isQueryFailure(reply) || !Array.isArray(reply)) {
      set({ ...state, loading: false });
      return;
    }
    set({ items: reply as readonly PageListItem[], loading: false });
  };

  changes((change) => {
    if (change.type === 'workOrders.changed') void read();
  });

  return {
    load: (workOrderId) => {
      if (workOrderId !== workOrder) {
        workOrder = workOrderId;
        set({ items: [], loading: true });
      }
      return read();
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

// --- plans the screen renders from ---------------------------------------------------------------

/** Fark needs a diff in the reply; without one the button says why. */
export interface DiffPlan {
  readonly enabled: boolean;
  readonly disabledKey: LabelKey | null;
}

export const diffPlan = (diff: PageDetailView['diff'], kind: PageListItem['kind']): DiffPlan =>
  diff !== undefined
    ? { enabled: true, disabledKey: null }
    : { enabled: false, disabledKey: kind === 'image' ? 'page.diff.image' : 'page.diff.noPrevious' };

/** The comments written on one version, in the order the api sent them (oldest first). */
export const commentsOfVersion = (detail: PageDetailView, version: number): readonly PageCommentView[] =>
  detail.comments.filter((comment) => comment.version === version);

export interface ComposerPlan {
  /** Only the latest version takes comments. */
  readonly visible: boolean;
  readonly canSubmit: boolean;
  readonly counter: boolean;
  readonly count: number;
}

export const composerPlan = (input: { readonly latest: boolean; readonly sending: boolean; readonly text: string }): ComposerPlan => {
  const count = input.text.length;
  return {
    visible: input.latest,
    canSubmit: input.latest && !input.sending && input.text.trim() !== '' && count <= COMMENT_MAX,
    counter: input.latest && count >= COMMENT_COUNTER_FROM,
    count,
  };
};

export type ApprovalAction = 'request' | 'reject' | 'approve';
export type ApprovalChipTone = 'dim' | 'signal' | 'proceed' | 'error';

export interface ApprovalBarPlan {
  readonly actions: readonly ApprovalAction[];
  /** An older version shows its actions but takes none. */
  readonly disabled: boolean;
  readonly reasonKey: LabelKey;
  readonly emphasis: Readonly<Partial<Record<ApprovalAction, 'primary' | 'neutral' | 'ghost'>>>;
  readonly chip: { readonly tone: ApprovalChipTone; readonly labelKey: LabelKey; readonly n?: number };
}

/** The approval chip alone — the header and the Sayfalar rows share it. */
export const approvalChip = (
  approval: PageListItem['approval'],
  approvedVersion: number | undefined,
): ApprovalBarPlan['chip'] => {
  switch (approval) {
    case 'pending':
      return { tone: 'signal', labelKey: 'page.approval.pending' };
    case 'approved':
      return { tone: 'proceed', labelKey: 'page.approval.approved', n: approvedVersion ?? 1 };
    case 'rejected':
      return { tone: 'error', labelKey: 'page.approval.rejected' };
    default:
      return { tone: 'dim', labelKey: 'page.approval.none' };
  }
};

/** The approval bar's whole state table: what the approval is, whether the shown version is the
 *  latest, whether the page's work order waits on a page-approval gate. Only Onayla is primary. */
export const approvalBar = (input: {
  readonly approval: PageListItem['approval'];
  readonly approvedVersion?: number;
  readonly shown: number;
  readonly latest: number;
  readonly gatePending: boolean;
}): ApprovalBarPlan => {
  const isLatest = input.shown === input.latest;
  const chip = approvalChip(input.approval, input.approvedVersion);
  if (input.approval === 'pending') {
    return {
      actions: ['reject', 'approve'],
      disabled: !isLatest,
      reasonKey: !isLatest ? 'page.bar.old' : input.gatePending ? 'page.bar.pendingGate' : 'page.bar.pendingPlain',
      emphasis: { reject: 'ghost', approve: 'primary' },
      chip,
    };
  }
  if (input.approval === 'approved') {
    return {
      actions: [],
      disabled: !isLatest,
      reasonKey: !isLatest ? 'page.bar.old' : 'page.bar.approved',
      emphasis: {},
      chip,
    };
  }
  return {
    actions: ['request'],
    disabled: !isLatest,
    reasonKey: !isLatest ? 'page.bar.old' : 'page.bar.idle',
    emphasis: { request: 'neutral' },
    chip,
  };
};

// --- the page screen's store ---------------------------------------------------------------------

/** One command's report — a fresh object per command so the toast shows once (U-50). */
export interface PageOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export type PageViewMode = 'preview' | 'diff';

export interface PageViewerState {
  readonly pageId: string | null;
  readonly loading: boolean;
  /** The failure code of the last `page.detail` read, null when it answered. */
  readonly problem: string | null;
  readonly detail: PageDetailView | null;
  /** The version on screen. */
  readonly selected: number | null;
  readonly newVersionNote: boolean;
  /** A command is in flight; a second one is not sent. */
  readonly busy: boolean;
  readonly lastOutcome: PageOutcome | null;
}

export interface PageViewerStore {
  /** Opens a page: forgets the previous one, reads it and starts the poll. */
  open(pageId: string): Promise<void>;
  /** Leaves the page: the poll stops and a late reply is dropped. */
  close(): void;
  select(version: number): Promise<void>;
  setMode(mode: PageViewMode): void;
  /** The mode actually shown: Fark falls back to Önizleme where the version has no diff. */
  viewMode(): PageViewMode;
  /** Resolves true when the comment was recorded (the composer clears), false otherwise. */
  comment(text: string): Promise<boolean>;
  requestApproval(): Promise<void>;
  decide(decision: 'approved' | 'rejected'): Promise<void>;
  state(): PageViewerState;
  subscribe(listener: () => void): () => void;
}

export interface PageViewerStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: PageChangeSignal;
  readonly actor: Actor;
  /** The poll interval; composition keeps the default, tests pass it explicitly. */
  readonly pollMs?: number;
}

const CLOSED: PageViewerState = {
  pageId: null,
  loading: false,
  problem: null,
  detail: null,
  selected: null,
  newVersionNote: false,
  busy: false,
  lastOutcome: null,
};

export const createPageViewerStore = (deps: PageViewerStoreDeps): PageViewerStore => {
  const { api, changes, actor } = deps;
  const pollMs = deps.pollMs ?? PAGE_POLL_MS;
  let state: PageViewerState = CLOSED;
  let mode: PageViewMode = 'preview';
  // True while the operator is on the latest version: a newer one then takes the screen.
  let following = true;
  let attempts = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PageViewerState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const read = async (): Promise<void> => {
    const pageId = state.pageId;
    if (pageId === null) return;
    const attempt = attempts + 1;
    attempts = attempt;
    const asked = following || state.selected === null ? undefined : state.selected;
    const reply: unknown = await api.query({
      type: 'page.detail',
      id: pageId,
      ...(asked === undefined ? {} : { version: asked }),
    } satisfies Query);
    if (attempt !== attempts || state.pageId !== pageId) return;
    if (isQueryFailure(reply)) {
      // The chosen version vanished (it cannot, versions are immutable — but a stale choice must
      // not strand the screen): fall back to the latest and read again.
      if (reply.code === 'unknown_version' && !following) {
        following = true;
        await read();
        return;
      }
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    const detail = reply as PageDetailView;
    const before = state.detail;
    const latest = detail.page.latestVersion;
    const arrived =
      before !== null &&
      latest > before.page.latestVersion &&
      (before.page.approval === 'pending' || before.page.approval === 'approved') &&
      detail.page.approval === 'none';
    set({
      ...state,
      loading: false,
      problem: null,
      detail,
      selected: following ? latest : detail.version,
      // The note stays until approval is asked for again (any approval other than none retires it).
      newVersionNote: detail.page.approval !== 'none' ? false : arrived || state.newVersionNote,
    });
  };

  changes((change) => {
    if (change.type === 'workOrders.changed' && state.pageId !== null) void read();
  });

  const stopPoll = (): void => {
    if (poll !== null) clearInterval(poll);
    poll = null;
  };

  /** Runs one command: guards a second one, reports the outcome once, then re-reads the page —
   *  every outcome changes what the screen should show (a refusal means it was stale). */
  const run = async (command: Command, labelKey: (result: CommandResult) => LabelKey): Promise<CommandResult | null> => {
    if (state.busy || state.pageId === null) return null;
    set({ ...state, busy: true });
    const result = await api.command(actor, command);
    set({ ...state, busy: false, lastOutcome: { command: command.type, result, labelKey: labelKey(result) } });
    await read();
    return result;
  };

  const refuse = (code: 'empty_comment' | 'comment_too_long'): void => {
    set({
      ...state,
      lastOutcome: { command: 'page.comment', result: { ok: false, code }, labelKey: commandResultKey('page.comment', { ok: false, code }) },
    });
  };

  return {
    open: async (pageId) => {
      stopPoll();
      following = true;
      mode = 'preview';
      attempts += 1;
      set({ ...CLOSED, pageId, loading: true });
      poll = setInterval(() => void read(), pollMs);
      await read();
    },
    close: () => {
      stopPoll();
      attempts += 1;
      set(CLOSED);
    },
    select: async (version) => {
      const latest = state.detail?.page.latestVersion ?? version;
      following = version === latest;
      set({ ...state, selected: version });
      await read();
    },
    setMode: (next) => {
      mode = next;
      set({ ...state });
    },
    viewMode: () => (mode === 'diff' && state.detail?.diff !== undefined ? 'diff' : 'preview'),
    comment: async (text) => {
      const detail = state.detail;
      if (detail === null || state.busy) return false;
      const body = text.trim();
      if (body === '') {
        refuse('empty_comment');
        return false;
      }
      if (body.length > COMMENT_MAX) {
        refuse('comment_too_long');
        return false;
      }
      const result = await run(
        { type: 'page.comment', page: detail.page.id, version: detail.version, text: body },
        (reply) => commandResultKey('page.comment', reply),
      );
      return result !== null && result.ok;
    },
    requestApproval: async () => {
      const detail = state.detail;
      if (detail === null) return;
      await run({ type: 'page.requestApproval', page: detail.page.id }, (reply) => commandResultKey('page.requestApproval', reply));
    },
    decide: async (decision) => {
      const detail = state.detail;
      if (detail === null) return;
      const gatePending = detail.gate?.pending === true;
      await run({ type: 'page.decide', page: detail.page.id, decision, version: detail.version }, (reply) =>
        reply.ok ? pageDecideKey(decision, gatePending) : commandResultKey('page.decide', reply),
      );
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

// --- the isolated view's host ---------------------------------------------------------------------

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The intersection of two rectangles, or null when they share no area. */
export const clipRect = (rect: Rect, clip: Rect): Rect | null => {
  const left = Math.max(rect.x, clip.x);
  const top = Math.max(rect.y, clip.y);
  const right = Math.min(rect.x + rect.width, clip.x + clip.width);
  const bottom = Math.min(rect.y + rect.height, clip.y + clip.height);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
};

/** Whether two rectangles share area; edges that only touch do not. */
export const rectsIntersect = (a: Rect, b: Rect): boolean => clipRect(a, b) !== null;

export interface PageViewTarget {
  readonly pageId: string;
  readonly version: number;
  readonly bounds: Rect;
}

/** Where the native view must be, or null when it must not exist: only Önizleme shows it, and it
 *  paints above everything of Docket's, so any overlay — a panel, the palette, the wizard, a toast
 *  lying over the stage — takes it away; it never extends past the main column's clip. */
export const previewTarget = (input: {
  readonly pageId: string;
  readonly version: number | null;
  readonly mode: PageViewMode;
  readonly overlayOpen: boolean;
  readonly toastRect: Rect | null;
  readonly rect: Rect | null;
  readonly clip: Rect | null;
}): PageViewTarget | null => {
  if (input.mode !== 'preview' || input.overlayOpen || input.version === null || input.rect === null) return null;
  if (input.toastRect !== null && rectsIntersect(input.toastRect, input.rect)) return null;
  const visible = input.clip === null ? input.rect : clipRect(input.rect, input.clip);
  if (visible === null) return null;
  const bounds: Rect = {
    x: Math.round(visible.x),
    y: Math.round(visible.y),
    width: Math.round(visible.width),
    height: Math.round(visible.height),
  };
  if (bounds.width < 1 || bounds.height < 1) return null;
  return { pageId: input.pageId, version: input.version, bounds };
};

/** The preload bridge's page-view surface, as this layer needs it (a structural twin of the
 *  bridge's own type — the presentation layer never imports from the shell's side). */
export interface PageViewPort {
  open(request: { readonly pageId: string; readonly version: number; readonly bounds: Rect }): Promise<PageViewReply>;
  setBounds(request: { readonly bounds: Rect }): Promise<PageViewReply>;
  close(): Promise<PageViewReply>;
  onClosed(listener: () => void): () => void;
}

export type PageViewReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'invalid' | 'not_found' | 'forbidden' };

export type PageViewStatus = 'idle' | 'open' | 'error';

export interface PageViewHost {
  /** The wanted view, or null for none. Idempotent: the host works out the calls. */
  update(target: PageViewTarget | null): void;
  /** Yeniden dene: tries the wanted view again after an error. */
  retry(): void;
  state(): { readonly status: PageViewStatus };
  subscribe(listener: () => void): () => void;
  /** Closes the view and lets go of the bridge. */
  dispose(): void;
}

export interface PageViewHostDeps {
  readonly port: PageViewPort;
  /** One animation frame: requestAnimationFrame in the app, a queue in tests. Returns its cancel. */
  readonly frame: (callback: () => void) => () => void;
}

const sameView = (a: PageViewTarget, b: PageViewTarget): boolean => a.pageId === b.pageId && a.version === b.version;
const sameBounds = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const createPageViewHost = (deps: PageViewHostDeps): PageViewHost => {
  const { port, frame } = deps;
  let desired: PageViewTarget | null = null;
  // What the main process holds right now.
  let actual: PageViewTarget | null = null;
  let status: PageViewStatus = 'idle';
  // The view that failed: the same one is not retried on its own (that would be a loop), a
  // different one is.
  let failed: PageViewTarget | null = null;
  let busy = false;
  let disposed = false;
  let cancelFrame: (() => void) | null = null;
  let snapshot: { readonly status: PageViewStatus } = { status };
  const listeners = new Set<() => void>();
  const setStatus = (next: PageViewStatus): void => {
    if (next === status) return;
    status = next;
    snapshot = { status };
    for (const listener of [...listeners]) listener();
  };

  const fail = (target: PageViewTarget): void => {
    actual = null;
    failed = target;
    setStatus('error');
  };

  const reconcile = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const want = desired;
        if (want === null) {
          if (actual !== null) {
            actual = null;
            await port.close();
          }
          failed = null;
          setStatus('idle');
          return;
        }
        if (failed !== null && sameView(failed, want)) return;
        if (actual !== null && !sameView(actual, want)) {
          actual = null;
          await port.close();
          continue;
        }
        if (actual === null) {
          try {
            const reply = await port.open(want);
            if (!reply.ok) {
              fail(want);
              return;
            }
          } catch {
            fail(want);
            return;
          }
          actual = want;
          failed = null;
          setStatus('open');
          continue;
        }
        if (sameBounds(actual.bounds, want.bounds)) return;
        actual = want;
        try {
          const reply = await port.setBounds({ bounds: want.bounds });
          if (!reply.ok) {
            fail(want);
            return;
          }
        } catch {
          fail(want);
          return;
        }
      }
    } finally {
      busy = false;
    }
  };

  const scheduleFrame = (): void => {
    if (cancelFrame !== null) return;
    cancelFrame = frame(() => {
      cancelFrame = null;
      void reconcile();
    });
  };

  // The main process tears the view down when its process dies or hangs: the screen must show the
  // error state, never a blank rectangle.
  const stopClosed = port.onClosed(() => {
    if (disposed) return;
    actual = null;
    if (desired !== null) {
      failed = desired;
      setStatus('error');
    }
  });

  return {
    update: (target) => {
      if (disposed) return;
      desired = target;
      if (target === null) {
        cancelFrame?.();
        cancelFrame = null;
        void reconcile();
        return;
      }
      if (actual !== null && sameView(actual, target)) scheduleFrame();
      else void reconcile();
    },
    retry: () => {
      if (disposed || status !== 'error') return;
      failed = null;
      setStatus('idle');
      void reconcile();
    },
    state: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      stopClosed();
      cancelFrame?.();
      cancelFrame = null;
      desired = null;
      void reconcile();
      disposed = true;
    },
  };
};
