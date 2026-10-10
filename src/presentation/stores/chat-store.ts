// stores/chat-store.ts — the Docket AI chat's store (U-101 … U-122): the panel's standing, the scope
// rules, send and the live turn (dots until the first `chat.delta`, the text growing in place, the
// stored message replacing it on `finished`), the history, the @ menu, attachments, the cards and
// action rows, the permission grant and the footer line. It composes the chat commands and queries
// of the api from the bridge alone and keeps nothing between sessions. Message text, titles and
// labels are untrusted data: this module only carries them to the components, which render them as
// text nodes.
import type { Api } from '../../api/api';
import type { ChatConversationView, ChatReferenceView, ChatUsageView } from '../../api/chat-views';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import {
  atQueryOf,
  chatActiveGrant,
  chatBusy,
  chatFailureKey,
  chatInputBlocked,
  chatNeedsTick,
  chipOfReference,
  extOf,
  FILE_MAX_BYTES,
  fileVerdict,
  GLOBAL_PLACE,
  placeScope,
  REF_LIMIT,
  sameScope,
  stripAtToken,
  trayKindOf,
  type ChatChange,
  type ChatNote,
  type ChatPlace,
  type ChatScopeInput,
  type ChatState,
  type ChatToast,
  type ProposalState,
  type RefChip,
  type TrayItem,
} from './chat-model';
import { isQueryFailure } from './results';

export type { ChatChange, ChatState, ChatToast };

export type ChatChangeSignal = (listener: (change: ChatChange) => void) => () => void;

/** How long typing must rest before the history search or the @ query is sent (U-85's window). */
export const CHAT_DEBOUNCE_MS = 200;
/** The history list asks for this many rows, the api's own cap. */
export const CHAT_HISTORY_LIMIT = 100;
/** A grant is for one hour, the api's own ceiling. */
export const CHAT_GRANT_MINUTES = 60;

export interface ChatStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: ChatChangeSignal;
  readonly actor: Actor;
  readonly now: () => number;
  /** Toasts go through the host's one toast service (U-50); the host owns the locale. */
  readonly notify: (toast: ChatToast) => void;
}

export interface ChatFileInput {
  readonly name: string;
  readonly base64: string;
  /** The file's size in bytes when the picker knows it. */
  readonly size?: number;
}

export interface ComposerKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly composing: boolean;
}

export interface ChatStore {
  state(): ChatState;
  subscribe(listener: () => void): () => void;
  // panel
  open(): void;
  close(): void;
  toggle(): void;
  /** The one door for the contextual launchers: open on a scope with an optional prefilled text. */
  openChat(input: { readonly scope: ChatScopeInput; readonly prefill?: string }): void;
  /** The shell tells the panel what the current screen gives it (U-122). */
  setPlace(place: ChatPlace): void;
  /** Esc, one rung at a time (U-117); false when nothing was open. */
  escape(): boolean;
  // scope
  togglePop(): void;
  closePop(): void;
  pickScope(scope: ChatScopeInput): void;
  followScreen(): void;
  // composer
  setDraft(text: string): void;
  composerKey(key: ComposerKey): boolean;
  send(): Promise<void>;
  sendText(text: string): Promise<void>;
  cancel(): Promise<void>;
  newConversation(): Promise<void>;
  dismissNote(): void;
  clearNotice(): void;
  // menus, references, files
  openPlus(): void;
  openAt(): void;
  closeMenu(): void;
  moveAt(delta: number): void;
  commitAt(): boolean;
  pickRef(reference: ChatReferenceView): void;
  removeRef(key: string): void;
  attachScreen(): void;
  addFiles(files: readonly ChatFileInput[]): void;
  removeFile(id: string): void;
  // history
  openHistory(): void;
  closeHistory(): void;
  toggleHistory(): void;
  setSearch(text: string): void;
  openConversation(id: string): Promise<void>;
  pinConversation(id: string, pinned: boolean): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  // cards and actions
  loadProposal(id: string): void;
  confirmDraft(id: string): Promise<void>;
  dropDraft(id: string): Promise<void>;
  decide(action: string, decision: 'approved' | 'rejected'): Promise<void>;
  undo(action: string): Promise<void>;
  // permission surface
  togglePerm(): void;
  closePerm(): void;
  setPermClass(actionClass: string, on: boolean): void;
  grant(): Promise<void>;
  revoke(): Promise<void>;
}

const EMPTY_AT = { q: '', items: [], index: 0, loading: false } as const;

