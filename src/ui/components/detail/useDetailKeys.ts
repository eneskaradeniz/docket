// useDetailKeys (WO-0031c) — the console's ONE keyboard layer. v4: esc always goes back — layered:
// an open Radix Dialog owns its own Esc first (we stand down while any dialog is open), then the
// detail's inline layers (objection form, close note, delete confirm) peel one at a time, and only
// then does esc leave the screen. Enter bindings arrive with c2's rail-primary contract.
import { useEffect } from 'react';

export function useDetailKeys({ closeTopLayer, onBack }: { closeTopLayer: () => boolean; onBack: () => void }): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // A Radix Dialog (modals, popovers with role=dialog) handles its own Esc; never race it.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const closed = closeTopLayer();
      if (!closed) onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTopLayer, onBack]);
}
