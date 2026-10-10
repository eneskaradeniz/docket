// stores/chat-kit.ts — the chat tests' shared support: view builders with sensible defaults and a
// scripted bridge that records every command and query and lets a test push api events. It is
// test support only (nothing in the app imports it) and carries no behaviour of its own.
import type { Command, CommandResult } from '../../api/commands';
import type {
  ChatActionView,
  ChatConversationSummaryView,
  ChatConversationView,
  ChatDraftView,
  ChatGrantView,
  ChatMessageView,
} from '../../api/chat-views';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { ChatChange, ChatToast } from './chat-store';

export const ACTOR: Actor = { kind: 'user', id: 'user-1' };

export const message = (id: string, patch: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id,
  role: 'assistant',
  at: 1_000,
  text: `text ${id}`,
  refs: [],
  attachments: [],
  artifacts: [],
  sources: [],
  ...patch,
});

export const conversation = (id: string, patch: Partial<ChatConversationView> = {}): ChatConversationView => ({
  id,
  title: `title ${id}`,
  scope: { kind: 'global' },
  pinned: false,
  messages: [],
  drafts: [],
  actions: [],
  grants: [],
  ...patch,
});

export const summary = (id: string, patch: Partial<ChatConversationSummaryView> = {}): ChatConversationSummaryView => ({
  id,
  title: `title ${id}`,
  scope: { kind: 'global' },
  pinned: false,
  updatedAt: 1_000,
  lastText: '',
  messageCount: 2,
  activeTurn: false,
  ...patch,
});

export const action = (id: string, patch: Partial<ChatActionView> = {}): ChatActionView => ({
  id,
  class: 'open_work_order',
  status: 'applied',
  undoable: false,
  undoExpiresAt: null,
  authority: 'user',
  failure: null,
  ...patch,
});

export const grant = (id: string, expiresAt: number, classes: readonly string[] = ['open_work_order']): ChatGrantView => ({
  id,
  classes,
  expiresAt,
  applicationsLeft: 25,
});

export const draft = (id: string, patch: Partial<ChatDraftView> = {}): ChatDraftView => ({
  id,
  project: 'antero',
  repo: 'antero-api',
  title: `draft ${id}`,
  task: null,
  status: 'draft',
  workOrder: null,
  ...patch,
});

type QueryReply = unknown | Promise<unknown>;

export interface Bridge {
  readonly api: {
    readonly query: (query: Query) => Promise<unknown>;
    readonly command: (actor: Actor, command: Command) => Promise<CommandResult>;
  };
  readonly changes: (listener: (change: ChatChange) => void) => () => void;
  readonly commands: Command[];
  readonly queries: Query[];
  readonly toasts: ChatToast[];
  readonly notify: (toast: ChatToast) => void;
  /** Pushes one api event to every listener. */
  readonly emit: (change: ChatChange) => void;
  /** Replaces how a query type is answered. */
  onQuery(type: Query['type'], reply: (query: Query) => QueryReply): void;
  onCommand(type: Command['type'], reply: (command: Command) => CommandResult | Promise<CommandResult>): void;
}

/** A scripted bridge: every query answers an empty reply and every command `{ ok: true }` until a
 *  test says otherwise. */
export const bridge = (): Bridge => {
  const queryReplies = new Map<string, (query: Query) => QueryReply>();
  const commandReplies = new Map<string, (command: Command) => CommandResult | Promise<CommandResult>>();
  const listeners = new Set<(change: ChatChange) => void>();
  const commands: Command[] = [];
  const queries: Query[] = [];
  const toasts: ChatToast[] = [];
  return {
    api: {
      query: async (query) => {
        queries.push(query);
        const reply = queryReplies.get(query.type);
        return reply === undefined ? [] : reply(query);
      },
      command: async (_actor, command) => {
        commands.push(command);
        const reply = commandReplies.get(command.type);
        return reply === undefined ? { ok: true } : reply(command);
      },
    },
    changes: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    commands,
    queries,
    toasts,
    notify: (toast) => {
      toasts.push(toast);
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
    onQuery: (type, reply) => {
      queryReplies.set(type, reply);
    },
    onCommand: (type, reply) => {
      commandReplies.set(type, reply);
    },
  };
};

/** Lets every pending promise continuation run. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
