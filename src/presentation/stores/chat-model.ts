// stores/chat-model.ts — the Docket AI chat's pure rules and its state shape (U-101 … U-125): the
// place a route gives the panel, the history's day groups, the @ trigger, the attachment verdicts,
// the notice mapping, the undo window and the grant countdown, plus the selectors the components
// read. Nothing here touches the api or the clock; the store feeds these functions what they need.
// Every text that reaches a person is a label key — message text, titles and labels are carried
// as data and only ever rendered as React text nodes.
import type {
  ChatActionView,
  ChatConversationSummaryView,
  ChatConversationView,
  ChatGrantView,
  ChatRefView,
  ChatReferenceView,
  ChatUsageView,
} from '../../api/chat-views';
import type { ChatRefInput, ChatScopeInput } from '../../api/commands';
import type { ProjectTree } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import type { NavRoute } from './nav-history';

export type { ChatScopeInput, ChatRefInput };

/** The api's push events the chat store reads; every other store ignores the chat members (U-97). */
export type ChatChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' }
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string };

/** A toast the store asks the host to show: the host owns the locale and the one toast service. */
export interface ChatToast {
  readonly type: 'success' | 'info' | 'error';
  readonly key: LabelKey;
  readonly values?: Readonly<Record<string, string>>;
}

// --- scope and place -----------------------------------------------------------------------------------

export const sameScope = (a: ChatScopeInput, b: ChatScopeInput): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') return a.project === b.project;
  if (a.kind === 'workOrder' && b.kind === 'workOrder') return a.workOrder === b.workOrder;
  return true;
};

/** One reference chip: what the operator added with @, the + menu or "Bu ekranı ekle". */
export interface RefChip {
  readonly key: string;
  readonly kind: 'workOrder' | 'page' | 'project' | 'repo' | 'file';
  readonly input: ChatRefInput;
  readonly label: string;
  /** The dim "<project>/" lead of the prototype's chip. */
  readonly prefix?: string;
}

/** A scope the panel can take on the screen the operator is on; `label` is empty when the screen
 *  has not told its name yet (the chip then reads the generic one). */
export interface ScopeChoice {
  readonly scope: ChatScopeInput;
  readonly label: string;
}

/** What the current screen gives the panel: scopes from the broadest to the screen's own (the last
 *  one is what "follow" means) and the structured reference "Bu ekranı ekle" attaches. */
export interface ChatPlace {
  readonly choices: readonly ScopeChoice[];
  readonly screen: RefChip | null;
}

export const GLOBAL_PLACE: ChatPlace = { choices: [{ scope: { kind: 'global' }, label: '' }], screen: null };

/** The scope the screen itself stands for. */
export const placeScope = (place: ChatPlace): ChatScopeInput => place.choices[place.choices.length - 1]?.scope ?? { kind: 'global' };

export interface PlaceInput {
  readonly route: NavRoute;
  readonly tree: ProjectTree;
  /** The loaded work order when the route is its detail, else null. */
  readonly workOrder: { readonly id: string; readonly repo: string; readonly number: number; readonly title: string } | null;
  readonly code: (number: number) => string;
  /** The title of the page the route shows, when it is loaded. */
  readonly pageTitle?: string | null;
}

const projectOfRepo = (tree: ProjectTree, repo: string): { readonly project: string; readonly name: string } | null => {
  const owner = tree.find((item) => item.repos.some((node) => node.repo === repo));
  return owner === undefined ? null : { project: owner.project, name: owner.name };
};

const GLOBAL_CHOICE: ScopeChoice = { scope: { kind: 'global' }, label: '' };

/** The place a route gives the panel (U-122): global alone for the screens with no project, the
 *  project for a roadmap or a board, the project and the work order for a detail. */
