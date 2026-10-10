// components/chat-composer.tsx — the dock under the conversation (U-106, U-109, U-110, U-113, U-114,
// U-118): the note rows (runner notices and refusals), the tray of chips, the input with its
// send/stop control, the @ and + menus, the footer line with the tier button and the permission
// dialog. Keys go to the store's `composerKey` — Enter sends, an @ menu with results takes Enter
// and Tab, a composing Enter never sends — and files are read here only as far as the picker, a
// drop or a paste hand them over; the store decides what is accepted.
import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';

import type { ChatReferenceView } from '../../api/chat-views';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  chatActiveGrant,
  chatBusy,
  chatInputBlocked,
  chatTierMinutes,
  chipOfReference,
  fileVerdict,
  FILE_MAX_BYTES,
  noticeOf,
  type ChatState,
  type RefChip,
} from '../stores/chat-model';
import type { ChatFileInput, ChatStore } from '../stores/chat-store';
import { ChatIcon, refIcon } from './chat-icons';
import { BUTTON, BUTTON_GHOST, BUTTON_PRIMARY, FLOATING, FOCUS, ICON_BUTTON, MENU_DESC, MENU_OPTION, MENU_TITLE, REF_CHIP, THUMB, fill } from './chat-style';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.md,.txt,.log,.csv,.json,.pdf';
const PERM_CLASSES = ['open_work_order', 'roadmap_edit', 'definition_edit', 'setting_change'] as const;
const WRAP = 'whitespace-pre-wrap [overflow-wrap:anywhere]';

/** Reads what the picker, a drop or a paste hands over; a file the store would refuse by name or
 *  size is not read into memory at all. */
const readFiles = (files: readonly File[]): Promise<ChatFileInput[]> =>
  Promise.all(
    files.map(
      (file) =>
        new Promise<ChatFileInput>((resolve) => {
          const skip = fileVerdict(file.name, 0).kind !== 'ok' || file.size > FILE_MAX_BYTES;
          if (skip) {
            resolve({ name: file.name, base64: '', size: file.size });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',')[1] ?? '', size: file.size });
          reader.onerror = () => resolve({ name: file.name, base64: '', size: FILE_MAX_BYTES + 1 });
          reader.readAsDataURL(file);
        }),
    ),
  );

const chipLabel = (chip: RefChip, locale: Locale): string => {
  if (chip.label !== '') return chip.label;
  const key: LabelKey = chip.kind === 'workOrder' ? 'chat.scope.fallback.workOrder' : chip.kind === 'project' ? 'chat.scope.fallback.project' : 'chat.ref.fallback.page';
  return t(locale, key);
};

const REMOVE = `border-0 bg-transparent pl-1 font-mono text-[0.75rem] leading-none text-inkdim hover:text-ink ${FOCUS}`;

function Tray({ state, store, locale }: { readonly state: ChatState; readonly store: ChatStore; readonly locale: Locale }) {
  if (state.refs.length === 0 && state.tray.length === 0) return null;
  return (
    <div data-chat-tray="" className="flex flex-wrap gap-1">
      {state.refs.map((chip) => (
        <span key={chip.key} className={REF_CHIP}>
          <ChatIcon name={refIcon(chip.kind)} className="h-3.5 w-3.5 flex-none text-inkdim" />
          {chip.prefix === undefined ? null : <span className="text-inkdim">{`${chip.prefix}/`}</span>}
          <span className="truncate">{chipLabel(chip, locale)}</span>
          <button type="button" className={REMOVE} aria-label={fill(t(locale, 'chat.ref.remove'), { name: chipLabel(chip, locale) })} onClick={() => store.removeRef(chip.key)}>
            ×
          </button>
        </span>
      ))}
      {state.tray.map((file) =>
        file.kind === 'image' ? (
          <span key={file.id} className={`${THUMB} h-9 w-12`}>
            <span className="truncate">{file.name}</span>
            <button type="button" className={REMOVE} aria-label={fill(t(locale, 'chat.file.remove'), { name: file.name })} onClick={() => store.removeFile(file.id)}>
              ×
            </button>
          </span>
        ) : (
          <span key={file.id} className={REF_CHIP}>
            <ChatIcon name="file" className="h-3.5 w-3.5 flex-none text-inkdim" />
            <span className="truncate">{file.name}</span>
            <button type="button" className={REMOVE} aria-label={fill(t(locale, 'chat.file.remove'), { name: file.name })} onClick={() => store.removeFile(file.id)}>
              ×
            </button>
          </span>
        ),
      )}
    </div>
  );
}

