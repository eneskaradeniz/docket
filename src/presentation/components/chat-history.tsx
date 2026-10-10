// components/chat-history.tsx — the panel's history view (U-107, U-108): a search field over the
// grouped conversation list (pinned first, then Bugün, Dün, Bu hafta, older), each row opening its
// conversation on click, Enter or Space, with pin and delete buttons that show on hover or focus.
// The search text goes to the store, which asks the server's Turkish-aware search after a short
// pause; this view never filters by text itself. Titles are untrusted text nodes.
import type { KeyboardEvent, MouseEvent } from 'react';

import type { ChatConversationSummaryView } from '../../api/chat-views';
import { t, type Locale } from '../labels/t';
import { groupConversations, type ChatState, type ConversationGroup } from '../stores/chat-model';
import type { ChatStore } from '../stores/chat-store';
import { ChatIcon } from './chat-icons';
import { FOCUS, ICON_BUTTON_SMALL } from './chat-style';

const GROUP_LABEL = {
  pinned: 'chat.history.group.pinned',
  today: 'chat.history.group.today',
  yesterday: 'chat.history.group.yesterday',
  week: 'chat.history.group.week',
  older: 'chat.history.group.older',
} as const satisfies Record<ConversationGroup, string>;

const DAY = 86_400_000;

/** The time half of a row's meta line: the clock for today and yesterday, the weekday inside the
 *  week, the date beyond — in the active locale. */
const timeOf = (updatedAt: number, now: number, locale: Locale): string => {
  const age = now - updatedAt;
  const options: Intl.DateTimeFormatOptions = age < 2 * DAY ? { hour: '2-digit', minute: '2-digit' } : age < 7 * DAY ? { weekday: 'short' } : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(locale, options).format(updatedAt);
};

function Row({ entry, state, store, locale }: { readonly entry: ChatConversationSummaryView; readonly state: ChatState; readonly store: ChatStore; readonly locale: Locale }) {
  const scope = entry.scope.kind === 'global' ? t(locale, 'chat.scope.global') : entry.scope.kind === 'project' ? entry.scope.project : t(locale, 'chat.scope.fallback.workOrder');
  const open = (): void => void store.openConversation(entry.id);
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  const stop = (event: MouseEvent): void => event.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      data-chat-history-row={entry.id}
      className={`group grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-control p-2 text-left hover:bg-raised focus-within:bg-raised ${FOCUS}`}
      onClick={open}
      onKeyDown={onKey}
    >
      <span className="min-w-0">
        <span className="mb-1 block truncate text-[0.875rem] font-semibold leading-5 text-ink" title={entry.title}>{entry.title}</span>
        <span className="flex items-center gap-2 text-[0.75rem] leading-4 text-inkdim">
          <span className="truncate">{scope}</span>
          <span>·</span>
          <span>{timeOf(entry.updatedAt, state.now, locale)}</span>
          {entry.pinned ? <span className="font-mono text-[0.6875rem] font-medium leading-none text-signal-soft">{t(locale, 'chat.scope.pinned')}</span> : null}
        </span>
      </span>
      <span className="flex gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          className={ICON_BUTTON_SMALL}
          aria-pressed={entry.pinned}
          aria-label={t(locale, entry.pinned ? 'chat.history.unpin' : 'chat.history.pin')}
          title={t(locale, entry.pinned ? 'chat.history.unpin' : 'chat.history.pin')}
          onClick={(event) => {
            stop(event);
            void store.pinConversation(entry.id, !entry.pinned);
          }}
        >
          <ChatIcon name="pin" className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON_SMALL}
          aria-label={t(locale, 'chat.history.delete')}
          title={t(locale, 'chat.history.delete')}
          onClick={(event) => {
            stop(event);
            void store.deleteConversation(entry.id);
          }}
        >
          <ChatIcon name="trash" className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}

export function ChatHistory({ state, store, locale }: { readonly state: ChatState; readonly store: ChatStore; readonly locale: Locale }) {
  const groups = groupConversations(state.history.items, state.now);
  const { search, loaded, failed } = state.history;
  return (
    <div data-chat-history="" className="grid min-h-0 grid-rows-[auto_1fr]">
      <div className="px-4 pb-3 pt-1">
        <input
          type="search"
          data-chat-history-search=""
          value={search}
          placeholder={t(locale, 'chat.history.search')}
          aria-label={t(locale, 'chat.history.search')}
          className={`h-8 w-full rounded-control border border-bord bg-raised px-3 text-[0.875rem] leading-5 text-ink outline-none focus:border-signal-soft ${FOCUS}`}
          onChange={(event) => store.setSearch(event.target.value)}
        />
      </div>
      <div className="min-h-0 overflow-auto px-2 pb-4">
        {failed ? (
          <div role="alert" className="px-4 py-6 text-center text-[0.875rem] leading-5 text-inkdim">
            {t(locale, 'chat.history.failed')}
          </div>
        ) : loaded && groups.length === 0 ? (
          <div className="px-4 py-6 text-center text-[0.875rem] leading-5 text-inkdim">{t(locale, search.trim() === '' ? 'chat.history.empty' : 'chat.history.none')}</div>
        ) : (
          groups.map((group) => (
            <div key={group.group}>
              <div className="px-2 pb-1 pt-3 text-[0.75rem] leading-4 text-inkdim">{t(locale, GROUP_LABEL[group.group])}</div>
              {group.items.map((entry) => (
                <Row key={entry.id} entry={entry} state={state} store={store} locale={locale} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
