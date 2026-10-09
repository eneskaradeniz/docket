// components/action-button.tsx — the one button surface of the screens, in the book's button
// grammar: a bordered quiet default (the book's stronger --bord edge, not a hairline), the
// signal-amber primary whose ink is the token --signal-ink, and a borderless ghost. A disabled
// button keeps its shape and dims — a disabled state must stay legible, not vanish.
import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'neutral' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'border-signal bg-signal text-signal-ink font-semibold hover:brightness-110',
  neutral: 'border-bord bg-transparent text-ink hover:bg-raised',
  ghost: 'border-transparent bg-transparent text-inkdim hover:text-ink',
};

const SIZE_CLASS: Readonly<Record<ButtonSize, string>> = {
  sm: 'px-2.5 py-1 text-[0.78125rem]',
  md: 'px-3.5 py-[0.4375rem] text-[0.84375rem] font-semibold',
};

export interface ActionButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  /** The quiet hint a screen offers beside the label (the ⓘ grammar's hover text). */
  readonly title?: string;
  /** A row that folds content (the account card's model list) speaks its standing. */
  readonly ariaExpanded?: boolean;
  /** The id of the region an expanded button folds (Ayrıntı's in-place detail, U-48). */
  readonly ariaControls?: string;
  readonly children: ReactNode;
}

export function ActionButton({ variant = 'neutral', size = 'sm', disabled = false, onClick, title, ariaExpanded, ariaControls, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      className={`inline-flex items-center justify-center gap-1.5 rounded-control border transition-[filter,background-color,color] duration-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}`}
    >
      {children}
    </button>
  );
}
