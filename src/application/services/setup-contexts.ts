// setup-contexts.ts — the registry of live Docket AI setup conversations (A-356 … A-358): one
// context per conversation id — the read scope, the session grants, the pending ask, the denied
// paths, the secret count and the draft id — built by the composition root and read by the tool
// dispatch (setupContextOf), the chat runner (the setup token kind, the draft after each operator
// message) and the api's setup surface. Memory only: a grant never survives the app (A-335) and
// nothing here is audited — an audit row would be a grant written to disk.
import type { ConversationId } from '../../domain/index';

import type { AppDeps } from '../ports';
import type { SetupDraft, SetupDraftStore } from '../use-cases/setup';

import { normalizeAbsolutePath, SetupReadGrants, type ReadContext, type ReadScope } from './setup-permissions';
import type { SetupPathReader, SetupToolsContext } from './setup-tools';

/** One pending read ask (U-272): the resolved path and the agent's reason line. */
export interface SetupAsk {
  readonly path: string;
  readonly reason: string;
}

/** A registered conversation's state: the tool-facing context (scope, grants, reader, draft id)
 *  plus the ask bookkeeping the operator surface reads. */
export interface SetupConversationContext extends SetupToolsContext {
  readonly conversation: ConversationId;
  readonly repoPath: string;
  /** Always set: `register` mints one when the caller (the resume path) does not bring its own. */
  readonly draftId: string;
  ask: SetupAsk | null;
  /** The paths the operator denied this conversation (U-276) — session only, like the grants. */
  readonly denied: Set<string>;
  /** How many secret-shaped refusals the conversation has served (U-277). */
  secrets: number;
}

export interface SetupConversations {
  /** Registers a setup conversation: a fresh read scope, fresh grants and a draft id (A-334, A-335). */
  register(input: { readonly conversation: ConversationId; readonly repoPath: string; readonly draftId?: string }): SetupConversationContext;
  /** The context the tool dispatch and the runner read; undefined for a non-setup conversation. */
  contextOf(conversation: ConversationId): SetupConversationContext | undefined;
  /** The pending ask (one at a time, U-275); undefined when none or no such conversation. */
  askOf(conversation: ConversationId): SetupAsk | undefined;
  /** The operator's answer: allow records the session grant (A-335), deny the denied path
   *  (U-276); the matching pending ask clears. False = no such conversation. */
  answer(conversation: ConversationId, path: string, allow: boolean): boolean;
  /** The runner's hook after an operator message appended: persists the draft (A-340, A-358). */
  noteOperatorMessage(conversation: ConversationId): void;
  /** One coarse push per recorded ask (A-357): the api's channel carries the conversation id only. */
  subscribeAsk(listener: (conversation: ConversationId) => void): () => void;
  /** The newest stored draft, for the resume card (A-340). */
  newestDraft(): Promise<SetupDraft | undefined>;
  /** One stored draft by id — the resume path of `setup.ai.start` reads it. */
  draftOf(id: string): Promise<SetupDraft | undefined>;
}

export interface SetupContextsConfig {
  /** The app's own data dir — the second root of the read scope (A-334). */
  readonly dataDir: string;
  readonly drafts: SetupDraftStore;
  readonly reader: SetupPathReader;
}

export function createSetupContexts(
  deps: Pick<AppDeps, 'clock' | 'ids'>,
  config: SetupContextsConfig,
): SetupConversations {
  const byId = new Map<ConversationId, SetupConversationContext>();
  const askListeners = new Set<(conversation: ConversationId) => void>();
  const dataDir = normalizeAbsolutePath(config.dataDir);

  const emitAsk = (conversation: ConversationId): void => {
    for (const listener of askListeners) {
      try {
        listener(conversation);
      } catch {
        // A broken listener never breaks the tool call that recorded the ask.
      }
    }
  };

  const saveDraft = (context: SetupConversationContext): void => {
    // Fire-and-forget by design: a failing draft save never breaks the operator's message.
    void config.drafts
      .save({
        id: context.draftId,
        repoPath: context.repoPath,
        mode: 'ai',
        answers: { conversation: context.conversation },
        updatedAt: deps.clock.now(),
      })
      .catch(() => undefined);
  };

  return {
    register: ({ conversation, repoPath, draftId }) => {
      const folder = normalizeAbsolutePath(repoPath);
      const scope: ReadScope = { paths: [folder, dataDir], sessionOnly: true };
      const readCtx: ReadContext = { repoFolder: folder, docketHome: dataDir };
      const context: SetupConversationContext = {
        conversation,
        repoPath: folder,
        scope,
        readCtx,
        grants: new SetupReadGrants(),
        reader: config.reader,
        draftId: draftId ?? deps.ids.next<'draft'>(),
        ask: null,
        denied: new Set<string>(),
        secrets: 0,
        noteAsk: (path, reason): void => {
          context.ask = { path, reason };
          emitAsk(conversation);
        },
        isDenied: (path): boolean => context.denied.has(normalizeAbsolutePath(path)),
        noteSecret: (): void => {
          context.secrets += 1;
        },
      };
      byId.set(conversation, context);
      return context;
    },
    contextOf: (conversation) => byId.get(conversation),
    askOf: (conversation) => byId.get(conversation)?.ask ?? undefined,
    answer: (conversation, path, allow) => {
      const context = byId.get(conversation);
      if (context === undefined) return false;
      const normalized = normalizeAbsolutePath(path);
      if (allow) context.grants.grant(normalized);
      else context.denied.add(normalized);
      if (context.ask !== null && context.ask.path === normalized) context.ask = null;
      return true;
    },
    noteOperatorMessage: (conversation) => {
      const context = byId.get(conversation);
      if (context !== undefined) saveDraft(context);
    },
    subscribeAsk: (listener) => {
      askListeners.add(listener);
      return () => askListeners.delete(listener);
    },
    newestDraft: async () => config.drafts.newest?.() ?? undefined,
    draftOf: async (id) => config.drafts.load(id),
  };
}
