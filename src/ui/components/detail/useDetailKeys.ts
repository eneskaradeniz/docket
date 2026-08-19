// useDetailKeys (WO-0031c) — the console's ONE keyboard layer. v4: esc always goes back — layered:
// an open Radix Dialog owns its own Esc first (we stand down while any dialog is open), then the
// detail's inline layers (objection form, plan editor) peel one at a time, and only then does esc
// leave the screen. Enter (outside inputs) fires the rail's PRIMARY when one exists (⏎ onayla, ⏎
// izin ver, ⏎ yeniden dene) — and NEVER while a dialog is open: Enter there belongs to the focused
// dialog button alone (WO-0031d; this also keeps kapat ⏎'süz when its dialog holds the focus).
//
// WO-0031f review (operator): the dialog guard must run in the CAPTURE phase. In the bubble phase
// Radix closes the dialog on the same keydown and React flushes it synchronously — by the time the
// window listener ran, the dialog was GONE, the guard saw nothing, and one Esc closed the dialog
// AND threw the operator back to the board. Capture sees the dialog before Radix does, stands down,
// and Radix alone answers: one Esc, one layer.
import { useEffect } from 'react';

export function useDetailKeys({
  closeTopLayer,
  onBack,
  onPrimary,
}: {
  closeTopLayer: () => boolean;
  onBack: () => void;
  /** The rail's current primary action, if any. */
  onPrimary?: () => void;
}): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // A Radix Dialog (modals, popovers with role=dialog) handles its own Esc; never race it.
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        const closed = closeTopLayer();
        if (!closed) onBack();
        return;
      }
      if (e.key === 'Enter' && onPrimary) {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        onPrimary();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeTopLayer, onBack, onPrimary]);
}
