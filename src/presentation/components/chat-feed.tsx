// components/chat-feed.tsx — the conversation body of the Docket AI panel (U-104, U-111, U-112,
// U-116, U-121): the empty state with its suggestions, the messages (read-only chips under a
// user's text, source pills under an assistant's), the artifact cards (page, table, draft,
// proposal), the action rows with Geri al, the streamed text and the dots. Every message text,
// title, source, diff line, table cell and page title is untrusted: it enters the DOM only as a
// React text node inside a `whitespace-pre-wrap` box, never as markup and never as a link.
import { useEffect, type ReactNode } from 'react';

import type { ChatActionView, ChatArtifactView, ChatConversationView, ChatMessageView } from '../../api/chat-views';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { chatShowsDots, chipOfSentRef, suggestionKeysOf, undoOpen, type ChatState, type TrayItem } from '../stores/chat-model';
import type { ChatStore } from '../stores/chat-store';
import { ChatIcon, refIcon } from './chat-icons';
import { BUTTON, BUTTON_GHOST, BUTTON_PRIMARY, FOCUS, REF_CHIP, SOURCE_CHIP, THUMB, fill } from './chat-style';

const WRAP = 'whitespace-pre-wrap [overflow-wrap:anywhere]';

const ACTION_APPLIED: Readonly<Record<string, LabelKey>> = {
  open_work_order: 'chat.action.open_work_order.applied',
  roadmap_edit: 'chat.action.roadmap_edit.applied',
  definition_edit: 'chat.action.definition_edit.applied',
  setting_change: 'chat.action.setting_change.applied',
};

type Sent = { readonly kind: string; readonly id: string; readonly label: string; readonly project?: string; readonly repo?: string };

/** A read-only reference chip of a sent message. */
function SentRef({ entry }: { readonly entry: Sent }) {
  const chip = chipOfSentRef(entry);
  const kind = entry.kind === 'workOrder' || entry.kind === 'page' || entry.kind === 'project' || entry.kind === 'repo' ? entry.kind : 'file';
  return (
    <span className={REF_CHIP}>
      <ChatIcon name={refIcon(kind)} className="h-3.5 w-3.5 flex-none text-inkdim" />
      {chip.prefix === undefined ? null : <span className="text-inkdim">{`${chip.prefix}/`}</span>}
      <span className="truncate">{chip.label}</span>
    </span>
  );
}

