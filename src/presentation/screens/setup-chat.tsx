// screens/setup-chat.tsx — the setup conversation as the main panel's own screen (U-385 … U-388):
// the empty start's one column, then the dock's own feed and composer rules on the setup store's
// conversation — streaming, thinking and tool steps under the running message, the stored message
// with its page and table cards and the folded steps after the finish, the project_setup proposal
// as U-111's card deciding through proposal.decide. Every message text, title, cell, tool name and
// target is untrusted data: it enters the DOM only as a React text node, never as markup.
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { PageCard, StepFold, StepRows, Table } from '../components/chat-feed';
import { ChatIcon } from '../components/chat-icons';
import { ActionButton } from '../components/action-button';
import { PermissionPrompt } from '../components/permission-prompt';
import { BUTTON, BUTTON_PRIMARY, FOCUS, fill } from '../components/chat-style';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  chatBusy,
  chatInputBlocked,
  chatShowsDots,
  chatShowsFold,
  chatShowsSteps,
  chatShowsThinking,
  noticeOf,
  noticeTextKey,
} from '../stores/chat-model';
import type { NewProjectDone, SetupThreadMessage } from '../stores/new-project';
import type { SetupChatStore, SetupProposalCard } from '../stores/setup-chat';

export interface SetupChatScreenProps {
  readonly store: SetupChatStore;
  readonly locale: Locale;
  /** Where a page card's "Aç" opens the page (U-388): the viewer's route. */
  readonly onOpenPage: (id: string) => void;
  /** The page route that stands open, else null: its own card reads Açık and is disabled (U-391). */
  readonly openPageId?: string | null;
  /** A pill's path: today's Proje ekle panel opens on it, nothing else changes (U-386). */
  readonly onOpenPanelPath: (path: 'quick' | 'detailed' | 'import') => void;
  /** The finished setup's handoff: the shell navigates and toasts. */
  readonly onDone: (done: NewProjectDone) => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenConsent: () => void;
  readonly onOpenRoles: () => void;
}

const WRAP = 'whitespace-pre-wrap [overflow-wrap:anywhere]';
const LABEL_CLASS = 'text-[0.8125rem] leading-[1.25rem] font-semibold text-ink';
const INPUT_CLASS =
  'w-full rounded-control border border-bord bg-transparent px-3 py-2 text-[0.8125rem] leading-[1.25rem] text-ink focus:border-signal focus:outline-none';
const PILL = `inline-flex h-7 flex-none items-center rounded-full border border-hairline bg-transparent px-3 text-[0.78125rem] leading-4 text-ink hover:bg-raised ${FOCUS}`;
const NOTE = 'flex items-center gap-2 rounded-control bg-raised px-3 py-2 text-[0.78125rem] leading-4 text-ink';
const NOTE_REMOVE = `border-0 bg-transparent pl-1 text-[0.75rem] leading-none text-inkdim hover:text-ink ${FOCUS}`;

/** The notice keys' own doors (U-113): the same three the dock's composer names. */
const NOTE_ACTION_KEY = {
  accounts: 'chat.note.quota.action',
  consent: 'chat.note.consent.action',
  roles: 'chat.note.no_binding.action',
} as const satisfies Record<'accounts' | 'consent' | 'roles', LabelKey>;

/** A stored thread line as text: a notice key becomes the locale's sentence, anything else stays
 *  the message's own data — rendered as a React text node, never as markup. */
const shownThreadText = (text: string, locale: Locale): string => {
  const key = noticeTextKey(text);
  return key === null ? text : t(locale, key);
};

/** The first user message's own rendering (U-387): the bundle's sentence with the path in mono. */
const FirstMessage = ({ locale, path }: { readonly locale: Locale; readonly path: string | null }) => {
  const [lead, tail] = t(locale, 'setup.chat.firstMessage').split('{path}');
  return (
    <>
      {lead}
      <span className="font-mono">{path}</span>
      {tail ?? ''}
    </>
  );
};

function UserRow({ text, locale, path }: { readonly text: string; readonly locale: Locale; readonly path: string | null }) {
  return (
    <div
      data-setup-row="user"
      className={`${WRAP} max-w-[85%] justify-self-end rounded-panel bg-raised px-3 py-2 text-[0.875rem] leading-5 text-ink`}
    >
      {path === null ? shownThreadText(text, locale) : <FirstMessage locale={locale} path={path} />}
    </div>
  );
}

