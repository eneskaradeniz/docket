// components/action-button.tsx — the one button surface of the screens: a quiet bordered default,
// the signal-amber primary for the decision that matters, and a borderless ghost. A disabled
// button keeps its shape and dims — a disabled state must stay legible, not vanish.
import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'neutral' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'border-signal bg-signal text-black font-semibold hover:brightness-110',
  neutral: 'border-hairline bg-transparent text-ink hover:bg-raised',
  ghost: 'border-transparent bg-transparent text-inkdim hover:text-ink',
};

const SIZE_CLASS: Readonly<Record<ButtonSize, string>> = {
  sm: 'px-2.5 py-1 text-[12.5px]',
  md: 'px-3.5 py-1.5 text-[13.5px] font-semibold',
};

export interface ActionButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

export function ActionButton({ variant = 'neutral', size = 'sm', disabled = false, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border transition-[filter,background-color,color] duration-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}`}
    >
      {children}
    </button>
  );
}
