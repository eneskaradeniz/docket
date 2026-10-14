// components/permission-prompt.tsx — Docket AI setup read permission (U-272 … U-279): one modal at a
// time, session-only grant, Esc denies and returns focus to the thread opener.
import { useEffect, useRef } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { SetupPermissionPrompt } from '../stores/new-project';

export interface PermissionPromptProps {
  readonly open: boolean;
  readonly prompt: SetupPermissionPrompt | null;
  readonly locale: Locale;
  readonly onDeny: () => void;
  readonly onAllow: () => void;
  /** Focus returns here when the dialog closes (U-278). */
  readonly returnFocusRef: { readonly current: HTMLElement | null };
}

export function PermissionPrompt({ open, prompt, locale, onDeny, onAllow, returnFocusRef }: PermissionPromptProps) {
  const denyRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && prompt !== null) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      denyRef.current?.focus();
    } else if (!open && restoreRef.current !== null) {
      const target = returnFocusRef.current ?? restoreRef.current;
      target?.focus();
      restoreRef.current = null;
    }
  }, [open, prompt, returnFocusRef]);

  if (!open || prompt === null) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDeny();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    const stops = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    if (stops.length === 0) return;
    const at = document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement) : -1;
    const next = at === -1 ? stops[0] : stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus();
  };

  const titleKey: LabelKey = 'setup.permission.title';

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-5" data-setup-permission-scrim="">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, titleKey)}
        onKeyDown={onKeyDown}
        className="grid w-full max-w-lg gap-4 rounded-panel border border-bord bg-surface p-5 shadow-2xl"
        data-setup-permission=""
      >
        <h2 className="m-0 text-[1rem] font-semibold text-ink">{t(locale, titleKey)}</h2>
        <p className="m-0 font-mono text-[0.8125rem] leading-[1.25rem] text-ink" data-setup-permission-path="">
          {prompt.path}
        </p>
        <p className="m-0 text-[0.8125rem] leading-[1.25rem] text-inkdim">{prompt.reason}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={denyRef}
            type="button"
            onClick={onDeny}
            data-setup-permission-deny=""
            className="h-[2rem] rounded-control border border-bord bg-transparent px-[0.875rem] text-[0.84375rem] font-semibold text-ink hover:bg-raised"
          >
            {t(locale, 'setup.permission.deny')}
          </button>
          <button
            type="button"
            onClick={onAllow}
            data-setup-permission-allow=""
            className="h-[2rem] rounded-control border border-signal bg-signal px-[0.875rem] text-[0.84375rem] font-semibold text-signal-ink hover:brightness-110"
          >
            {t(locale, 'setup.permission.allow')}
          </button>
        </div>
      </div>
    </div>
  );
}