export const chatPlaceOf = (input: PlaceInput): ChatPlace => {
  const { route, tree, workOrder, code } = input;
  switch (route.name) {
    case 'roadmap': {
      const name = tree.find((item) => item.project === route.project)?.name ?? '';
      return {
        choices: [GLOBAL_CHOICE, { scope: { kind: 'project', project: route.project }, label: name }],
        screen: { key: `project:${route.project}`, kind: 'project', input: { kind: 'project', id: route.project }, label: name },
      };
    }
    case 'board': {
      const owner = projectOfRepo(tree, route.repo);
      return {
        choices: owner === null ? [GLOBAL_CHOICE] : [GLOBAL_CHOICE, { scope: { kind: 'project', project: owner.project }, label: owner.name }],
        screen: { key: `repo:${route.repo}`, kind: 'repo', input: { kind: 'repo', id: route.repo }, label: route.repo },
      };
    }
    case 'workOrder': {
      const known = workOrder !== null && workOrder.id === route.id ? workOrder : null;
      const owner = known === null ? null : projectOfRepo(tree, known.repo);
      const label = known === null ? '' : `${code(known.number)} · ${known.title}`;
      return {
        choices: [
          GLOBAL_CHOICE,
          ...(owner === null ? [] : [{ scope: { kind: 'project', project: owner.project } as const, label: owner.name }]),
          { scope: { kind: 'workOrder', workOrder: route.id }, label },
        ],
        screen: { key: `workOrder:${route.id}`, kind: 'workOrder', input: { kind: 'workOrder', id: route.id }, label: known === null ? '' : code(known.number) },
      };
    }
    case 'page':
      return {
        choices: [GLOBAL_CHOICE],
        screen: { key: `page:${route.id}`, kind: 'page', input: { kind: 'page', id: route.id }, label: input.pageTitle ?? '' },
      };
    default:
      return { choices: [GLOBAL_CHOICE], screen: null };
  }
};

// --- references ----------------------------------------------------------------------------------------

const REFERENCE_KIND: Readonly<Record<ChatReferenceView['kind'], RefChip['kind']>> = {
  work_order: 'workOrder',
  page: 'page',
  project: 'project',
  repo: 'repo',
};

export const refKeyOf = (kind: string, id: string): string => `${kind}:${id}`;

/** An @ result as a chip; the project slug is the dim lead for everything but a project itself. */
export const chipOfReference = (reference: ChatReferenceView): RefChip => {
  const kind = REFERENCE_KIND[reference.kind];
  return {
    key: refKeyOf(kind, reference.id),
    kind,
    input: { kind: kind === 'file' ? 'repo' : kind, id: reference.id } as ChatRefInput,
    label: reference.label,
    ...(reference.project === undefined || kind === 'project' ? {} : { prefix: reference.project }),
  };
};

/** A reference of a sent message, for its read-only chip. */
export const chipOfSentRef = (ref: ChatRefView): { readonly key: string; readonly label: string; readonly prefix?: string } => ({
  key: refKeyOf(ref.kind, ref.id),
  label: ref.label,
  ...(ref.project !== undefined ? { prefix: ref.project } : ref.repo !== undefined ? { prefix: ref.repo } : {}),
});

const AT_TOKEN = /(?:^|\s)@(\S*)$/;

/** The text after a trailing @ that starts a word, or null when the text ends in no such token. */
export const atQueryOf = (text: string): string | null => AT_TOKEN.exec(text)?.[1] ?? null;

/** The text with its trailing @ token (and the whitespace before it) removed. */
export const stripAtToken = (text: string): string => text.replace(/(?:^|\s+)@\S*$/, '');

// --- history groups ------------------------------------------------------------------------------------

export type ConversationGroup = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

export interface ConversationGroupRows {
  readonly group: ConversationGroup;
  readonly items: readonly ChatConversationSummaryView[];
}

const GROUP_ORDER: readonly ConversationGroup[] = ['pinned', 'today', 'yesterday', 'week', 'older'];

/** The history list in its groups (U-107): pinned first, then by the local calendar day of
 *  `updatedAt` — today, yesterday, the last six days before that, older — newest first inside each;
 *  an empty group is absent. */
export const groupConversations = (list: readonly ChatConversationSummaryView[], now: number): readonly ConversationGroupRows[] => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const yesterday = new Date(start);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(start);
  weekStart.setDate(weekStart.getDate() - 6);
  const groupOf = (entry: ChatConversationSummaryView): ConversationGroup =>
    entry.pinned
      ? 'pinned'
      : entry.updatedAt >= today
        ? 'today'
        : entry.updatedAt >= yesterday.getTime()
          ? 'yesterday'
          : entry.updatedAt >= weekStart.getTime()
            ? 'week'
            : 'older';
  const buckets = new Map<ConversationGroup, ChatConversationSummaryView[]>();
  for (const entry of list) {
    const group = groupOf(entry);
    buckets.set(group, [...(buckets.get(group) ?? []), entry]);
  }
  return GROUP_ORDER.flatMap((group) => {
    const items = buckets.get(group);
    return items === undefined ? [] : [{ group, items: [...items].sort((a, b) => b.updatedAt - a.updatedAt) }];
  });
};

// --- attachments ---------------------------------------------------------------------------------------

