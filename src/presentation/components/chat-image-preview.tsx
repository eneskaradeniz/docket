// components/chat-image-preview.tsx — lazy data-URL thumbnails for png/jpg/webp attachments (U-331).
import { useEffect, useRef } from 'react';

import { t, type Locale } from '../labels/t';
import { extOf, formatPreviewBytes, isPreviewImageFile, type ChatState, type TrayKind } from '../stores/chat-model';
import type { ChatStore } from '../stores/chat-store';
import { BUTTON, FOCUS, fill } from './chat-style';

const THUMB_BOX = `relative grid h-[3.375rem] w-[4.5rem] flex-none overflow-hidden rounded-card border border-hairline bg-band ${FOCUS}`;
const TRAY_BOX = `relative grid h-9 w-12 flex-none overflow-hidden rounded-card border border-hairline bg-band ${FOCUS}`;
const SKELETON = 'absolute inset-0 bg-raised motion-safe:animate-pulse motion-reduce:animate-none';
const REMOVE = `border-0 bg-transparent pl-1 text-[0.75rem] leading-none text-inkdim hover:text-ink ${FOCUS}`;

/** IntersectionObserver rootMargin must use px or % units only (≈3rem prefetch). */
export const CHAT_IMAGE_PREVIEW_LAZY_ROOT_MARGIN = `${48}px`;

export interface ChatImagePreviewProps {
  readonly id: string;
  readonly name: string;
  readonly kind: TrayKind;
  readonly bytes?: number;
  readonly state: ChatState;
  readonly store: ChatStore;
  readonly locale: Locale;
  readonly variant: 'message' | 'tray';
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
}

export function ChatImagePreview({ id, name, kind, bytes, state, store, locale, variant, onRemove, removeLabel }: ChatImagePreviewProps) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const trayUrl = state.trayPreviews[id];
  const slot = state.previews[id];
  const dataUrl = trayUrl ?? (slot?.status === 'ready' ? slot.dataUrl : undefined);
  const loading = trayUrl === undefined && (slot === undefined || slot.status === 'loading');
  const failed = trayUrl === undefined && slot?.status === 'failed';

  useEffect(() => {
    const node = rootRef.current;
    if (node === null || trayUrl !== undefined) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) store.watchAttachmentPreview(id);
      },
      { rootMargin: CHAT_IMAGE_PREVIEW_LAZY_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, store, trayUrl]);

  useEffect(() => {
    if (state.imageEnlarge !== null) return;
    if (state.imageEnlargeReturn !== id) return;
    rootRef.current?.focus();
    store.clearImageEnlargeReturn();
  }, [id, state.imageEnlarge, state.imageEnlargeReturn, store]);

  if (!isPreviewImageFile(name, kind)) return null;

  const ext = extOf(name);
  const sizeLabel = formatPreviewBytes(bytes ?? 0);
  const openLabel = fill(t(locale, 'chat.image.open'), { name, ext, size: sizeLabel });
  const box = variant === 'tray' ? TRAY_BOX : THUMB_BOX;

  const open = (): void => {
    if (dataUrl === undefined) return;
    store.openImageEnlarge(id);
  };

  const thumb =
    failed ? (
      <span data-chat-image-preview={id} className={`${box} place-content-center gap-1 p-1 text-center`}>
        <span className="text-[0.625rem] leading-3 text-error">{t(locale, 'chat.image.failed')}</span>
        <button type="button" className={BUTTON} onClick={() => store.retryAttachmentPreview(id)}>
          {t(locale, 'chat.image.retry')}
        </button>
      </span>
    ) : (
      <button
        ref={rootRef}
        type="button"
        data-chat-image-preview={id}
        aria-label={openLabel}
        aria-busy={loading ? true : undefined}
        disabled={dataUrl === undefined}
        className={box}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
      >
        {loading ? <span className={SKELETON} aria-hidden="true" /> : null}
        {dataUrl === undefined ? null : <img src={dataUrl} alt="" className="h-full w-full object-cover" />}
      </button>
    );

  if (onRemove === undefined || removeLabel === undefined) return thumb;

  return (
    <span className="inline-flex items-center gap-0">
      {thumb}
      <button type="button" className={REMOVE} aria-label={removeLabel} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}
