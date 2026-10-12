// components/detail-row-menu.tsx — the detail header's ⋯ menu (A4, U-234): a bordered icon
// button with the menu-button keyboard model — Enter/Space/ArrowDown open and focus the first
// item, ArrowUp opens and focuses the last, ↑/↓ move, Home/End jump, Esc closes and restores
// focus to the button, Tab closes without restoring. A click outside closes it too. The menu
// carries exactly one item today (İş emrini kapat…); the model is the point.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';

export interface DetailRowMenuItem {
  readonly key: LabelKey;
  readonly onSelect: () => void;
}

export interface DetailRowMenuProps {
  readonly locale: Locale;
  readonly items: readonly DetailRowMenuItem[];
}

export function DetailRowMenu({ locale, items }: DetailRowMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  // A pointer outside the open menu closes it — the menu never survives a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) !== true) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const focusItem = (index: number): void => {
    const stops = menuRef.current === null ? [] : [...menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    stops[((index % stops.length) + stops.length) % stops.length]?.focus();
  };

  const openMenu = (fromEnd: boolean): void => {
    setOpen(true);
    // The menu is in the document on the render after this click; focus lands then.
    requestAnimationFrame(() => focusItem(fromEnd ? -1 : 0));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(false);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const stops = menuRef.current === null ? [] : [...menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current =
      document.activeElement instanceof HTMLElement ? stops.indexOf(document.activeElement as HTMLButtonElement) : -1;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(-1);
    }
  };

  return (
    <span className="relative">
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t(locale, 'detail.menu.label')}
        onClick={() => (open ? setOpen(false) : openMenu(false))}
        onKeyDown={onKeyDown}
        className="inline-grid h-8 w-8 place-items-center rounded-control border border-bord bg-transparent text-[1rem] leading-none text-inkdim hover:text-ink"
        data-detail-menu
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t(locale, 'detail.menu.label')}
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-10 z-30 min-w-[12.5rem] rounded-card border border-bord bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                item.onSelect();
              }}
              className="block w-full rounded-control border-0 bg-transparent px-3 py-2 text-left text-[0.8125rem] text-ink hover:bg-raised"
            >
              {t(locale, item.key)}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