export const FILE_LIMIT = 5;
/** The api's own size cap for one file; a bigger one is refused before it is read into memory. */
export const FILE_MAX_BYTES = 5_000_000;
export const REF_LIMIT = 12;

const VIDEO = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp']);
const ACCEPTED = new Set([...IMAGE, 'md', 'txt', 'log', 'csv', 'json', 'pdf']);

export const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export type FileVerdict =
  | { readonly kind: 'video' }
  | { readonly kind: 'type' }
  | { readonly kind: 'limit' }
  | { readonly kind: 'ok'; readonly ext: string; readonly image: boolean };

/** The prototype's order of refusals: a video first, then an unlisted type, then the sixth file. */
export const fileVerdict = (name: string, count: number): FileVerdict => {
  const ext = extOf(name);
  if (VIDEO.has(ext)) return { kind: 'video' };
  if (!ACCEPTED.has(ext)) return { kind: 'type' };
  if (count >= FILE_LIMIT) return { kind: 'limit' };
  return { kind: 'ok', ext, image: IMAGE.has(ext) };
};

export type TrayKind = 'image' | 'text' | 'pdf';

export const trayKindOf = (ext: string): TrayKind => (IMAGE.has(ext) ? 'image' : ext === 'pdf' ? 'pdf' : 'text');

export interface TrayItem {
  readonly id: string;
  readonly name: string;
  readonly kind: TrayKind;
}

// --- notices and failure sentences --------------------------------------------------------------------

export type NoticeKind = 'quota' | 'spend' | 'consent' | 'auth' | 'limit' | 'network' | 'crash' | 'tools_unavailable';

export interface NoticeInfo {
  readonly kind: NoticeKind;
  /** The input stays disabled until the operator acts (quota, spend, consent). */
  readonly blocks: boolean;
  /** The button the note carries: Hesabı değiştir opens the accounts, İzin ver the consent step. */
  readonly action: 'accounts' | 'consent' | null;
}

const NOTICES: Readonly<Record<NoticeKind, NoticeInfo>> = {
  quota: { kind: 'quota', blocks: true, action: 'accounts' },
  spend: { kind: 'spend', blocks: true, action: 'consent' },
  consent: { kind: 'consent', blocks: true, action: 'consent' },
  auth: { kind: 'auth', blocks: false, action: null },
  limit: { kind: 'limit', blocks: false, action: null },
  network: { kind: 'network', blocks: false, action: null },
  crash: { kind: 'crash', blocks: false, action: null },
  tools_unavailable: { kind: 'tools_unavailable', blocks: false, action: null },
};

/** A runner notice code as the note it shows; a code this build does not know reads as a crash. */
export const noticeOf = (code: string): NoticeInfo => (code in NOTICES ? NOTICES[code as NoticeKind] : NOTICES.crash);

const CHAT_FAILURES: readonly string[] = [
  'empty_message',
  'message_too_long',
  'message_too_large',
  'bad_scope',
  'bad_ref',
  'too_many_refs',
  'too_many_attachments',
  'attachments_too_large',
  'attachment_too_large',
  'bad_attachment',
  'bad_base64',
  'bad_input',
  'busy',
  'too_many_turns',
  'not_found',
  'not_pending',
  'not_applied',
  'undo_expired',
  'rate_limited',
  'grant_empty',
  'grant_too_long',
  'grant_expired',
  'grant_revoked',
  'bad_class',
  'conversation_full',
];

/** The failure sentence for a chat command's code (U-115); a code the UI does not know reads as the
 *  generic line, never as the raw code. */
export const chatFailureKey = (code: string): LabelKey => (CHAT_FAILURES.includes(code) ? (`chat.error.${code}` as LabelKey) : 'error.unknown');

// --- time-bound things ---------------------------------------------------------------------------------

/** Whole minutes left until `expiresAt`, ceiling, never below zero. */
export const minutesLeft = (expiresAt: number, now: number): number => Math.max(0, Math.ceil((expiresAt - now) / 60_000));

/** Geri al shows only for an applied, undoable action before its expiry (U-112). */
export const undoOpen = (action: ChatActionView, now: number): boolean =>
  action.status === 'applied' && action.undoable && (action.undoExpiresAt === null || now < action.undoExpiresAt);

// --- the shortcut --------------------------------------------------------------------------------------

export interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** ⌘J / Ctrl+J, nothing else (U-119). */
export const isChatShortcut = (event: KeyLike): boolean =>
  event.key.toLowerCase() === 'j' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

