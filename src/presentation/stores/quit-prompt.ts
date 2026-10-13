// stores/quit-prompt.ts — the in-app quit confirmation's state (U-294, U-295). The shell pushes
// `quit.requested` with the titles of what would stop; the modal opens and acknowledges at once
// (`quit.ack`, so the shell knows no native dialog is needed). Vazgeç and Esc answer false and close;
// Kapat ve durdur answers true. Enter and a click on the scrim never answer: `quitIntent` maps both
// to nothing, and the reducer has no action that confirms from them.
import type { Api } from '../../api/api';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';

/** The modal lists at most this many titles, then “+N more”. */
export const QUIT_MODAL_MAX_LINES = 5;

export type QuitPromptState =
  | { readonly open: false }
  | { readonly open: true; readonly runs: readonly string[]; readonly chats: readonly string[] };

export type QuitPromptAction =
  | { readonly type: 'requested'; readonly runs: readonly string[]; readonly chats: readonly string[] }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' };

export const CLOSED_QUIT_PROMPT: QuitPromptState = { open: false };

export const quitPromptReducer = (state: QuitPromptState, action: QuitPromptAction): QuitPromptState => {
  switch (action.type) {
    case 'requested':
      return { open: true, runs: action.runs, chats: action.chats };
    case 'cancel':
    case 'confirm':
      return state.open ? CLOSED_QUIT_PROMPT : state;
  }
};

/** What an input does to the prompt. Only the two buttons and Esc answer; Enter and the scrim do
 *  nothing, so the destructive answer is never one stray keystroke or click away. */
export type QuitInput = 'escape' | 'enter' | 'scrim' | 'cancelButton' | 'confirmButton';

export const quitIntent = (input: QuitInput): 'cancel' | 'confirm' | undefined => {
  switch (input) {
    case 'escape':
    case 'cancelButton':
      return 'cancel';
    case 'confirmButton':
      return 'confirm';
    case 'enter':
    case 'scrim':
      return undefined;
  }
};

/** The modal's work lines: runs first, then chats, at most five, then the “+N more” line. */
export const quitModalLines = (
  state: Extract<QuitPromptState, { readonly open: true }>,
  moreLine: (hidden: number) => string,
): readonly string[] => {
  const titles = [...state.runs, ...state.chats];
  const shown = titles.slice(0, QUIT_MODAL_MAX_LINES);
  const hidden = titles.length - shown.length;
  return hidden > 0 ? [...shown, moreLine(hidden)] : shown;
};

/** The label keys the modal draws from — never inline copy. */
export const QUIT_MODAL_KEYS = {
  title: 'quit.title',
  body: 'quit.body',
  note: 'quit.note',
  more: 'quit.more',
  cancel: 'quit.cancel',
  stop: 'quit.stop',
} as const satisfies Record<string, LabelKey>;

export interface QuitPromptStoreDeps {
  readonly api: Pick<Api, 'command'>;
  readonly changes: Api['subscribe'];
  readonly actor: Actor;
}

export interface QuitPromptStore {
  state(): QuitPromptState;
  subscribe(listener: () => void): () => void;
  cancel(): void;
  confirm(): void;
}

export const createQuitPromptStore = ({ api, changes, actor }: QuitPromptStoreDeps): QuitPromptStore => {
  let state: QuitPromptState = CLOSED_QUIT_PROMPT;
  const listeners = new Set<() => void>();
  const apply = (action: QuitPromptAction): void => {
    state = quitPromptReducer(state, action);
    for (const listener of [...listeners]) listener();
  };
  const answer = (accept: boolean): void => {
    if (!state.open) return;
    apply({ type: accept ? 'confirm' : 'cancel' });
    void api.command(actor, { type: 'quit.answer', accept });
  };
  changes((event) => {
    if (event.type !== 'quit.requested') return;
    apply({ type: 'requested', runs: event.runs, chats: event.chats });
    void api.command(actor, { type: 'quit.ack' });
  });
  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel: () => answer(false),
    confirm: () => answer(true),
  };
};