/** A conversation reply is the view or a failure; anything else breaks the contract. */
const conversationOf = (reply: unknown): ChatConversationView | { readonly code: string } => {
  if (isQueryFailure(reply)) return { code: reply.code };
  if (typeof reply === 'object' && reply !== null && 'id' in reply && 'messages' in reply && Array.isArray((reply as { messages: unknown }).messages)) {
    return reply as ChatConversationView;
  }
  return { code: 'unknown' };
};

const isView = (value: ChatConversationView | { readonly code: string }): value is ChatConversationView => 'messages' in value;

const isChatEvent = (change: ChatChange): change is Extract<ChatChange, { readonly conversation: string }> => 'conversation' in change;

const scopeOfView = (scope: ChatConversationView['scope']): ChatScopeInput => scope;

export const createChatStore = (deps: ChatStoreDeps): ChatStore => {
  const { api, changes, actor, now, notify } = deps;

  let state: ChatState = {
    open: false,
    view: 'chat',
    conversation: null,
    detail: null,
    place: GLOBAL_PLACE,
    scope: { kind: 'global' },
    pinned: false,
    draft: '',
    refs: [],
    tray: [],
    uploading: 0,
    pending: null,
    sending: false,
    turn: null,
    streamed: '',
    notice: null,
    note: null,
    menu: null,
    at: EMPTY_AT,
    scopePop: false,
    permOpen: false,
    permDraft: [],
    history: { items: [], search: '', loaded: false, failed: false },
    usage: null,
    proposals: {},
    alert: false,
    now: now(),
    focusTick: 0,
  };
  const listeners = new Set<() => void>();
  // Only the newest read of each kind may land: a slow reply must not overwrite a fresher one.
  let conversationSeq = 0;
  let historySeq = 0;
  let atSeq = 0;
  let usageSeq = 0;
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  let atTimer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  // Events that arrive while a new conversation's start has not answered yet are held and replayed
  // once its id is known.
  let starting = false;
  let early: ChatChange[] = [];
  // The pending cards already announced, so only a new one raises the alert.
  const seenPending = new Set<string>();

  const set = (patch: Partial<ChatState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const toast = (key: LabelKey, values?: Readonly<Record<string, string>>, type: ChatToast['type'] = 'success'): void => {
    notify({ type, key, ...(values === undefined ? {} : { values }) });
  };

  const failed = (result: Extract<CommandResult, { readonly ok: false }>): void => {
    set({ note: { key: chatFailureKey(result.code) } });
  };

  const run = (command: Command): Promise<CommandResult> => api.command(actor, command);

  // --- the clock ---------------------------------------------------------------------------------------

  const syncTicker = (): void => {
    const need = chatNeedsTick(state.detail, now());
    if (need && ticker === null) ticker = setInterval(tick, 1000);
    if (!need && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
  function tick(): void {
    set({ now: now() });
    syncTicker();
  }

  // --- conversation reads ------------------------------------------------------------------------------

  const fetchConversation = async (id: string): Promise<ChatConversationView | { readonly code: string } | null> => {
    conversationSeq += 1;
    const seq = conversationSeq;
    const reply = conversationOf(await api.query({ type: 'chat.conversation', id } satisfies Query));
    return seq === conversationSeq ? reply : null;
  };

  const applyDetail = (view: ChatConversationView): void => {
    const pendingNow = [...view.drafts.filter((d) => d.status === 'draft').map((d) => d.id), ...view.actions.filter((a) => a.status === 'pending').map((a) => a.id)];
    const fresh = pendingNow.some((id) => !seenPending.has(id));
    for (const id of pendingNow) seenPending.add(id);
    set({
      detail: view,
      turn: view.activeTurn ?? null,
      now: now(),
      ...(fresh && !state.open ? { alert: true } : {}),
    });
    syncTicker();
  };

  /** Re-reads the open conversation after a command or a finished turn. */
  const reload = async (id: string): Promise<void> => {
    const reply = await fetchConversation(id);
    if (reply === null || state.conversation !== id) return;
    if (isView(reply)) applyDetail(reply);
    else set({ note: { key: chatFailureKey(reply.code) } });
  };

  const reloadCurrent = async (): Promise<void> => {
    if (state.conversation !== null) await reload(state.conversation);
  };

  const loadUsage = async (): Promise<void> => {
    usageSeq += 1;
    const seq = usageSeq;
    const reply = await api.query({ type: 'chat.usage' } satisfies Query);
    if (seq !== usageSeq || isQueryFailure(reply)) return;
    // A reply that is not the usage view (the contract's other shape) keeps the line as it was.
    if (typeof reply !== 'object' || reply === null || !('month' in reply)) return;
    set({ usage: reply as ChatUsageView });
  };

  // --- resetting ---------------------------------------------------------------------------------------

  /** A different conversation begins: the old one's view and live state go, the draft stays. */
  const resetConversation = (patch: Partial<ChatState> = {}): void => {
    conversationSeq += 1;
    starting = false;
    early = [];
    set({
      conversation: null,
      detail: null,
      turn: null,
      streamed: '',
      pending: null,
      sending: false,
      notice: null,
      note: null,
      scopePop: false,
      permOpen: false,
      permDraft: [],
      ...patch,
    });
    syncTicker();
  };

  // --- events ------------------------------------------------------------------------------------------

  const handle = (change: ChatChange): void => {
    if (change.type === 'accounts.changed') {
      if (chatInputBlocked(state)) set({ notice: null });
      return;
    }
    if (!isChatEvent(change)) return;
    if (state.conversation === null && starting) {
      early.push(change);
      return;
    }
    if (change.conversation !== state.conversation) return;
    if (change.type === 'chat.delta') {
      set({ turn: state.turn ?? change.turn, streamed: state.streamed + change.text });
      return;
    }
    if (change.type === 'chat.notice') {
      set({ notice: change.code });
      return;
    }
    if (change.phase === 'started') {
      set({ turn: change.turn, streamed: '' });
      return;
    }
    const id = state.conversation;
    set({ turn: null, sending: false });
    void (async () => {
      if (id !== null) await reload(id);
      // The stored message now stands where the streamed text was.
      if (state.conversation === id) set({ streamed: '' });
      void loadUsage();
    })();
  };
  changes(handle);

  // --- sending -----------------------------------------------------------------------------------------

  const sendWith = async (text: string, fromDraft: boolean): Promise<void> => {
    const message = text.trim();
    if (message === '' || chatBusy(state) || chatInputBlocked(state) || state.uploading > 0) return;
    const { refs, tray, conversation, scope } = state;
    const original = state.draft;
    set({
      sending: true,
      pending: { text: message, refs, files: tray },
      notice: null,
      note: null,
      streamed: '',
      refs: [],
      tray: [],
      menu: null,
      ...(fromDraft ? { draft: '' } : {}),
    });
    const extras = {
      ...(refs.length === 0 ? {} : { refs: refs.map((chip) => chip.input) }),
      ...(tray.length === 0 ? {} : { attachments: tray.map((item) => item.id) }),
    };
    if (conversation === null) starting = true;
    const result =
      conversation === null
        ? await run({ type: 'chat.start', scope, message, ...extras })
        : await run({ type: 'chat.send', conversation, text: message, ...extras });
    if (!result.ok) {
      starting = false;
      early = [];
      set({
        sending: false,
        pending: null,
        refs,
        tray,
        ...(fromDraft ? { draft: original } : {}),
        note: { key: chatFailureKey(result.code) },
      });
      // A refused send of a busy conversation still appended the message: show what is stored.
      if (conversation !== null && result.code === 'busy') await reload(conversation);
      return;
    }
    const id = conversation ?? result.conversation ?? null;
    if (id === null) {
      starting = false;
      early = [];
      set({ sending: false, pending: null, refs, tray, note: { key: 'error.unknown' } });
      return;
    }
    const held = early.filter((change) => isChatEvent(change) && change.conversation === id);
    starting = false;
    early = [];
    set({ conversation: id, sending: false, turn: result.turn ?? state.turn });
    for (const change of held) handle(change);
    await reload(id);
    // The persisted read carries the stored user message: the optimistic bubble goes.
    set({ pending: null });
  };

  // --- the @ menu --------------------------------------------------------------------------------------

  const fetchReferences = async (q: string): Promise<void> => {
    atSeq += 1;
    const seq = atSeq;
    const reply = await api.query({ type: 'chat.references', q } satisfies Query);
    if (seq !== atSeq || state.menu !== 'at' || state.at.q !== q) return;
    if (isQueryFailure(reply) || !Array.isArray(reply)) {
      set({ at: { q, items: [], index: 0, loading: false } });
      return;
    }
    const taken = new Set(state.refs.map((chip) => chip.key));
    const items = (reply as readonly ChatReferenceView[]).filter((item) => !taken.has(chipOfReference(item).key));
    set({ at: { q, items, index: 0, loading: false } });
  };

  const closeAt = (): void => {
    if (atTimer !== null) clearTimeout(atTimer);
    atTimer = null;
    atSeq += 1;
    set({ menu: null, at: EMPTY_AT });
  };

  const openAtMenu = (q: string): void => {
    if (atTimer !== null) clearTimeout(atTimer);
    atTimer = null;
    set({ menu: 'at', at: { q, items: q === state.at.q ? state.at.items : [], index: 0, loading: q !== '' } });
    if (q === '') {
      atSeq += 1;
      return;
    }
    atTimer = setTimeout(() => {
      atTimer = null;
      void fetchReferences(q);
    }, CHAT_DEBOUNCE_MS);
  };

  // --- history -----------------------------------------------------------------------------------------

  const loadHistory = async (): Promise<void> => {
    historySeq += 1;
    const seq = historySeq;
    const q = state.history.search.trim();
    const reply = await api.query({ type: 'chat.conversations', ...(q === '' ? {} : { q }), limit: CHAT_HISTORY_LIMIT } satisfies Query);
    if (seq !== historySeq) return;
    if (isQueryFailure(reply) || !Array.isArray(reply)) {
      set({ history: { ...state.history, loaded: true, failed: true } });
      return;
    }
    set({ history: { ...state.history, items: reply as ChatState['history']['items'], loaded: true, failed: false } });
  };

  // --- uploads -----------------------------------------------------------------------------------------

  const upload = async (file: ChatFileInput, ext: string, conversation: string | null): Promise<void> => {
    const result = await run({ type: 'chat.attach', ...(conversation === null ? {} : { conversation }), name: file.name, fileType: ext, base64: file.base64 });
    if (!result.ok) {
      set({ uploading: state.uploading - 1, note: { key: chatFailureKey(result.code) } });
      return;
    }
    if (result.attachment === undefined) {
      set({ uploading: state.uploading - 1, note: { key: 'error.unknown' } });
      return;
    }
    const item: TrayItem = { id: result.attachment, name: file.name, kind: trayKindOf(ext) };
    set({ uploading: state.uploading - 1, tray: [...state.tray, item] });
  };

  const addRefChip = (chip: RefChip): boolean => {
    if (state.refs.some((entry) => entry.key === chip.key)) return true;
    if (state.refs.length >= REF_LIMIT) {
      set({ note: { key: 'chat.error.too_many_refs' } });
      return false;
    }
    set({ refs: [...state.refs, chip] });
    return true;
  };

  const store: ChatStore = {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    open: () => {
      set({ open: true, alert: false, focusTick: state.focusTick + 1 });
      void loadUsage();
    },
    close: () => {
      set({ open: false, scopePop: false, menu: null, permOpen: false });
    },
    toggle: () => {
      if (state.open) store.close();
      else store.open();
    },
    openChat: ({ scope, prefill }) => {
      const pinned = !sameScope(scope, placeScope(state.place));
      resetConversation({ scope, pinned, view: 'chat', menu: null, ...(prefill === undefined ? {} : { draft: prefill }) });
      store.open();
    },
    setPlace: (place) => {
      set({ place });
      if (state.pinned) return;
      const next = placeScope(place);
      if (!sameScope(next, state.scope)) resetConversation({ scope: next });
    },
    escape: () => {
      if (!state.open) return false;
      if (state.scopePop) set({ scopePop: false });
      else if (state.menu !== null) store.closeMenu();
      else if (state.permOpen) set({ permOpen: false });
      else if (state.view === 'history') store.closeHistory();
      else store.close();
      return true;
    },

    togglePop: () => set({ scopePop: !state.scopePop }),
    closePop: () => set({ scopePop: false }),
    pickScope: (scope) => {
      resetConversation({ scope, pinned: !sameScope(scope, placeScope(state.place)), scopePop: false });
    },
    followScreen: () => {
      resetConversation({ scope: placeScope(state.place), pinned: false, scopePop: false });
    },

    setDraft: (text) => {
      set({ draft: text });
      const q = atQueryOf(text);
      if (q === null) {
        if (state.menu === 'at') closeAt();
        return;
      }
      openAtMenu(q);
    },
    composerKey: ({ key, shiftKey, composing }) => {
      if (composing) return false;
      if (state.menu === 'at' && state.at.items.length > 0) {
        if (key === 'ArrowDown') {
          store.moveAt(1);
          return true;
        }
        if (key === 'ArrowUp') {
          store.moveAt(-1);
          return true;
        }
        if ((key === 'Enter' && !shiftKey) || key === 'Tab') return store.commitAt();
      }
      if (key === 'Enter' && !shiftKey) {
        void store.send();
        return true;
      }
      if (key === 'Backspace' && state.draft === '' && state.refs.length > 0) {
        set({ refs: state.refs.slice(0, -1) });
        return true;
      }
      return false;
    },
    send: () => sendWith(state.draft, true),
    sendText: (text) => sendWith(text, false),
    cancel: async () => {
      if (state.conversation === null) return;
      const result = await run({ type: 'chat.cancel', conversation: state.conversation });
      if (!result.ok) failed(result);
    },
    newConversation: async () => {
      resetConversation({ view: 'chat', refs: [], tray: [], menu: null });
      toast('chat.toast.new');
    },
    dismissNote: () => set({ note: null }),
    clearNotice: () => set({ notice: null }),

    openPlus: () => set({ menu: state.menu === 'plus' ? null : 'plus' }),
    openAt: () => {
      if (atQueryOf(state.draft) === null) {
        const lead = state.draft === '' || /\s$/.test(state.draft) ? '' : ' ';
        set({ draft: `${state.draft}${lead}@` });
      }
      openAtMenu(atQueryOf(state.draft) ?? '');
      set({ focusTick: state.focusTick + 1 });
    },
    closeMenu: () => {
      if (state.menu === 'at') closeAt();
      else set({ menu: null });
    },
    moveAt: (delta) => {
      const last = Math.max(0, state.at.items.length - 1);
      set({ at: { ...state.at, index: Math.min(last, Math.max(0, state.at.index + delta)) } });
    },
    commitAt: () => {
      const item = state.at.items[state.at.index];
      if (item === undefined) return false;
      store.pickRef(item);
      return true;
    },
    pickRef: (reference) => {
      const chip = chipOfReference(reference);
      const wasAt = state.menu === 'at';
      if (!addRefChip(chip)) {
        closeAt();
        return;
      }
      if (wasAt) closeAt();
      else set({ menu: null });
      set({ ...(wasAt ? { draft: stripAtToken(state.draft) } : {}), focusTick: state.focusTick + 1 });
      toast('chat.toast.added', { name: reference.label });
    },
    removeRef: (key) => set({ refs: state.refs.filter((chip) => chip.key !== key) }),
    attachScreen: () => {
      const screen = state.place.screen;
      set({ menu: null });
      if (screen === null) {
        set({ note: { key: 'chat.plus.screen.none' } });
        return;
      }
      if (state.refs.some((chip) => chip.key === screen.key)) return;
      if (addRefChip(screen)) toast('chat.toast.screen');
    },
    addFiles: (files) => {
      set({ menu: null });
      for (const file of files) {
        const verdict = fileVerdict(file.name, state.tray.length + state.uploading);
        if (verdict.kind === 'video') set({ note: { key: 'chat.file.video' } });
        else if (verdict.kind === 'type') set({ note: { key: 'chat.file.type' } });
        else if (verdict.kind === 'limit') set({ note: { key: 'chat.file.limit' } });
        else if (file.size !== undefined && file.size > FILE_MAX_BYTES) set({ note: { key: 'chat.error.attachment_too_large' } });
        else {
          set({ uploading: state.uploading + 1, note: verdict.image ? { key: 'chat.file.image' } : null });
          void upload(file, extOf(file.name), state.conversation);
        }
      }
    },
    removeFile: (id) => set({ tray: state.tray.filter((item) => item.id !== id) }),

    openHistory: () => {
      set({ view: 'history', menu: null, scopePop: false, permOpen: false });
      void loadHistory();
    },
    closeHistory: () => set({ view: 'chat', focusTick: state.focusTick + 1 }),
    toggleHistory: () => {
      if (state.view === 'history') store.closeHistory();
      else store.openHistory();
    },
    setSearch: (text) => {
      set({ history: { ...state.history, search: text } });
      if (historyTimer !== null) clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        historyTimer = null;
        void loadHistory();
      }, CHAT_DEBOUNCE_MS);
    },
    openConversation: async (id) => {
      const reply = await fetchConversation(id);
      if (reply === null) return;
      if (!isView(reply)) {
        set({ note: { key: chatFailureKey(reply.code) } });
        return;
      }
      const scope = scopeOfView(reply.scope);
      set({
        view: 'chat',
        conversation: reply.id,
        scope,
        pinned: !sameScope(scope, placeScope(state.place)),
        streamed: '',
        notice: null,
        note: null,
        pending: null,
        sending: false,
        scopePop: false,
        permOpen: false,
        menu: null,
        focusTick: state.focusTick + 1,
      });
      applyDetail(reply);
      toast('chat.toast.opened');
    },
    pinConversation: async (id, pinned) => {
      const mark = (value: boolean): void => {
        set({ history: { ...state.history, items: state.history.items.map((row) => (row.id === id ? { ...row, pinned: value } : row)) } });
      };
      const before = state.history.items.find((row) => row.id === id)?.pinned ?? !pinned;
      mark(pinned);
      const result = await run({ type: 'chat.pin', conversation: id, pinned });
      if (!result.ok) {
        mark(before);
        failed(result);
      }
    },
    deleteConversation: async (id) => {
      const result = await run({ type: 'chat.delete', conversation: id });
      if (!result.ok) {
        failed(result);
        return;
      }
      set({ history: { ...state.history, items: state.history.items.filter((row) => row.id !== id) } });
      if (state.conversation === id) resetConversation();
      toast('chat.toast.deleted');
    },

    loadProposal: (id) => {
      const known = state.proposals[id];
      if (known !== undefined && known.status !== 'failed') return;
      const put = (next: ProposalState): void => set({ proposals: { ...state.proposals, [id]: next } });
      put({ status: 'loading', summary: '', target: '', lines: [] });
      void (async () => {
        const reply = await api.query({ type: 'proposal.detail', id } satisfies Query);
        if (isQueryFailure(reply) || typeof reply !== 'object' || reply === null) {
          put({ status: 'failed', summary: '', target: '', lines: [] });
          return;
        }
        const view = reply as { readonly summary: string; readonly target: string; readonly lines: ProposalState['lines'] };
        put({ status: 'ready', summary: view.summary, target: view.target, lines: view.lines });
      })();
    },
    confirmDraft: async (id) => {
      const result = await run({ type: 'chat.draft.confirm', draft: id });
      if (!result.ok) {
        failed(result);
        return;
      }
      toast('chat.toast.workOrder');
      await reloadCurrent();
    },
    dropDraft: async (id) => {
      const result = await run({ type: 'chat.draft.drop', draft: id });
      if (!result.ok) {
        failed(result);
        return;
      }
      await reloadCurrent();
    },
    decide: async (action, decision) => {
      const result = await run({ type: 'chat.action.decide', id: action, decision });
      if (!result.ok) {
        failed(result);
        return;
      }
      toast(decision === 'approved' ? 'chat.toast.approved' : 'chat.toast.rejected');
      await reloadCurrent();
    },
    undo: async (action) => {
      const result = await run({ type: 'chat.action.undo', id: action });
      if (!result.ok) {
        failed(result);
        return;
      }
      toast('chat.toast.undone');
      await reloadCurrent();
    },

    togglePerm: () => set({ permOpen: !state.permOpen, ...(state.permOpen ? {} : { permDraft: [] }) }),
    closePerm: () => set({ permOpen: false }),
    setPermClass: (actionClass, on) => {
      const rest = state.permDraft.filter((entry) => entry !== actionClass);
      set({ permDraft: on ? [...rest, actionClass] : rest });
    },
    grant: async () => {
      if (state.permDraft.length === 0) return;
      let conversation = state.conversation;
      if (conversation === null) {
        const started = await run({ type: 'chat.start', scope: state.scope });
        if (!started.ok || started.conversation === undefined) {
          set({ note: { key: started.ok ? 'error.unknown' : chatFailureKey(started.code) } });
          return;
        }
        conversation = started.conversation;
        set({ conversation });
      }
      const result = await run({ type: 'chat.grant', conversation, classes: state.permDraft, minutes: CHAT_GRANT_MINUTES });
      if (!result.ok) {
        failed(result);
        return;
      }
      set({ permOpen: false, permDraft: [] });
      toast('chat.toast.granted');
      await reload(conversation);
    },
    revoke: async () => {
      const grant = chatActiveGrant(state);
      if (grant === null) return;
      const result = await run({ type: 'chat.revoke', grant: grant.id });
      if (!result.ok) {
        failed(result);
        return;
      }
      set({ permOpen: false });
      toast('chat.toast.revoked');
      await reloadCurrent();
    },
  };

  return store;
};

export type { ChatNote };
