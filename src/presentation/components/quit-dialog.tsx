// components/quit-dialog.tsx — the quit confirmation inside the app's own window (U-295). It is the
// shared modal shell in its compact size: Vazgeç (outlined, the default focus) and Kapat ve durdur
// (the destructive primary). Esc is Vazgeç; Enter never confirms and a click on the scrim does
// nothing. Every string comes from the label bundle; the work list shows at most five titles.
import { useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import {
  QUIT_MODAL_KEYS,
  quitIntent,
  quitModalLines,
  type QuitPromptState,
  type QuitPromptStore,
} from '../stores/quit-prompt';
import { ActionButton } from './action-button';
import { ModalWindow } from './new-work-order-window';
import { WindowTitle } from './window-frame';

export interface QuitDialogViewProps {
  readonly state: QuitPromptState;
  readonly locale: Locale;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** The dialog for a given state; separate from the store so markup tests can draw it directly. */
export function QuitDialogView({ state, locale, onCancel, onConfirm }: QuitDialogViewProps) {
  const titleId = 'quit-dialog-title';
  const total = state.open ? state.runs.length + state.chats.length : 0;
  const lines = state.open ? quitModalLines(state, (hidden) => t(locale, QUIT_MODAL_KEYS.more).replace('{n}', String(hidden))) : [];
  return (
    <ModalWindow
      open={state.open}
      label={t(locale, QUIT_MODAL_KEYS.title)}
      titleId={titleId}
      brand={t(locale, QUIT_MODAL_KEYS.title)}
      dataMark="data-quit-dialog"
      scrimMark="data-quit-dialog-scrim"
      compact
      scrimCloses={false}
      onClose={() => {
        if (quitIntent('escape') === 'cancel') onCancel();
      }}
      head={
        <div id={titleId} className="min-w-0">
          <WindowTitle title={t(locale, QUIT_MODAL_KEYS.title)} />
        </div>
      }
      footer={
        <>
          <span className="ml-auto inline-flex [&>button]:h-8">
            <ActionButton variant="neutral" size="md" autoFocus onClick={() => quitIntent('cancelButton') === 'cancel' && onCancel()}>
              {t(locale, QUIT_MODAL_KEYS.cancel)}
            </ActionButton>
          </span>
          <span
            className="inline-flex [&>button]:h-8"
            onKeyDownCapture={(event) => {
              // Enter must not confirm, even with focus on this button; Space still presses it.
              if (event.key === 'Enter' && quitIntent('enter') === undefined) event.preventDefault();
            }}
          >
            <ActionButton variant="primary" danger size="md" onClick={() => quitIntent('confirmButton') === 'confirm' && onConfirm()}>
              {t(locale, QUIT_MODAL_KEYS.stop)}
            </ActionButton>
          </span>
        </>
      }
    >
      <div className="grid gap-3 text-[13px] text-ink">
        <p>{t(locale, QUIT_MODAL_KEYS.body).replace('{n}', String(total))}</p>
        <ul data-quit-list="" className="grid gap-1 rounded-card border border-bord bg-raised px-3 py-2">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`} className="truncate">
              {line}
            </li>
          ))}
        </ul>
        <p className="text-inkdim">{t(locale, QUIT_MODAL_KEYS.note)}</p>
      </div>
    </ModalWindow>
  );
}

export function QuitDialog({ store, locale }: { readonly store: QuitPromptStore; readonly locale: Locale }) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  return <QuitDialogView state={state} locale={locale} onCancel={store.cancel} onConfirm={store.confirm} />;
}