/** What the shortcut does given who owns the screen: a blocking modal (the settings panel, the
 *  wizard) swallows it; an open search palette is closed first, so the two never stand together. */
export const chatShortcutPlan = (input: {
  readonly paletteOpen: boolean;
  readonly modalOpen: boolean;
  readonly chatOpen: boolean;
}): 'toggle' | 'closePaletteAndOpen' | 'ignore' => {
  if (input.modalOpen) return 'ignore';
  return input.paletteOpen ? 'closePaletteAndOpen' : 'toggle';
};

// --- suggestions ---------------------------------------------------------------------------------------

export const suggestionKeysOf = (kind: ChatScopeInput['kind']): readonly [LabelKey, LabelKey] =>
  kind === 'global'
    ? ['chat.suggest.global.a', 'chat.suggest.global.b']
    : kind === 'project'
      ? ['chat.suggest.project.a', 'chat.suggest.project.b']
      : ['chat.suggest.workOrder.a', 'chat.suggest.workOrder.b'];

// --- state ---------------------------------------------------------------------------------------------

export interface ChatNote {
  readonly key: LabelKey;
  readonly values?: Readonly<Record<string, string>>;
}

export interface PendingMessage {
  readonly text: string;
  readonly refs: readonly RefChip[];
  readonly files: readonly TrayItem[];
}

export interface AtMenu {
  /** The text typed after the @. */
  readonly q: string;
  /** The server's answer as it came, minus what is already added. */
  readonly items: readonly ChatReferenceView[];
  readonly index: number;
  readonly loading: boolean;
}

export interface ProposalState {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly summary: string;
  readonly target: string;
  readonly lines: readonly { readonly kind: 'same' | 'add' | 'remove'; readonly text: string }[];
}

export interface HistoryState {
  readonly items: readonly ChatConversationSummaryView[];
  readonly search: string;
  readonly loaded: boolean;
  readonly failed: boolean;
}

export interface ChatState {
  readonly open: boolean;
  readonly view: 'chat' | 'history';
  readonly conversation: string | null;
  readonly detail: ChatConversationView | null;
  readonly place: ChatPlace;
  readonly scope: ChatScopeInput;
  /** The scope was chosen by hand and is not the screen's own ("sabit"). */
  readonly pinned: boolean;
  readonly draft: string;
  readonly refs: readonly RefChip[];
  readonly tray: readonly TrayItem[];
  /** Uploads in flight; they count against the file limit. */
  readonly uploading: number;
  readonly pending: PendingMessage | null;
  /** A send is in flight (the command has not answered yet). */
  readonly sending: boolean;
  /** The live turn's id while one runs, mirrored from the api's busy. */
  readonly turn: string | null;
  readonly streamed: string;
  /** The runner's notice code of the last turn, or null. */
  readonly notice: string | null;
  readonly note: ChatNote | null;
  readonly menu: null | 'at' | 'plus';
  readonly at: AtMenu;
  readonly scopePop: boolean;
  readonly permOpen: boolean;
  readonly permDraft: readonly string[];
  readonly history: HistoryState;
  readonly usage: ChatUsageView | null;
  readonly proposals: Readonly<Record<string, ProposalState>>;
  readonly alert: boolean;
  readonly now: number;
  /** Bumped whenever the composer should take focus (opening, a prefill, a committed chip). */
  readonly focusTick: number;
}

export const chatBusy = (state: ChatState): boolean => state.turn !== null || state.sending;

/** Dots show from the send until the first streamed text (U-104). */
export const chatShowsDots = (state: ChatState): boolean => chatBusy(state) && state.streamed === '';

export const chatInputBlocked = (state: ChatState): boolean => state.notice !== null && noticeOf(state.notice).blocks;

/** The grant that is live now, or null. */
export const chatActiveGrant = (state: ChatState): ChatGrantView | null =>
  state.detail?.grants.find((grant) => grant.expiresAt > state.now) ?? null;

/** Minutes the tier button counts down from the grant's own expiry, or null while on "Öner". */
export const chatTierMinutes = (state: ChatState): number | null => {
  const grant = chatActiveGrant(state);
  return grant === null ? null : minutesLeft(grant.expiresAt, state.now);
};

/** Whether anything on screen depends on the clock, so the store must tick. */
export const chatNeedsTick = (detail: ChatConversationView | null, now: number): boolean =>
  detail !== null &&
  (detail.grants.some((grant) => grant.expiresAt > now) || detail.actions.some((entry) => entry.undoable && entry.undoExpiresAt !== null && entry.undoExpiresAt > now));
