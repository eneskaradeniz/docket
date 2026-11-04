// stores/setup-chat.ts — the setup conversation's own store (U-385 … U-388): a sibling of the
// dock's chat-store, not a member of it. It holds the screen's standing, the folder field, the
// standing setup conversation (resumed through the draft store's re-registration) and its live
// turn — streaming, thinking, tool steps and their fold ride the dock's own rules through the
// shared chat-model selectors — plus the one read-permission prompt and the project_setup
// proposal card that decides through proposal.decide. It never lists conversations and never
// touches the dock's history. Message text, titles and labels are untrusted data: this module
// only carries them to the components, which render them as text nodes.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import {
  appendThinking,
  chatBusy,
  chatFailureKey,
  stepRowsAfter,
  type ChatStepRow,
} from './chat-model';
import {
  canShowPermission,
  folderName,
  pendingOf,
  permissionAfterDeny,
  resumableOf,
  type NewProjectDone,
  type ResumableDraft,
  type SetupChange,
  type SetupChangeSignal,
  type SetupPermissionPrompt,
  type SetupProposal,
  type SetupThreadMessage,
  setupAiFailureKey,
  setupProposalOf,
  setupProposalRowOf,
  slugOf,
  targetOf,
  threadOf,
} from './new-project';
import { commandResultKey, isQueryFailure } from './results';

export type { SetupChange, SetupChangeSignal, SetupPermissionPrompt, SetupThreadMessage };

/** The project_setup proposal as the card draws it (U-111's anatomy, A-360's decision). */
export interface SetupProposalCard {
  readonly id: string;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly target: string;
  readonly lines: readonly { readonly kind: 'same' | 'add' | 'remove'; readonly text: string }[];
  /** The stored body parsed back, for the approval's finish; null when it did not parse. */
  readonly body: SetupProposal | null;
  readonly decided: 'approved' | 'rejected' | null;
}

/** The optimistic user bubble while a send runs (the first message's carries its own rendering). */
export interface SetupPendingMessage {
  readonly text: string;
  readonly first: boolean;
}

export interface SetupChatState {
  /** The screen stands in the main panel; hiding it leaves the conversation running. */
  readonly visible: boolean;
  /** The folder field's text (the empty start's one input). */
  readonly repoPath: string;
  /** A start or a send is in flight. */
  readonly sending: boolean;
  readonly conversation: string | null;
  /** The path the standing conversation was started for — the head's mono line, the first bubble. */
  readonly conversationPath: string | null;
  readonly messages: readonly SetupThreadMessage[];
  readonly pending: SetupPendingMessage | null;
  readonly turn: string | null;
  readonly streamed: string;
  readonly thinking: string;
  readonly steps: readonly ChatStepRow[];
  readonly stepsOpen: boolean;
  /** The runner's notice code of the last turn, or null. */
  readonly notice: string | null;
  /** The failure sentence of the last refused command (U-115's shape), or null. */
  readonly note: LabelKey | null;
  readonly draft: string;
  readonly permission: SetupPermissionPrompt | null;
  readonly permissionRepoLabel: string | null;
  readonly deniedPaths: readonly string[];
  readonly secretNotices: number;
  readonly proposal: SetupProposalCard | null;
  readonly done: NewProjectDone | null;
}

export interface SetupChatStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly changes?: SetupChangeSignal;
  readonly reloadTree?: () => Promise<void>;
}

export interface SetupChatStore {
  state(): SetupChatState;
  subscribe(listener: () => void): () => void;
  /** Opens the screen: the standing conversation (or the draft's, re-registered) or the empty start. */
  show(): Promise<void>;
  /** The screen leaves the main panel; the conversation and its events keep standing. */
  hide(): void;
  setRepoPath(path: string): void;
  /** The empty start's primary: setup.ai.start with the trimmed path, then the first message. */
  start(firstMessage: string): Promise<void>;
  setDraft(text: string): void;
  send(): Promise<void>;
  /** U-105's Durdur while a turn runs: chat.cancel on the setup conversation. */
  cancel(): Promise<void>;
  /** Opens or closes the finished turn's step fold (U-380). */
  toggleSteps(): void;
  dismissNote(): void;
  clearNotice(): void;
  denyPermission(): void;
  allowPermission(): void;
  /** The proposal card's Reddet and Onayla (A-360): proposal.decide on the pending row. */
  decideProposal(decision: 'approved' | 'rejected'): Promise<void>;
  /** Yeniden dene on a failed diff read. */
  retryProposal(): void;
  /** After the done handoff: the setup is over and the screen returns to the empty start. */
  finish(): void;
}

const START: SetupChatState = {
  visible: false,
  repoPath: '',
  sending: false,
  conversation: null,
  conversationPath: null,
  messages: [],
  pending: null,
  turn: null,
  streamed: '',
  thinking: '',
  steps: [],
  stepsOpen: false,
  notice: null,
  note: null,
  draft: '',
  permission: null,
  permissionRepoLabel: null,
  deniedPaths: [],
  secretNotices: 0,
  proposal: null,
  done: null,
};

