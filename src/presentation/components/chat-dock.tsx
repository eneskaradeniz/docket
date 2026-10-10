// components/chat-dock.tsx — Docket AI's round button and the panel that grows out of it (U-101,
// U-102, U-117, U-120, U-125): one dock at the app root, over every screen. The button is a named
// toggle with an alert dot; the panel is a non-modal dialog whose header carries the scope chip
// (a listbox of the scopes the screen offers, the attached items and the follow row), the history
// toggle and Yeni konuşma; its body is the conversation or the history; its foot is the composer.
// Esc climbs the ladder (scope pop, menu, permission dialog, history, panel) and a close by Esc
// returns focus to the button. A closed panel is inert and hidden from assistive technology; the
// whole dock is hidden while a blocking modal owns the screen. All lengths are rem, the panel's
// opening is a transform and opacity change under motion-safe, and every string is a label.
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import { placeScope, sameScope, type ChatPlace, type ChatScopeInput, type ChatState } from '../stores/chat-model';
import type { ChatStore } from '../stores/chat-store';
import { ChatComposer } from './chat-composer';
import { ChatFeed } from './chat-feed';
import { ChatHistory } from './chat-history';
import { ChatIcon, scopeIcon } from './chat-icons';
import { FLOATING, FOCUS, ICON_BUTTON, MENU_DESC, MENU_OPTION, MENU_TITLE } from './chat-style';

export interface ChatDockProps {
  readonly store: ChatStore;
  readonly locale: Locale;
  /** A blocking modal (the settings panel, the wizard) owns the screen: the dock steps aside. */
  readonly hidden: boolean;
  /** A page card opens its page route in the viewer. */
  readonly onOpenPage: (id: string) => void;
  /** Hesabı değiştir: Ayarlar › Hesaplar. */
  readonly onOpenAccounts: () => void;
  /** İzin ver: the consent step already in the settings. */
  readonly onOpenConsent: () => void;
}

/** The name the chip shows for a scope: the screen's own label when it gave one, else the generic
 *  word for the kind (a project's slug stands in for its name). */
const scopeName = (scope: ChatScopeInput, place: ChatPlace, locale: Locale): string => {
  const known = place.choices.find((choice) => sameScope(choice.scope, scope))?.label ?? '';
  if (known !== '') return known;
  if (scope.kind === 'global') return t(locale, 'chat.scope.global');
  if (scope.kind === 'project') return scope.project;
  return t(locale, 'chat.scope.fallback.workOrder');
};

const scopeDesc = (kind: ChatScopeInput['kind'], locale: Locale): string =>
  t(locale, kind === 'global' ? 'chat.scope.desc.global' : kind === 'project' ? 'chat.scope.desc.project' : 'chat.scope.desc.workOrder');

