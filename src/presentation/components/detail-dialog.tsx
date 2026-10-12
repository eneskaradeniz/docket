// components/detail-dialog.tsx — the detail's inline dialog behaviour (A3, U-233): the
// reject-reason box, the deploy confirmation form and the close confirmation all trap Tab
// inside themselves while they are up, move focus into themselves on open, and hand it back to
// the opening control on Esc or close — the opening control keeps its accessible name because
// focus returns to the very element that owns it. The trap is inline, not modal: the page
// behind it stays in place, exactly as the approved prototype draws it.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface InlineDialogProps {
  /** The trap runs while `active` is true; the children stay rendered either way when `render` is
   *  controlled by the caller — the reject box hides itself, the caller decides. */
  readonly active: boolean;
  /** Called on Esc; the caller closes the box and focus returns to the opener. */
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/** The trap's Tab walk, in the DOM order the stops appear in. */
const stopsOf = (root: HTMLElement): readonly HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
];

export function InlineDialog({ active, onClose, children }: InlineDialogProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const restore = useRef<HTMLElement | null>(null);

  // Focus moves in on open — to the first stop (the reason box's textarea, the form's first
  // field) — and returns to whoever opened the trap when it closes.
  useEffect(() => {
    if (!active) return;
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = holder.current === null ? undefined : stopsOf(holder.current)[0];
    first?.focus();
    return () => {
      restore.current?.focus();
      restore.current = null;
    };
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = holder.current;
    if (root === null) return;
    const stops = stopsOf(root);
    if (stops.length === 0) return;
    event.preventDefault();
    const current = document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement) : -1;
    const next =
      current === -1
        ? stops[event.shiftKey ? stops.length - 1 : 0]
        : stops[(current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus();
  };

  return (
    <div data-detail-trap={active ? 'on' : undefined} onKeyDown={onKeyDown} ref={holder}>
      {children}
    </div>
  );
}
