// components/chat-image-enlarge-dialog.tsx — keyboard-safe enlarge dialog for chat images (U-332).
import { useEffect, useRef } from 'react';

import { t, type Locale } from '../labels/t';
import type { ImageEnlargeState } from '../stores/chat-model';
import type { ChatStore } from '../stores/chat-store';
import { BUTTON } from './chat-style';

export interface ChatImageEnlargeDialogProps {
  readonly enlarge: ImageEnlargeState;
  readonly store: ChatStore;
  readonly locale: Locale;
}

export function ChatImageEnlargeDialog({ enlarge, store, locale }: ChatImageEnlargeDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const item = enlarge.items[enlarge.index];

  useEffect(() => {
    closeRef.current?.focus();
  }, [enlarge.index]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      store.closeImageEnlarge();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      store.stepImageEnlarge(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      store.stepImageEnlarge(1);
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    const stops = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    if (stops.length === 0) return;
    const at = document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement) : -1;
    const next = stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus();
  };

  if (item === undefined) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-bg/80 p-4" data-chat-image-scrim="">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-image-enlarge-title"
        data-chat-image-enlarge=""
        className="grid w-full max-w-3xl gap-3 rounded-panel border border-bord bg-surface p-4 shadow-elevation-overlay"
        onKeyDown={onKeyDown}
      >
        <h2 id="chat-image-enlarge-title" className="m-0 truncate font-mono text-[0.875rem] font-semibold leading-5 text-ink">
          {item.name}
        </h2>
        <div className="grid max-h-[min(32rem,70vh)] place-items-center overflow-auto rounded-card border border-hairline bg-band p-2">
          <img src={item.dataUrl} alt="" className="max-h-[min(30rem,68vh)] max-w-full object-contain" />
        </div>
        <p className="m-0 text-[0.75rem] leading-4 text-inkdim">{t(locale, 'chat.image.modal.hint')}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={BUTTON} disabled={enlarge.items.length < 2} onClick={() => store.stepImageEnlarge(-1)}>
            {t(locale, 'chat.image.modal.prev')}
          </button>
          <button type="button" className={BUTTON} disabled={enlarge.items.length < 2} onClick={() => store.stepImageEnlarge(1)}>
            {t(locale, 'chat.image.modal.next')}
          </button>
          <button ref={closeRef} type="button" className={BUTTON} onClick={() => store.closeImageEnlarge()}>
            {t(locale, 'chat.image.modal.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