function ScopeChip({ state, store, locale }: { readonly state: ChatState; readonly store: ChatStore; readonly locale: Locale }) {
  const extra = state.refs.length + state.tray.length;
  const options = state.place.choices.some((choice) => sameScope(choice.scope, state.scope))
    ? state.place.choices
    : [{ scope: state.scope, label: '' }, ...state.place.choices];
  return (
    <div data-chat-scope="" className="relative min-w-0">
      <button
        type="button"
        data-chat-chip=""
        aria-haspopup="listbox"
        aria-expanded={state.scopePop}
        className={`inline-flex h-7 max-w-60 items-center gap-2 rounded-full border border-bord bg-transparent px-3 text-[0.78125rem] font-semibold leading-none text-ink hover:bg-raised ${FOCUS}`}
        onClick={() => store.togglePop()}
      >
        <ChatIcon name={scopeIcon(state.scope.kind)} className="h-3.5 w-3.5 flex-none text-inkdim" />
        <span className="truncate">{scopeName(state.scope, state.place, locale)}</span>
        {extra > 0 ? <span className="font-mono text-[0.6875rem] font-medium leading-none text-signal-soft">{`+${extra}`}</span> : null}
        {state.pinned ? <span className="font-mono text-[0.6875rem] font-medium leading-none text-inkdim">{t(locale, 'chat.scope.pinned')}</span> : null}
        <ChatIcon name="chevron" className="h-2.5 w-2.5 flex-none text-inkdim" />
      </button>
      {state.scopePop ? (
        <div data-chat-pop="" className={`${FLOATING} absolute left-0 top-full z-[3] mt-2 w-72`}>
          <div role="listbox" aria-label={t(locale, 'chat.panel')}>
            {options.map((choice) => {
              const selected = sameScope(choice.scope, state.scope);
              return (
                <button
                  key={`${choice.scope.kind}:${choice.scope.kind === 'project' ? choice.scope.project : choice.scope.kind === 'workOrder' ? choice.scope.workOrder : ''}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={MENU_OPTION}
                  onClick={() => store.pickScope(choice.scope)}
                >
                  <ChatIcon name={scopeIcon(choice.scope.kind)} className="h-3.5 w-3.5 text-inkdim" />
                  <span className="min-w-0">
                    <span className={MENU_TITLE}>{scopeName(choice.scope, state.place, locale)}</span>
                    <span className={MENU_DESC}>{scopeDesc(choice.scope.kind, locale)}</span>
                  </span>
                  <span aria-hidden="true" className="text-signal-soft">
                    {selected ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          <hr className="my-1 border-0 border-t border-hairline" />
          <div className="px-3 py-2 text-[0.75rem] leading-4 text-inkdim">
            {sameScope(state.scope, placeScope(state.place)) && !state.pinned ? (
              t(locale, 'chat.scope.following')
            ) : (
              <button type="button" data-chat-follow="" className={`border-0 bg-transparent p-0 text-[0.75rem] font-semibold leading-4 text-ink underline ${FOCUS}`} onClick={() => store.followScreen()}>
                {t(locale, 'chat.scope.follow')}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatDock({ store, locale, hidden, onOpenPage, onOpenAccounts, onOpenConsent }: ChatDockProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Esc climbs the ladder; when the climb ends by closing the panel, focus goes back to the button.
  useEffect(() => {
    if (hidden) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !store.state().open) return;
      const wasPanelOpen = store.state().open;
      if (!store.escape()) return;
      event.preventDefault();
      if (wasPanelOpen && !store.state().open) fabRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, hidden]);

  // A press outside closes each popup on its own: the scope pop, the menus and the permission dialog.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const current = store.state();
      if (current.scopePop && target.closest('[data-chat-scope]') === null) store.closePop();
      if (current.menu !== null && target.closest('[data-chat-menu], [data-chat-plus], [data-chat-text]') === null) store.closeMenu();
      if (current.permOpen && target.closest('[data-chat-perm], [data-chat-tier]') === null) store.closePerm();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [store]);

  const open = state.open;
  return (
    <div data-chat-root="" hidden={hidden}>
      <button
        ref={fabRef}
        type="button"
        data-chat-fab=""
        aria-label={t(locale, open ? 'chat.fab.close' : 'chat.fab.open')}
        aria-expanded={open}
        className={`fixed bottom-6 right-6 z-[21] grid h-14 w-14 place-items-center rounded-full border border-bord bg-raised text-ink shadow-[0_1rem_3rem_rgba(0,0,0,0.35)] motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-105 ${FOCUS}`}
        onClick={() => store.toggle()}
      >
        <ChatIcon name="spark" className={`col-start-1 row-start-1 h-6 w-6 motion-safe:transition-opacity ${open ? 'opacity-0' : 'opacity-100'}`} />
        <ChatIcon name="close" className={`col-start-1 row-start-1 h-6 w-6 motion-safe:transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
        {state.alert && !open ? <span data-chat-alert="" aria-hidden="true" className="absolute right-2 top-2 h-3 w-3 rounded-full border-2 border-raised bg-signal" /> : null}
      </button>
      <section
        ref={panelRef}
        data-chat-panel=""
        role="dialog"
        aria-label={t(locale, 'chat.panel')}
        aria-modal="false"
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={`fixed bottom-[5.75rem] right-6 z-20 grid h-[min(38rem,calc(100vh-9rem))] w-[min(26rem,calc(100vw-2rem))] origin-[calc(100%-1.75rem)_100%] grid-rows-[auto_1fr_auto] overflow-hidden border border-bord bg-surface shadow-[0_1rem_3rem_rgba(0,0,0,0.35)] motion-safe:transition-all motion-safe:duration-[280ms] motion-safe:ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-opacity motion-reduce:duration-[10ms] ${
          open ? 'translate-y-0 scale-100 rounded-panel opacity-100' : 'pointer-events-none translate-y-8 scale-[0.1] rounded-full opacity-0 motion-reduce:translate-y-0 motion-reduce:scale-100'
        }`}
      >
        <div className="flex items-center gap-1 pb-2 pl-4 pr-3 pt-3">
          <ScopeChip state={state} store={store} locale={locale} />
          <span className="flex-1" />
          <button
            type="button"
            data-chat-history-toggle=""
            className={ICON_BUTTON}
            aria-pressed={state.view === 'history'}
            aria-label={t(locale, 'chat.history')}
            title={t(locale, 'chat.history')}
            onClick={() => store.toggleHistory()}
          >
            <ChatIcon name="history" className="h-4 w-4" />
          </button>
          <button type="button" data-chat-new="" className={ICON_BUTTON} aria-label={t(locale, 'chat.new')} title={t(locale, 'chat.new')} onClick={() => void store.newConversation()}>
            <ChatIcon name="plus" className="h-4 w-4" />
          </button>
        </div>
        {state.view === 'history' ? (
          <ChatHistory state={state} store={store} locale={locale} />
        ) : (
          <ChatFeed state={state} store={store} locale={locale} onOpenPage={onOpenPage} />
        )}
        {state.view === 'history' ? <div /> : <ChatComposer state={state} store={store} locale={locale} onOpenAccounts={onOpenAccounts} onOpenConsent={onOpenConsent} />}
      </section>
    </div>
  );
}