const NOTE = 'flex items-center gap-2 rounded-control bg-raised px-3 py-2 text-[0.78125rem] leading-4 text-ink';

function Notes({ state, store, locale, onOpenAccounts, onOpenConsent }: Pick<ComposerProps, 'state' | 'store' | 'locale' | 'onOpenAccounts' | 'onOpenConsent'>) {
  const notice = state.notice === null ? null : noticeOf(state.notice);
  return (
    <>
      {notice === null ? null : (
        <div role="status" data-chat-note={notice.kind} className={NOTE}>
          <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${notice.kind === 'quota' ? 'bg-error' : 'bg-signal'}`} />
          <span className={`min-w-0 ${WRAP}`}>{t(locale, `chat.note.${notice.kind}` as LabelKey)}</span>
          {notice.action === null ? null : (
            <button
              type="button"
              className={`${BUTTON} ml-auto`}
              onClick={() => {
                if (notice.action === 'accounts') onOpenAccounts();
                else onOpenConsent();
                store.clearNotice();
              }}
            >
              {t(locale, notice.action === 'accounts' ? 'chat.note.quota.action' : 'chat.note.consent.action')}
            </button>
          )}
        </div>
      )}
      {state.note === null ? null : (
        <div role="status" data-chat-note="note" className={NOTE}>
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-signal" />
          <span className={`min-w-0 flex-1 ${WRAP}`}>{fill(t(locale, state.note.key), state.note.values ?? {})}</span>
          <button type="button" className={`${REMOVE} flex-none pr-1`} aria-label={t(locale, 'chat.note.dismiss')} onClick={() => store.dismissNote()}>
            ×
          </button>
        </div>
      )}
    </>
  );
}

function AtMenu({ state, store, locale }: Pick<ComposerProps, 'state' | 'store' | 'locale'>) {
  const { items, index, q, loading } = state.at;
  return (
    <div data-chat-menu="at" role="listbox" aria-label={t(locale, 'chat.at.section')} className={`${FLOATING} absolute inset-x-3 bottom-full max-h-60 overflow-auto`}>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-[0.78125rem] leading-4 text-inkdim">
          {t(locale, loading ? 'chat.at.loading' : q === '' ? 'chat.at.hint' : 'chat.at.none')}
        </div>
      ) : (
        <>
          <div className="px-3 pb-1 pt-2 text-[0.75rem] leading-4 text-inkdim">{t(locale, 'chat.at.section')}</div>
          {items.map((item: ChatReferenceView, position) => {
            const chip = chipOfReference(item);
            return (
              <button
                key={chip.key}
                type="button"
                role="option"
                aria-selected={position === index}
                className={MENU_OPTION}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => store.pickRef(item)}
              >
                <ChatIcon name={refIcon(chip.kind)} className="h-3.5 w-3.5 text-inkdim" />
                <span className={MENU_TITLE}>
                  {chip.prefix === undefined ? null : <span className="font-normal text-inkdim">{`${chip.prefix}/`}</span>}
                  {chip.label}
                </span>
                <span />
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

function PlusMenu({ store, locale, pick }: { readonly store: ChatStore; readonly locale: Locale; readonly pick: () => void }) {
  return (
    <div data-chat-menu="plus" role="menu" className={`${FLOATING} absolute inset-x-3 bottom-full`}>
      <button type="button" role="menuitem" className={MENU_OPTION} onClick={pick}>
        <ChatIcon name="file" className="h-3.5 w-3.5 text-inkdim" />
        <span>
          <span className={MENU_TITLE}>{t(locale, 'chat.plus.file')}</span>
          <span className={MENU_DESC}>{t(locale, 'chat.plus.file.desc')}</span>
        </span>
        <span />
      </button>
      <button type="button" role="menuitem" className={MENU_OPTION} onClick={() => store.attachScreen()}>
        <ChatIcon name="page" className="h-3.5 w-3.5 text-inkdim" />
        <span>
          <span className={MENU_TITLE}>{t(locale, 'chat.plus.screen')}</span>
          <span className={MENU_DESC}>{t(locale, 'chat.plus.screen.desc')}</span>
        </span>
        <span />
      </button>
      <button type="button" role="menuitem" className={MENU_OPTION} onClick={() => store.openAt()}>
        <ChatIcon name="mention" className="h-3.5 w-3.5 text-inkdim" />
        <span>
          <span className={MENU_TITLE}>{t(locale, 'chat.plus.ref')}</span>
          <span className={MENU_DESC}>{t(locale, 'chat.plus.ref.desc')}</span>
        </span>
        <span />
      </button>
    </div>
  );
}

function PermDialog({ state, store, locale }: Pick<ComposerProps, 'state' | 'store' | 'locale'>) {
  const grant = chatActiveGrant(state);
  const minutes = chatTierMinutes(state);
  return (
    <div data-chat-perm="" role="dialog" aria-label={t(locale, 'chat.perm.aria')} className={`${FLOATING} absolute inset-x-3 bottom-full grid gap-3 p-3`}>
      {grant !== null && minutes !== null ? (
        <>
          <h3 className="m-0 text-[0.875rem] font-semibold leading-5 text-ink">{fill(t(locale, 'chat.perm.on.title'), { n: minutes })}</h3>
          <p className="m-0 text-[0.78125rem] leading-4 text-inkdim">{t(locale, 'chat.perm.on.body')}</p>
          <div className="grid gap-1 text-[0.875rem] leading-5 text-ink">
            {PERM_CLASSES.filter((name) => grant.classes.includes(name)).map((name) => (
              <span key={name}>{`✓ ${t(locale, `chat.perm.class.${name}` as LabelKey)}`}</span>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON} onClick={() => void store.revoke()}>
              {t(locale, 'chat.perm.revoke')}
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 className="m-0 text-[0.875rem] font-semibold leading-5 text-ink">{t(locale, 'chat.perm.off.title')}</h3>
          <p className="m-0 text-[0.78125rem] leading-4 text-inkdim">{t(locale, 'chat.perm.off.body')}</p>
          <div className="grid gap-1">
            {PERM_CLASSES.map((name) => (
              <label key={name} className="flex min-h-7 items-center gap-2 text-[0.875rem] leading-5 text-ink">
                <input
                  type="checkbox"
                  checked={state.permDraft.includes(name)}
                  className={`h-4 w-4 accent-signal ${FOCUS}`}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => store.setPermClass(name, event.target.checked)}
                />
                <span>
                  <b className="font-semibold">{t(locale, `chat.perm.class.${name}` as LabelKey)}</b>{' '}
                  <span className="text-inkdim">{`· ${t(locale, `chat.perm.class.${name}.desc` as LabelKey)}`}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="border-t border-hairline pt-2 text-[0.75rem] leading-4 text-inkdim">{t(locale, 'chat.perm.never')}</div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={BUTTON_GHOST} onClick={() => store.closePerm()}>
              {t(locale, 'chat.perm.cancel')}
            </button>
            <button type="button" className={BUTTON_PRIMARY} disabled={state.permDraft.length === 0} onClick={() => void store.grant()}>
              {t(locale, 'chat.perm.grant')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export interface ComposerProps {
  readonly state: ChatState;
  readonly store: ChatStore;
  readonly locale: Locale;
  readonly onOpenAccounts: () => void;
  readonly onOpenConsent: () => void;
}

export function ChatComposer({ state, store, locale, onOpenAccounts, onOpenConsent }: ComposerProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const busy = chatBusy(state);
  const blocked = chatInputBlocked(state);
  const canSend = state.draft.trim() !== '' && !busy && !blocked && state.uploading === 0;
  const minutes = chatTierMinutes(state);

  // The composer takes focus when the panel opens, a prefill lands, a chip is committed or the
  // history view hands the dock back.
  useEffect(() => {
    if (state.open && state.view === 'chat') textRef.current?.focus();
  }, [state.focusTick, state.open, state.view]);

  // The text grows to eight rem, then scrolls; the height is measured in rem, never px.
  useEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    el.style.height = `${Math.min(el.scrollHeight / root, 8)}rem`;
  }, [state.draft]);

  const take = (files: readonly File[]): void => {
    void readFiles(files).then((read) => store.addFiles(read));
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    take(files);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDrag(false);
    take(Array.from(event.dataTransfer.files));
  };

  return (
    <div data-chat-dock="" className="relative grid gap-2 px-3 pb-3 pt-2">
      {state.menu === 'at' ? <AtMenu state={state} store={store} locale={locale} /> : null}
      {state.menu === 'plus' ? <PlusMenu store={store} locale={locale} pick={() => fileRef.current?.click()} /> : null}
      <Notes state={state} store={store} locale={locale} onOpenAccounts={onOpenAccounts} onOpenConsent={onOpenConsent} />
      <Tray state={state} store={store} locale={locale} />
      <div
        data-chat-input=""
        className={`flex items-end gap-1 rounded-panel border bg-raised p-2 focus-within:border-signal-soft ${drag ? 'border-dashed border-signal-soft' : 'border-bord'}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <button type="button" data-chat-plus="" className={ICON_BUTTON} aria-label={t(locale, 'chat.add')} title={t(locale, 'chat.add')} aria-haspopup="menu" onClick={() => store.openPlus()}>
          <ChatIcon name="plus" className="h-4 w-4" />
        </button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden tabIndex={-1} aria-label={t(locale, 'chat.plus.file')} className={FOCUS} onChange={(event: ChangeEvent<HTMLInputElement>) => {
          take(Array.from(event.target.files ?? []));
          event.target.value = '';
        }} />
        <textarea
          ref={textRef}
          data-chat-text=""
          rows={1}
          value={state.draft}
          disabled={blocked}
          placeholder={t(locale, 'chat.input.placeholder')}
          aria-label={t(locale, 'chat.input.aria')}
          className={`max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[0.875rem] leading-5 text-ink outline-none placeholder:text-inkdim disabled:opacity-60 ${FOCUS}`}
          onChange={(event) => store.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (store.composerKey({ key: event.key, shiftKey: event.shiftKey, composing: event.nativeEvent.isComposing })) event.preventDefault();
          }}
          onPaste={onPaste}
        />
        {busy ? (
          <button type="button" data-chat-stop="" className={`grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-ink text-bg ${FOCUS}`} aria-label={t(locale, 'chat.stop')} onClick={() => void store.cancel()}>
            <ChatIcon name="stop" className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            data-chat-send=""
            className={`grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-ink text-bg disabled:pointer-events-none disabled:bg-hairline disabled:text-inkdim ${FOCUS}`}
            aria-label={t(locale, 'chat.send')}
            disabled={!canSend}
            onClick={() => void store.send()}
          >
            <ChatIcon name="send" className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 font-mono text-[0.6875rem] font-medium leading-4 text-inkdim">
        <button
          type="button"
          data-chat-tier=""
          aria-haspopup="dialog"
          aria-expanded={state.permOpen}
          className={`rounded-control border-0 bg-transparent px-1 font-mono text-[0.6875rem] font-medium leading-4 underline underline-offset-2 hover:text-ink ${minutes === null ? 'text-inkdim' : 'text-signal-soft'} ${FOCUS}`}
          onClick={() => store.togglePerm()}
        >
          {minutes === null ? t(locale, 'chat.tier.suggest') : fill(t(locale, 'chat.tier.apply'), { n: minutes })}
        </button>
        {state.usage?.account === undefined ? null : (
          <>
            <span>·</span>
            <span className="truncate">{state.usage.account.label}</span>
          </>
        )}
        {state.usage === null ? null : (
          <>
            <span>·</span>
            <span>{fill(t(locale, 'chat.usage.month'), { n: state.usage.month.messages })}</span>
          </>
        )}
      </div>
      {state.permOpen ? <PermDialog state={state} store={store} locale={locale} /> : null}
    </div>
  );
}
