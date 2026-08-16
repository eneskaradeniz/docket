// Dialog — Radix-backed modal (WO-0031): ESC + focus trap + aria for free, our chrome: overlay blur,
// 150ms scale-fade, header/body/footer slots. All copy via props/children (ADR-0007).
import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './cn';

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-[2px] data-[state=open]:animate-[rise_0.15s_ease-out]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[12%] z-50 max-h-[78vh] w-[min(92vw,540px)] -translate-x-1/2 overflow-hidden rounded-lg border border-hairline bg-surface shadow-2xl data-[state=open]:animate-[rise_0.15s_ease-out]',
            wide && 'w-[min(94vw,680px)]',
          )}
        >
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <DialogPrimitive.Title className="text-[14px] font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded p-1 text-inkdim transition-colors hover:bg-raised hover:text-ink" aria-label="kapat">
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[calc(78vh-8.5rem)] overflow-y-auto px-4 py-3.5">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-hairline bg-raised/40 px-4 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