/** A file of a sent message: an image as its gradient thumbnail, anything else as a pill. */
function SentFile({ name, kind }: { readonly name: string; readonly kind: TrayItem['kind'] }) {
  if (kind === 'image') return <span className={`${THUMB} h-[3.375rem] w-[4.5rem]`}>{name}</span>;
  return (
    <span className={REF_CHIP}>
      <ChatIcon name="file" className="h-3.5 w-3.5 flex-none text-inkdim" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function UserRow({ text, refs, files }: { readonly text: string; readonly refs: readonly Sent[]; readonly files: readonly { readonly name: string; readonly kind: TrayItem['kind'] }[] }) {
  return (
    <div data-chat-row="user" className="grid justify-items-end gap-1">
      {refs.length > 0 || files.length > 0 ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
          {refs.map((entry) => (
            <SentRef key={`${entry.kind}:${entry.id}`} entry={entry} />
          ))}
          {files.map((file) => (
            <SentFile key={file.name} name={file.name} kind={file.kind} />
          ))}
        </div>
      ) : null}
      <div className={`${WRAP} max-w-[85%] rounded-panel bg-raised px-3 py-2 text-[0.875rem] leading-5 text-ink`}>{text}</div>
    </div>
  );
}

function Table({ columns, rows, label }: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly label: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-band">
      <table aria-label={label} className="w-full border-collapse text-[0.78125rem] leading-5">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} className="px-3 py-1 text-left font-medium text-inkdim">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={`border-t border-hairline px-3 py-1 text-left ${c === 0 ? '' : 'font-mono text-[0.6875rem] leading-5'} ${WRAP}`}>
                  {cell === '' ? '—' : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardHeader({ title, type, children }: { readonly title: string; readonly type?: string; readonly children?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-3 py-2">
      <span className="min-w-0 truncate text-[0.875rem] font-semibold leading-5 text-ink">{title}</span>
      <span className="flex-1" />
      {type === undefined || type === '' ? null : <span className="whitespace-nowrap font-mono text-[0.6875rem] font-medium leading-none text-inkdim">{type}</span>}
      {children}
    </div>
  );
}

function PageCard({ artifact, locale, onOpenPage }: { readonly artifact: Extract<ChatArtifactView, { kind: 'page' }>; readonly locale: Locale; readonly onOpenPage: (id: string) => void }) {
  const type = fill(t(locale, 'chat.card.page.type'), { kind: artifact.pageKind ?? '', n: artifact.version });
  return (
    <div data-chat-card="page" className="overflow-hidden rounded-card border border-hairline bg-band">
      <CardHeader title={artifact.title ?? t(locale, 'chat.card.gone')} type={type}>
        <button type="button" className={BUTTON} onClick={() => onOpenPage(artifact.id)}>
          {t(locale, 'chat.card.page.open')}
        </button>
      </CardHeader>
    </div>
  );
}

function DraftCard({ artifact, detail, store, locale }: { readonly artifact: Extract<ChatArtifactView, { kind: 'draft' }>; readonly detail: ChatConversationView; readonly store: ChatStore; readonly locale: Locale }) {
  const draft = detail.drafts.find((entry) => entry.id === artifact.id);
  const title = artifact.label ?? draft?.title ?? t(locale, 'chat.card.gone');
  return (
    <div data-chat-card="draft" className="overflow-hidden rounded-card border border-hairline bg-band">
      <CardHeader title={title} type={draft?.repo} />
      {draft === undefined ? null : (
        <div className="flex items-center justify-end gap-2 border-t border-hairline px-3 py-2">
          {draft.status === 'draft' ? (
            <>
              <button type="button" className={BUTTON_GHOST} onClick={() => void store.dropDraft(artifact.id)}>
                {t(locale, 'chat.card.draft.drop')}
              </button>
              <button type="button" className={BUTTON_PRIMARY} onClick={() => void store.confirmDraft(artifact.id)}>
                {t(locale, 'chat.card.draft.create')}
              </button>
            </>
          ) : (
            <span className={`font-mono text-[0.6875rem] font-medium leading-4 ${draft.status === 'confirmed' ? 'text-proceed' : 'text-inkdim'}`}>
              {t(locale, draft.status === 'confirmed' ? 'chat.card.draft.made' : 'chat.card.draft.dropped')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ artifact, state, store, locale }: { readonly artifact: Extract<ChatArtifactView, { kind: 'proposal' }>; readonly state: ChatState; readonly store: ChatStore; readonly locale: Locale }) {
  useEffect(() => {
    store.loadProposal(artifact.id);
  }, [store, artifact.id]);
  const proposal = state.proposals[artifact.id];
  const action = state.detail?.actions.find((entry) => entry.id === artifact.action);
  const target = proposal?.status === 'ready' ? proposal.target : '';
  return (
    <div data-chat-card="proposal" className="overflow-hidden rounded-card border border-hairline bg-band">
      <CardHeader title={artifact.label ?? t(locale, 'chat.card.gone')} type={target} />
      {proposal?.status === 'ready' ? (
        <div className="max-h-44 overflow-auto border-t border-hairline font-mono text-[0.75rem] leading-5">
          {proposal.lines.map((line, index) => (
            <div key={index} className={`grid grid-cols-[1.25rem_1.25rem_1fr] whitespace-pre ${line.kind === 'add' ? 'bg-proceed/15' : line.kind === 'remove' ? 'bg-error/15' : ''}`}>
              <span className={`text-center ${line.kind === 'remove' ? 'text-error' : 'text-inkdim'}`}>{line.kind === 'remove' ? '−' : ''}</span>
              <span className={`text-center ${line.kind === 'add' ? 'text-proceed' : 'text-inkdim'}`}>{line.kind === 'add' ? '+' : ''}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      ) : proposal?.status === 'failed' ? (
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-2 text-[0.75rem] leading-4 text-inkdim">
          <span>{t(locale, 'chat.card.proposal.failed')}</span>
          <button type="button" className={BUTTON} onClick={() => store.loadProposal(artifact.id)}>
            {t(locale, 'chat.card.proposal.retry')}
          </button>
        </div>
      ) : (
        <div className="border-t border-hairline px-3 py-2 text-[0.75rem] leading-4 text-inkdim">{t(locale, 'chat.card.proposal.loading')}</div>
      )}
      {action === undefined ? null : (
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
          {target === '' ? null : <span className="mr-auto min-w-0 truncate text-[0.75rem] leading-4 text-inkdim">{fill(t(locale, 'chat.card.proposal.source'), { target })}</span>}
          <span className="flex-1" />
          {action.status === 'pending' ? (
            <>
              <button type="button" className={BUTTON_GHOST} onClick={() => void store.decide(action.id, 'rejected')}>
                {t(locale, 'chat.card.proposal.reject')}
              </button>
              <button type="button" className={BUTTON_PRIMARY} onClick={() => void store.decide(action.id, 'approved')}>
                {t(locale, 'chat.card.proposal.approve')}
              </button>
            </>
          ) : (
            <span className={`font-mono text-[0.6875rem] font-medium leading-4 ${action.status === 'applied' ? 'text-proceed' : 'text-inkdim'}`}>
              {t(locale, action.status === 'applied' ? 'chat.card.proposal.approved' : action.status === 'undone' ? 'chat.action.undone' : action.status === 'failed' ? 'chat.action.failed' : 'chat.card.proposal.rejected')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The ids of the actions a card already speaks for. */
const cardActionIds = (messages: readonly ChatMessageView[]): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const artifact of message.artifacts) if ((artifact.kind === 'proposal' || artifact.kind === 'draft') && artifact.action !== null) ids.add(artifact.action);
  }
  return ids;
};

function ActionRow({ action, backed, store, locale, now }: { readonly action: ChatActionView; readonly backed: boolean; readonly store: ChatStore; readonly locale: Locale; readonly now: number }) {
  const undone = action.status === 'undone';
  const pending = action.status === 'pending';
  const text =
    action.status === 'failed'
      ? t(locale, 'chat.action.failed')
      : pending
        ? t(locale, 'chat.action.pending')
        : action.status === 'rejected'
          ? t(locale, 'chat.card.proposal.rejected')
          : t(locale, ACTION_APPLIED[action.class] ?? 'chat.action.setting_change.applied');
  return (
    <div data-chat-action={action.id} className={`flex items-center gap-2 rounded-card border border-hairline bg-band px-3 py-2 text-[0.78125rem] leading-4 ${undone ? 'text-inkdim' : 'text-ink'}`}>
      <span aria-hidden="true" className={pending ? 'text-signal-soft' : action.status === 'failed' ? 'text-error' : 'text-proceed'}>
        {pending ? '●' : action.status === 'failed' ? '●' : '✓'}
      </span>
      <span className={`min-w-0 flex-1 ${WRAP}`}>{text}</span>
      {pending && !backed ? (
        <>
          <button type="button" className={BUTTON_GHOST} onClick={() => void store.decide(action.id, 'rejected')}>
            {t(locale, 'chat.card.proposal.reject')}
          </button>
          <button type="button" className={BUTTON_PRIMARY} onClick={() => void store.decide(action.id, 'approved')}>
            {t(locale, 'chat.card.proposal.approve')}
          </button>
        </>
      ) : null}
      {undone ? <span className="font-mono text-[0.6875rem] font-medium leading-4 text-inkdim">{t(locale, 'chat.action.undone')}</span> : null}
      {undoOpen(action, now) ? (
        <button type="button" className={BUTTON} onClick={() => void store.undo(action.id)}>
          {t(locale, 'chat.action.undo')}
        </button>
      ) : null}
    </div>
  );
}

function AssistantRow({ message, state, store, locale, onOpenPage }: { readonly message: ChatMessageView; readonly state: ChatState; readonly store: ChatStore; readonly locale: Locale; readonly onOpenPage: (id: string) => void }) {
  const hasProposal = message.artifacts.some((artifact) => artifact.kind === 'proposal');
  return (
    <div data-chat-row="assistant" className="grid gap-3">
      {message.text === '' ? null : <div className={`${WRAP} text-[0.875rem] leading-5 text-ink`}>{message.text}</div>}
      {message.artifacts.map((artifact, index) => {
        if (artifact.kind === 'page') return <PageCard key={index} artifact={artifact} locale={locale} onOpenPage={onOpenPage} />;
        if (artifact.kind === 'table') return <Table key={index} columns={artifact.columns} rows={artifact.rows} label={t(locale, 'chat.card.table')} />;
        if (artifact.kind === 'draft' && state.detail !== null) return <DraftCard key={index} artifact={artifact} detail={state.detail} store={store} locale={locale} />;
        if (artifact.kind === 'proposal') return <ProposalCard key={index} artifact={artifact} state={state} store={store} locale={locale} />;
        return null;
      })}
      {message.sources.length > 0 && !hasProposal ? (
        <div className="flex flex-wrap gap-1">
          {message.sources.map((source, index) => (
            <span key={index} className={SOURCE_CHIP}>
              <span className="truncate">{source}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface ChatFeedProps {
  readonly state: ChatState;
  readonly store: ChatStore;
  readonly locale: Locale;
  readonly onOpenPage: (id: string) => void;
}

export function ChatFeed({ state, store, locale, onOpenPage }: ChatFeedProps) {
  const messages = state.detail?.messages ?? [];
  const actions = state.detail?.actions ?? [];
  const backed = cardActionIds(messages);
  const rows = actions.filter((action) => action.status === 'applied' || action.status === 'undone' || !backed.has(action.id));
  const dots = chatShowsDots(state);
  const empty = messages.length === 0 && state.pending === null && !dots && state.streamed === '';
  const [first, second] = suggestionKeysOf(state.scope.kind);
  // The newest content stays in view: the feed follows the bottom on every change.
  const bottom = `${messages.length}:${state.streamed.length}:${state.pending === null ? 0 : 1}:${dots ? 1 : 0}`;
  useEffect(() => {
    const feed = document.querySelector('[data-chat-feed]');
    if (feed !== null) feed.scrollTop = feed.scrollHeight;
  }, [bottom]);

  return (
    <div data-chat-feed="" aria-live="polite" className="grid min-h-0 content-start gap-5 overflow-auto px-4 pb-4 pt-2">
      {empty ? (
        <div className="grid gap-3 py-6">
          <div className="text-base font-bold leading-6 text-ink">{t(locale, 'chat.empty.title')}</div>
          <div className="flex flex-wrap gap-2">
            {[first, second].map((key) => (
              <button
                key={key}
                type="button"
                className={`min-h-7 rounded-full border border-hairline bg-transparent px-3 py-1 text-[0.78125rem] leading-5 text-ink hover:bg-raised ${FOCUS}`}
                onClick={() => void store.sendText(t(locale, key))}
              >
                {t(locale, key)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserRow
            key={message.id}
            text={message.text}
            refs={message.refs}
            files={message.attachments.map((attachment) => ({ name: attachment.name, kind: attachment.type }))}
          />
        ) : (
          <AssistantRow key={message.id} message={message} state={state} store={store} locale={locale} onOpenPage={onOpenPage} />
        ),
      )}
      {state.pending === null ? null : (
        <UserRow
          text={state.pending.text}
          refs={state.pending.refs.map((chip) => ({ kind: chip.kind, id: chip.key, label: chip.label, ...(chip.prefix === undefined ? {} : { project: chip.prefix }) }))}
          files={state.pending.files.map((file) => ({ name: file.name, kind: file.kind }))}
        />
      )}
      {rows.map((action) => (
        <ActionRow key={action.id} action={action} backed={backed.has(action.id)} store={store} locale={locale} now={state.now} />
      ))}
      {state.streamed === '' ? null : (
        <div data-chat-row="assistant" className={`${WRAP} text-[0.875rem] leading-5 text-ink`}>
          {state.streamed}
        </div>
      )}
      {dots ? (
        <div data-chat-row="assistant">
          <span role="status" aria-label={t(locale, 'chat.busy')} className="inline-flex gap-1 py-2">
            <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse" />
            <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse [animation-delay:150ms]" />
            <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse [animation-delay:300ms]" />
          </span>
        </div>
      ) : null}
    </div>
  );
}