export const createSetupChatStore = (deps: SetupChatStoreDeps): SetupChatStore => {
  const { api, actor } = deps;
  let state: SetupChatState = START;
  const listeners = new Set<() => void>();
  // Only the newest conversation read may land; the setup never re-reads in parallel otherwise.
  let conversationSeq = 0;
  // The finished setup: the draft store keeps its row, so a later open starts over instead of
  // re-registering a conversation whose proposal was already approved.
  let settled = false;
  let secretsSeen = 0;
  let deniedPaths: ReadonlySet<string> = new Set<string>();

  const set = (patch: Partial<SetupChatState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const run = (command: Command): Promise<CommandResult> => api.command(actor, command);

  // --- reads ---------------------------------------------------------------------------------------------

  /** Re-reads the standing conversation; a slow reply of an older conversation never lands. */
  const reloadThread = async (): Promise<void> => {
    const conversation = state.conversation;
    if (conversation === null) return;
    conversationSeq += 1;
    const seq = conversationSeq;
    const reply = await api.query({ type: 'chat.conversation', id: conversation });
    if (seq !== conversationSeq || state.conversation !== conversation) return;
    set({ messages: threadOf(reply) });
  };

  /** The pending read of the setup surface (U-272, U-275, U-277), unchanged from the panel. */
  const refreshPending = async (): Promise<void> => {
    const conversation = state.conversation;
    if (conversation === null) return;
    const pending = pendingOf(await api.query({ type: 'setup.read.pending', conversation }));
    if (pending === null) return;
    if (pending.secrets > secretsSeen) {
      const fresh = pending.secrets - secretsSeen;
      secretsSeen = pending.secrets;
      set({ secretNotices: state.secretNotices + fresh });
    }
    if (pending.ask !== null && canShowPermission(state.permission, deniedPaths, pending.ask.path)) {
      set({
        permission: pending.ask,
        permissionRepoLabel: folderName(state.conversationPath ?? state.repoPath) || null,
      });
    }
  };

  /** Reads the pending project_setup proposal's detail for the card (A-360). */
  const readProposal = async (id: string): Promise<void> => {
    set({ proposal: { id, status: 'loading', target: '', lines: [], body: null, decided: null } });
    const reply = await api.query({ type: 'proposal.detail', id });
    if (isQueryFailure(reply) || typeof reply !== 'object' || reply === null) {
      if (state.proposal?.id === id) set({ proposal: { id, status: 'failed', target: '', lines: [], body: null, decided: null } });
      return;
    }
    const detail = reply as { readonly target?: unknown; readonly lines?: SetupProposalCard['lines']; readonly after?: unknown };
    set({
      proposal: {
        id,
        status: 'ready',
        target: typeof detail.target === 'string' ? detail.target : '',
        lines: Array.isArray(detail.lines) ? detail.lines : [],
        body: setupProposalOf(String(detail.after ?? '')),
        decided: null,
      },
    });
  };

  /** The newest pending project_setup row the agent made becomes the card (A-360). */
  const pollProposal = async (): Promise<void> => {
    const row = setupProposalRowOf(await api.query({ type: 'proposals.list', status: 'pending' }));
    if (row === null || state.proposal?.id === row.id) return;
    await readProposal(row.id);
  };

  // --- events --------------------------------------------------------------------------------------------

  deps.changes?.((change) => {
    if (
      change.type !== 'chat.turn' && change.type !== 'chat.delta' && change.type !== 'chat.thinking' &&
      change.type !== 'chat.step' && change.type !== 'chat.notice' && change.type !== 'setup.read.ask'
    ) {
      return;
    }
    // Events of another conversation — the dock's own included — never touch this one.
    if (state.conversation === null || change.conversation !== state.conversation) return;
    if (change.type === 'setup.read.ask') {
      void refreshPending();
      return;
    }
    if (change.type === 'chat.notice') {
      set({ notice: change.code });
      return;
    }
    if (change.type === 'chat.delta') {
      set({ turn: state.turn ?? change.turn, streamed: state.streamed + change.text });
      return;
    }
    if (change.type === 'chat.thinking') {
      if (state.turn === null || change.turn !== state.turn) return;
      set({ thinking: appendThinking(state.thinking, change.text) });
      return;
    }
    if (change.type === 'chat.step') {
      if (state.turn === null || change.turn !== state.turn) return;
      set({ steps: stepRowsAfter(state.steps, change) });
      return;
    }
    if (change.phase === 'started') {
      set({ turn: change.turn, streamed: '', thinking: '', steps: [], stepsOpen: false });
      return;
    }
    // chat.turn finished: whatever the outcome the thinking goes and the rows fold closed (U-380);
    // the stored messages then stand where the streamed text was.
    const conversation = state.conversation;
    set({ turn: null, sending: false, thinking: '', stepsOpen: false });
    void (async () => {
      await reloadThread();
      if (state.conversation === conversation) set({ streamed: '' });
      await refreshPending();
      await pollProposal();
    })();
  });

  // --- sending -------------------------------------------------------------------------------------------

  const sendText = async (text: string, first: boolean): Promise<void> => {
    const conversation = state.conversation;
    if (conversation === null || text.trim() === '') return;
    set({ pending: { text: text.trim(), first }, ...(first ? {} : { draft: '' }), note: null });
    const result = await run({ type: 'chat.send', conversation, text: text.trim() });
    if (!result.ok) {
      set({ pending: null, ...(first ? {} : { draft: text }), note: chatFailureKey(result.code) });
      return;
    }
    set({ pending: null, sending: false });
    await reloadThread();
  };

  /** setup.ai.start with the trimmed path (A-357); the first message rides chat.send after it. */
  const start = async (firstMessage: string): Promise<void> => {
    if (state.sending || state.conversation !== null) return;
    const repoPath = state.repoPath.trim();
    if (repoPath === '' || firstMessage.trim() === '') return;
    set({ sending: true, note: null });
    const result = await run({ type: 'setup.ai.start', repoPath });
    if (!result.ok || result.conversation === undefined) {
      set({ sending: false, note: result.ok ? 'error.unknown' : setupAiFailureKey(result.code) });
      return;
    }
    set({
      conversation: result.conversation,
      conversationPath: repoPath,
      messages: [],
      streamed: '',
      thinking: '',
      steps: [],
      stepsOpen: false,
    });
    await sendText(firstMessage, true);
  };

  const store: SetupChatStore = {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    show: async () => {
      set({ visible: true });
      if (state.conversation !== null) {
        await reloadThread();
        await refreshPending();
        await pollProposal();
        return;
      }
      if (settled) return;
      // The standing setup draft (A-359) decides: re-registered (A-357) or the empty start.
      const draft = resumableOf(await api.query({ type: 'setup.draft' }));
      if (draft === null) return;
      const resume: ResumableDraft = draft;
      set({ repoPath: resume.repoPath, sending: true, note: null });
      const result = await run({ type: 'setup.ai.start', repoPath: resume.repoPath.trim(), draft: resume.id });
      if (!result.ok || result.conversation === undefined) {
        set({ sending: false, note: result.ok ? 'error.unknown' : setupAiFailureKey(result.code) });
        return;
      }
      set({ sending: false, conversation: result.conversation, conversationPath: resume.repoPath.trim() });
      await reloadThread();
      await refreshPending();
      await pollProposal();
    },
    hide: () => set({ visible: false }),
    setRepoPath: (path) => set({ repoPath: path }),
    start,
    setDraft: (text) => set({ draft: text }),
    send: async () => {
      const text = state.draft.trim();
      if (state.conversation === null || text === '' || chatBusy(state) || state.pending !== null) return;
      set({ sending: true });
      await sendText(text, false);
      set({ sending: false });
    },
    cancel: async () => {
      const conversation = state.conversation;
      if (conversation === null || state.turn === null) return;
      const result = await run({ type: 'chat.cancel', conversation });
      if (!result.ok) set({ note: chatFailureKey(result.code) });
    },
    toggleSteps: () => set({ stepsOpen: !state.stepsOpen }),
    dismissNote: () => set({ note: null }),
    clearNotice: () => set({ notice: null }),

    denyPermission: () => {
      const prompt = state.permission;
      if (prompt === null) return;
      deniedPaths = permissionAfterDeny(deniedPaths, prompt.path);
      const answered = state.conversation;
      set({ permission: null, deniedPaths: [...deniedPaths] });
      if (answered !== null) void run({ type: 'setup.read.answer', conversation: answered, path: prompt.path, allow: false });
    },
    allowPermission: () => {
      const prompt = state.permission;
      if (prompt === null) return;
      const answered = state.conversation;
      set({ permission: null });
      if (answered !== null) void run({ type: 'setup.read.answer', conversation: answered, path: prompt.path, allow: true });
    },

    decideProposal: async (decision) => {
      const proposal = state.proposal;
      if (proposal === null || proposal.decided !== null || proposal.status !== 'ready' || state.sending) return;
      const result = await run({ type: 'proposal.decide', id: proposal.id, decision });
      if (!result.ok) {
        set({ note: commandResultKey('proposal.decide', result) });
        return;
      }
      if (decision === 'rejected') {
        // Rejection writes nothing and keeps the draft (A-360): the thread stands open.
        set({ proposal: { ...proposal, decided: 'rejected' } });
        return;
      }
      set({ proposal: { ...proposal, decided: 'approved' } });
      const body = proposal.body;
      if (body === null) return;
      await deps.reloadTree?.();
      const tree: unknown = await api.query({ type: 'project.tree' });
      set({ done: { target: targetOf(tree, slugOf(body.project.name)), toastKey: 'newProject.created' } });
    },
    retryProposal: () => {
      const proposal = state.proposal;
      if (proposal === null || proposal.status !== 'failed') return;
      void readProposal(proposal.id);
    },
    finish: () => {
      settled = true;
      secretsSeen = 0;
      deniedPaths = new Set();
      conversationSeq += 1;
      state = { ...START };
      for (const listener of [...listeners]) listener();
    },
  };

  return store;
};
