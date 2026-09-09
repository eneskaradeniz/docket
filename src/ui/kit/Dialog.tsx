// Dialog — Radix-backed modal (WO-0031): ESC + focus trap + aria for free, our chrome: overlay blur,
// 150ms scale-fade, header/body/footer slots. All copy via props/children (ADR-0007).
import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './cn';

// ADR-0007: the kit carries no copy — callers pass every string, including this aria label.

export function Dialog({
  open,
  onOpenChange,
  title,
  closeAria,
  children,
  footer,
  wide,
  xl,
  narrow,
  stacked,
  onOpenAutoFocus,
  onEscapeKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeAria: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** WO-0059 rev 4: Settings' own width (880px) — the left-menu + content two-column body needs
   *  more room than `wide` gives. */
  xl?: boolean;
  /** Focused confirm width (440px) — the yes/no dialogs. */
  narrow?: boolean;
  /** Opens OVER another open dialog (WO-0032): lifts this pair above the base dialog's z-40/z-50,
   *  so this overlay dims/blurs the dialog beneath (Radix portals share one stacking context and
   *  do not solve this). The app's z-ladder: 20 header · 40/50 base dialog · 60/70 stacked dialog
   *  · 80 chrome floaters (Tooltip, toasts). Supported depth: ONE stack. */
  stacked?: boolean;
  /** Radix focuses the first focusable (the close X) by default; pass this to focus a field instead. */
  onOpenAutoFocus?: (e: Event) => void;
  /** WO-0033: Radix hears ESC on the DOCUMENT in capture — a child's stopPropagation cannot reach
   *  it. Call preventDefault() here to keep the dialog open (an inner layer swallows the ESC). */
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
}) {
  const zi = stacked ? { overlay: 'z-60', content: 'z-70' } : { overlay: 'z-40', content: 'z-50' };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`dialog-rise fixed inset-0 ${zi.overlay} bg-bg/70 backdrop-blur-[2px]`} />
        <DialogPrimitive.Content
          {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
          {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          className={cn(
            `dialog-rise fixed inset-x-4 top-[7vh] ${zi.content} mx-auto flex max-h-[86vh] w-[min(92vw,540px)] flex-col overflow-hidden rounded-lg border border-hairline bg-surface shadow-2xl`,
            narrow && 'w-[min(92vw,440px)]',
            wide && 'w-[min(94vw,680px)]',
            xl && 'w-[min(94vw,880px)]',
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
            <DialogPrimitive.Title className="text-[14px] font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="ibtn" aria-label={closeAria}>
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">{children}</div>
          {footer ? <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline bg-raised/40 px-4 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
