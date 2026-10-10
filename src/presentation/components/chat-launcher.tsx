// components/chat-launcher.tsx — the contextual launcher: a pill (spark icon + label) on a host
// screen that opens the one Docket AI panel with the host's scope and a starter text in the
// composer. No chat logic lives here; the click is the store's openChat (stores/chat-launcher.ts).
// The store and the locale arrive through a context the shell provides once, so a host screen
// adds a launcher without learning about the chat; outside the context a launcher draws nothing.
import { createContext, useContext, type ReactNode } from 'react';

import type { ChatScopeInput } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { caretDelayMs, launchChat, placeCaretAtEnd, prefillText, scopeToken, type LaunchStore } from '../stores/chat-launcher';
import { ChatIcon } from './chat-icons';
import { FOCUS } from './chat-style';

export interface ChatLauncherEnv {
  readonly store: LaunchStore;
  readonly locale: Locale;
}

export const ChatLauncherContext = createContext<ChatLauncherEnv | null>(null);

const PILL = `inline-flex h-8 items-center gap-2 rounded-full border border-bord bg-raised px-4 text-[0.8125rem] font-semibold leading-4 text-ink hover:bg-hairline motion-safe:transition-colors motion-reduce:transition-none ${FOCUS}`;

export interface ChatLauncherProps {
  /** The hook the layout audit and the journeys find the launcher by. */
  readonly id: string;
  readonly labelKey: LabelKey;
  readonly prefillKey: LabelKey;
  readonly scope: ChatScopeInput;
  /** A section label key, for a prefill that names its section. */
  readonly sectionKey?: LabelKey;
  /** Runs just before the panel opens, for a host that must step aside first (the settings panel). */
  readonly onLaunch?: () => void;
}

export function ChatLauncher({ id, labelKey, prefillKey, scope, sectionKey, onLaunch }: ChatLauncherProps) {
  const env = useContext(ChatLauncherContext);
  if (env === null) return null;
  const { store, locale } = env;
  const click = (): void => {
    onLaunch?.();
    launchChat(store, scope, prefillText(locale, prefillKey, sectionKey));
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(placeCaretAtEnd, caretDelayMs(reduced));
  };
  return (
    <button type="button" data-launch={id} data-launch-scope={scopeToken(scope)} className={PILL} onClick={click}>
      <ChatIcon name="spark" className="h-4 w-4 flex-none" />
      {t(locale, labelKey)}
    </button>
  );
}

/** The `.launch` row of the approved prototype: below the screen's heading, wrapping, an 8 step gap. */
export function LauncherRow({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div data-launch-row="" className={className === undefined ? 'flex flex-wrap gap-2' : `flex flex-wrap gap-2 ${className}`}>
      {children}
    </div>
  );
}