/** One stored assistant message: its text and its page and table cards, U-111's anatomy (U-388). */
function AssistantRow({
  message,
  locale,
  onOpenPage,
  openPageId,
}: {
  readonly message: SetupThreadMessage;
  readonly locale: Locale;
  readonly onOpenPage: (id: string) => void;
  readonly openPageId: string | null;
}) {
  return (
    <div data-setup-row="assistant" className="grid gap-3">
      {message.text === '' ? null : (
        <div className={`${WRAP} text-[0.875rem] leading-5 text-ink`}>{shownThreadText(message.text, locale)}</div>
      )}
      {message.artifacts.map((artifact, index) => {
        if (artifact.kind === 'page') return <PageCard key={index} artifact={artifact} locale={locale} onOpenPage={onOpenPage} openPageId={openPageId} />;
        if (artifact.kind === 'table')
          return <Table key={index} columns={artifact.columns} rows={artifact.rows} label={t(locale, 'chat.card.table')} wide={false} />;
        return null;
      })}
    </div>
  );
}

/** The pending project_setup proposal as the dock's proposal card (U-111, A-360): the diff read
 *  from proposal.detail, Reddet and Onayla through proposal.decide — the screen's one approval. */
function ProposalRow({ proposal, store, locale }: { readonly proposal: SetupProposalCard; readonly store: SetupChatStore; readonly locale: Locale }) {
  return (
    <div data-setup-card="proposal" className="overflow-hidden rounded-card border border-hairline bg-band">
      <div className="flex min-h-8 items-center gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-[0.875rem] font-semibold leading-5 text-ink">{t(locale, 'setup.proposal.title')}</span>
        <span className="flex-1" />
        {proposal.target === '' ? null : (
          <span className="whitespace-nowrap font-mono text-[0.6875rem] font-medium leading-none text-inkdim">{proposal.target}</span>
        )}
      </div>
      {proposal.status === 'ready' ? (
        <div className="max-h-44 overflow-auto border-t border-hairline font-mono text-[0.75rem] leading-5">
          {proposal.lines.map((line, index) => (
            <div
              key={index}
              className={`grid grid-cols-[1.25rem_1.25rem_1fr] whitespace-pre ${line.kind === 'add' ? 'bg-proceed/15' : line.kind === 'remove' ? 'bg-error/15' : ''}`}
            >
              <span className={`text-center ${line.kind === 'remove' ? 'text-error' : 'text-inkdim'}`}>{line.kind === 'remove' ? '−' : ''}</span>
              <span className={`text-center ${line.kind === 'add' ? 'text-proceed' : 'text-inkdim'}`}>{line.kind === 'add' ? '+' : ''}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      ) : proposal.status === 'failed' ? (
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-2 text-[0.75rem] leading-4 text-inkdim">
          <span>{t(locale, 'chat.card.proposal.failed')}</span>
          <button type="button" className={BUTTON} onClick={() => store.retryProposal()}>
            {t(locale, 'chat.card.proposal.retry')}
          </button>
        </div>
      ) : (
        <div className="border-t border-hairline px-3 py-2 text-[0.75rem] leading-4 text-inkdim">{t(locale, 'chat.card.proposal.loading')}</div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-hairline px-3 py-2">
        {proposal.decided === null ? (
          <>
            <button type="button" className={BUTTON} onClick={() => void store.decideProposal('rejected')}>
              {t(locale, 'chat.card.proposal.reject')}
            </button>
            <button type="button" className={BUTTON_PRIMARY} onClick={() => void store.decideProposal('approved')}>
              {t(locale, 'chat.card.proposal.approve')}
            </button>
          </>
        ) : (
          <span className={`text-[0.6875rem] font-medium leading-4 ${proposal.decided === 'approved' ? 'text-proceed' : 'text-inkdim'}`}>
            {t(locale, proposal.decided === 'approved' ? 'chat.card.proposal.approved' : 'chat.card.proposal.rejected')}
          </span>
        )}
      </div>
    </div>
  );
}

export function SetupChatScreen({ store, locale, onOpenPage, openPageId = null, onOpenPanelPath, onDone, onOpenAccounts, onOpenConsent, onOpenRoles }: SetupChatScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const feedRef = useRef<HTMLDivElement>(null);
  const {
    repoPath,
    sending,
    conversation,
    conversationPath,
    messages,
    pending,
    streamed,
    thinking,
    steps,
    stepsOpen,
    notice,
    note,
    draft,
    permission,
    permissionRepoLabel,
    secretNotices,
    proposal,
    done,
  } = state;

  // The finished setup hands itself over once: the shell navigates and toasts (U-388).
  useEffect(() => {
    if (done !== null) onDone(done);
  }, [done, onDone]);

  const busy = chatBusy(state);
  const blocked = chatInputBlocked(state);
  const dots = chatShowsDots(state);
  // The conversation's first user row is the auto-sent first message (U-387): it draws from the
  // bundle's own sentence, with the path in mono — every later row is the operator's own text.
  const firstUserId = messages.find((message) => message.role === 'user')?.id ?? null;

  // The newest content stays in view: the feed follows the bottom on every change.
  const bottom = `${messages.length}:${streamed.length}:${thinking.length}:${steps.length}:${stepsOpen ? 1 : 0}:${pending === null ? 0 : 1}:${dots ? 1 : 0}:${proposal === null ? 0 : 1}`;
  useEffect(() => {
    if (feedRef.current !== null) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [bottom]);

  const noticeInfo = notice === null ? null : noticeOf(notice);

  const head = (
    <header data-setup-head="" className="flex-none pb-4">
      <h1 className="text-[1.375rem] font-bold leading-[1.75rem] tracking-[-0.015em] text-ink">{t(locale, 'setup.title')}</h1>
      <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-[0.8125rem] leading-[1.25rem] text-inkdim">
        <span>{t(locale, 'setup.ai.title')}</span>
        {conversationPath === null ? null : <span className="min-w-0 truncate font-mono text-[0.75rem] leading-[1.25rem] text-ink">{conversationPath}</span>}
      </p>
    </header>
  );

  const noteRow = note === null ? null : (
    <div role="status" data-setup-note="note" className={NOTE}>
      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-signal" />
      <span className={`min-w-0 flex-1 ${WRAP}`}>{t(locale, note)}</span>
      <button type="button" className={`${NOTE_REMOVE} flex-none pr-1`} aria-label={t(locale, 'chat.note.dismiss')} onClick={() => store.dismissNote()}>
        ×
      </button>
    </div>
  );

  return (
    <div data-setup-screen="" className="mx-auto grid h-full min-h-0 w-full max-w-[44rem] grid-rows-[auto_minmax(0,1fr)] gap-4">
      {head}
      {conversation === null ? (
        <section data-setup-start="" className="grid content-start gap-4 pt-8">
          <h2 className="text-[1.375rem] font-bold leading-[1.75rem] text-ink">{t(locale, 'setup.chat.heading')}</h2>
          <p className="max-w-[60ch] text-[0.8125rem] leading-[1.25rem] text-inkdim">{t(locale, 'setup.ai.desc')}</p>
          <form
            data-setup-start-form=""
            className="grid max-w-[36rem] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (repoPath.trim() !== '' && !sending) void store.start(fill(t(locale, 'setup.chat.firstMessage'), { path: repoPath.trim() }));
            }}
          >
            <label className="grid gap-2">
              <span className={LABEL_CLASS}>{t(locale, 'setup.chat.folder')}</span>
              <input
                autoFocus
                value={repoPath}
                onChange={(event) => store.setRepoPath(event.target.value)}
                placeholder={t(locale, 'setup.chat.folder.placeholder')}
                aria-label={t(locale, 'setup.chat.folder')}
                data-setup-folder=""
                className={`${INPUT_CLASS} font-mono`}
              />
            </label>
            {noteRow}
            {/* The screen's only primary (U-375): disabled while the trimmed field is blank. */}
            <div className="grid justify-start">
              <ActionButton
                variant="primary"
                size="md"
                disabled={repoPath.trim() === '' || sending}
                ariaBusy={sending}
                data-setup-start-button=""
                onClick={() => void store.start(fill(t(locale, 'setup.chat.firstMessage'), { path: repoPath.trim() }))}
              >
                {t(locale, 'setup.ai.start')}
              </ActionButton>
            </div>
          </form>
          <div data-setup-alt="" className="grid gap-2 pt-4">
            <span className="text-[0.75rem] leading-4 text-inkdim">{t(locale, 'setup.chat.alt')}</span>
            <div className="flex flex-wrap gap-2">
              {([['setup.quick.title', 'quick'], ['setup.detailed.title', 'detailed'], ['setup.chat.existing', 'import']] as const).map(([key, path]) => (
                <button key={path} type="button" data-setup-pill={path} className={PILL} onClick={() => onOpenPanelPath(path)}>
                  {t(locale, key)}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div data-setup-live="" className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <div
            ref={feedRef}
            tabIndex={-1}
            role="log"
            aria-label={t(locale, 'setup.chat.feed')}
            aria-live="polite"
            data-setup-feed=""
            className="grid min-h-0 content-start gap-4 overflow-y-auto pb-1 outline-none"
          >
            {secretNotices > 0 ? (
              <p role="status" data-setup-secret-notice="" className={`${WRAP} text-[0.78125rem] leading-[1.125rem] text-error`}>
                {t(locale, 'setup.permission.secretNotice')}
              </p>
            ) : null}
            {messages.map((message) =>
              message.role === 'user' ? (
                <UserRow key={message.id} text={message.text} locale={locale} path={message.id === firstUserId ? conversationPath : null} />
              ) : (
                <AssistantRow key={message.id} message={message} locale={locale} onOpenPage={onOpenPage} openPageId={openPageId} />
              ),
            )}
            {pending === null ? null : (
              <UserRow text={pending.text} locale={locale} path={pending.first ? conversationPath : null} />
            )}
            {streamed === '' ? null : (
              <div data-setup-row="assistant" className={`${WRAP} text-[0.875rem] leading-5 text-ink`}>
                {streamed}
              </div>
            )}
            {chatShowsThinking(state) ? (
              <div data-setup-thinking="" aria-live="off" className="grid gap-1">
                <div className="text-[0.6875rem] font-medium leading-4 text-inkdim">{t(locale, 'chat.thinking.heading')}</div>
                <div className={`${WRAP} text-[0.8125rem] leading-5 text-inkdim`}>{thinking}</div>
              </div>
            ) : null}
            {chatShowsSteps(state) ? <StepRows rows={steps} locale={locale} /> : null}
            {chatShowsFold(state) ? <StepFold state={{ steps, stepsOpen }} store={{ toggleSteps: store.toggleSteps }} locale={locale} /> : null}
            {proposal === null ? null : <ProposalRow proposal={proposal} store={store} locale={locale} />}
            {dots ? (
              <div data-setup-row="assistant">
                <span role="status" aria-label={t(locale, 'chat.busy')} className="inline-flex gap-1 py-2">
                  <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse" />
                  <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse [animation-delay:150ms]" />
                  <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse [animation-delay:300ms]" />
                </span>
              </div>
            ) : null}
          </div>
          <div data-setup-bottom="" className="grid flex-none gap-2">
            {noticeInfo === null ? null : (
              <div role="status" data-setup-note={noticeInfo.kind} className={NOTE}>
                <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${noticeInfo.kind === 'quota' ? 'bg-error' : 'bg-signal'}`} />
                <span className={`min-w-0 ${WRAP}`}>{t(locale, `chat.note.${noticeInfo.kind}` as LabelKey)}</span>
                {noticeInfo.action === null ? null : (
                  <button
                    type="button"
                    className={`${BUTTON} ml-auto`}
                    onClick={() => {
                      if (noticeInfo.action === 'accounts') onOpenAccounts();
                      else if (noticeInfo.action === 'roles') onOpenRoles();
                      else onOpenConsent();
                      store.clearNotice();
                    }}
                  >
                    {t(locale, NOTE_ACTION_KEY[noticeInfo.action])}
                  </button>
                )}
              </div>
            )}
            {noteRow}
            {/* The composer: no Öner tier and no usage line (U-387) — the setup conversation's
                permissions are the session read grants of U-272 … U-279. */}
            <form
              data-setup-composer=""
              className="flex items-center gap-2 rounded-panel border border-bord bg-surface p-2 focus-within:border-signal-soft"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && !blocked) void store.send();
              }}
            >
              <input
                value={draft}
                disabled={busy || blocked}
                onChange={(event) => store.setDraft(event.target.value)}
                placeholder={t(locale, 'setup.ai.placeholder')}
                aria-label={t(locale, 'setup.ai.placeholder')}
                data-setup-text=""
                className={`min-w-0 flex-1 border-0 bg-transparent px-1 py-2 text-[0.875rem] leading-5 text-ink outline-none placeholder:text-inkdim disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}
              />
              {busy ? (
                <button
                  type="button"
                  data-setup-stop=""
                  className={`grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-ink text-bg ${FOCUS}`}
                  aria-label={t(locale, 'chat.stop')}
                  onClick={() => void store.cancel()}
                >
                  <ChatIcon name="stop" className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  data-setup-send=""
                  className={`grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-ink text-bg disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`}
                  aria-label={t(locale, 'chat.send')}
                  disabled={draft.trim() === '' || blocked}
                >
                  <ChatIcon name="send" className="h-4 w-4" />
                </button>
              )}
            </form>
          </div>
        </div>
      )}
      <PermissionPrompt
        open={permission !== null}
        prompt={permission}
        locale={locale}
        repoLabel={permissionRepoLabel}
        onDeny={() => store.denyPermission()}
        onAllow={() => store.allowPermission()}
        returnFocusRef={feedRef}
      />
    </div>
  );
}
