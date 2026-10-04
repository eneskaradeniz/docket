// components/account-editor-dialog.tsx — the AccountEditor (U-43): a centred dialog, 820×600 and
// never larger than the window, with a head (mark, "Asistan · hesap", `path · host`, billing tag,
// status, ×), vertical tabs on the left — Genel · Kullanım · Limitler · Modeller — the selected
// tab's body, and a footer. In the wizard the footer says changes are saved when setup finishes
// and offers Vazgeç and Kaydet; in Settings every change saves on commit (U-29), so the footer says
// so and closes. Esc or a click outside closes (in the wizard that is Vazgeç); an open Listbox
// takes the Esc first. Both hosts draw this one dialog.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { t } from '../labels/t';
import type { Billing } from '../stores/account-groups';
import type { LampTone } from '../stores/candidates';
import { EDITOR_TABS, type EditorTab } from '../stores/account-editor';
import { ActionButton } from './action-button';
import { AccountEditorPanels, TAB_KEY, type AccountEditorProps } from './account-editor';
import { BillingTag } from './account-groups';
import { StatusLamp } from './status-lamp';

export interface AccountEditorDialogProps extends AccountEditorProps {
  readonly host: 'wizard' | 'settings';
  /** The provider mark, already drawn. */
  readonly mark: ReactNode;
  /** "Asistan · hesap", resolved. */
  readonly title: string;
  /** `path · host`, resolved; empty omits the line. */
  readonly meta: string;
  readonly billing: Billing;
  readonly viaKey: boolean;
  readonly status: { readonly tone: LampTone; readonly text: string };
  /** × · Esc · a click outside. In the wizard it drops the working copy. */
  readonly onClose: () => void;
  /** The wizard's Kaydet. */
  readonly onSave?: () => void;
  /** Settings' "Hesap görünümünü aç": closes the panel and opens the account's own view (U-30). */
  readonly onOpenView?: () => void;
}

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="m4 4 8 8M12 4 4 12" />
  </svg>
);

export function AccountEditorDialog(props: AccountEditorDialogProps) {
  const { locale, store, host, onClose, onSave, onOpenView } = props;
  const state = useSyncExternalStore(store.subscribe, store.state);
  const tabs: readonly EditorTab[] = (props.tabs ?? EDITOR_TABS).filter((tab) => tab !== 'models' || props.models !== undefined);
  const dialog = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<EditorTab, HTMLButtonElement | null>>>({});

  // The selected tab takes focus when the dialog opens.
  useEffect(() => {
    tabRefs.current[state.tab]?.focus();
    // Opening is the only moment; later tab changes keep the focus where the user put it.
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    // Focus stays inside the dialog, wrapping both ways.
    event.preventDefault();
    event.stopPropagation();
    const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button:not([disabled]), select, textarea, [tabindex="0"]') ?? [])];
    if (stops.length === 0) return;
    const at = document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement) : -1;
    const next = at === -1 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
    stops[next]?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-editor-scrim=""
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-editor-title"
        onKeyDown={onKeyDown}
        className="grid h-[600px] max-h-full w-[820px] max-w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-panel border border-bord bg-surface shadow-2xl"
        data-account-editor-dialog={host}
      >
        <header className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-control border border-hairline bg-raised text-ink">{props.mark}</span>
          <div className="min-w-0">
            <h2 id="account-editor-title" className="m-0 truncate text-[17px] font-bold tracking-[-0.01em] text-ink">
              {props.title}
            </h2>
            {props.meta !== '' ? <div className="truncate font-mono text-[12px] text-inkdim">{props.meta}</div> : null}
          </div>
          <span className="ml-auto flex flex-none items-center gap-3">
            <BillingTag locale={locale} billing={props.billing} viaKey={props.viaKey} />
            <StatusLamp tone={props.status.tone}>{props.status.text}</StatusLamp>
            <button
              type="button"
              onClick={onClose}
              aria-label={t(locale, 'settings.close')}
              title={t(locale, 'settings.close')}
              className="grid h-[30px] w-[30px] flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
            >
              <CloseIcon />
            </button>
          </span>
        </header>
        <div className="grid min-h-0 grid-cols-[180px_minmax(0,1fr)]">
          <div role="tablist" aria-orientation="vertical" className="grid content-start gap-0.5 border-r border-hairline bg-band px-2.5 py-3">
            {tabs.map((tab, index) => (
              <button
                key={tab}
                ref={(element) => {
                  tabRefs.current[tab] = element;
                }}
                type="button"
                role="tab"
                aria-selected={state.tab === tab}
                onClick={() => store.setTab(tab)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  const next = tabs[(index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length];
                  if (next === undefined) return;
                  store.setTab(next);
                  tabRefs.current[next]?.focus();
                }}
                className={`flex items-center gap-2 rounded-control px-2.5 py-2 text-left font-semibold ${
                  state.tab === tab ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--bord)]' : 'text-inkdim hover:text-ink'
                }`}
              >
                {t(locale, TAB_KEY[tab])}
              </button>
            ))}
          </div>
          <div data-editor-body="" className="min-h-0 overflow-y-auto px-6 pb-6 pt-5">
            <AccountEditorPanels {...props} />
          </div>
        </div>
        <footer className="flex items-center gap-2 border-t border-hairline px-5 py-3">
          <span className="mr-auto flex items-center gap-3 text-[12.5px] text-inkdim">
            {t(locale, host === 'wizard' ? 'editor.footer.draft' : 'editor.footer.saves')}
            {host === 'settings' && onOpenView !== undefined ? (
              <button type="button" onClick={onOpenView} className="rounded-control text-ink underline decoration-bord underline-offset-4 hover:decoration-ink">
                {t(locale, 'editor.openView')}
              </button>
            ) : null}
          </span>
          {host === 'wizard' ? (
            <>
              <ActionButton variant="ghost" size="md" onClick={onClose}>
                {t(locale, 'wizard.editor.cancel')}
              </ActionButton>
              <ActionButton variant="primary" size="md" onClick={() => onSave?.()}>
                {t(locale, 'wizard.editor.save')}
              </ActionButton>
            </>
          ) : (
            <ActionButton variant="neutral" size="md" onClick={onClose}>
              {t(locale, 'editor.footer.close')}
            </ActionButton>
          )}
        </footer>
      </div>
    </div>
  );
}
