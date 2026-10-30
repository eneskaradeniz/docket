// components/action-button.tsx — the one button surface. Primary is the amber fill, neutral
// is the 1px outline, and ghost is borderless — but only for an icon. A text label on a ghost
// is drawn as the outline, because a plain word must not act as a control by itself.
import { Children, isValidElement, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'neutral' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  // The hovers sit behind `enabled:` — a disabled button keeps its own look (U-375).
  primary: 'border-signal bg-signal text-signal-ink font-semibold enabled:hover:brightness-110',
  neutral: 'border-bord bg-transparent text-ink enabled:hover:bg-raised',
  ghost: 'border-transparent bg-transparent text-inkdim enabled:hover:text-ink',
};

const DANGER_PRIMARY_CLASS = 'border-error bg-error text-bg font-semibold enabled:hover:brightness-110';

const SIZE_CLASS: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-[1.75rem] px-[0.625rem] text-[0.78125rem]',
  md: 'h-[2rem] px-[0.875rem] text-[0.84375rem] font-semibold',
};

/** An icon is an svg, an img, or a component that renders one and carries no text of its own. */
const isIconNode = (node: ReactNode): boolean => {
  if (typeof node === 'string') return node.trim() === '';
  if (typeof node === 'number' || typeof node === 'boolean' || node === null || node === undefined) return true;
  if (!isValidElement(node)) return false;
  if (node.type === 'svg' || node.type === 'img') return true;
  if (typeof node.type === 'string') return false;
  const nested = (node.props as { readonly children?: ReactNode }).children;
  const parts = Children.toArray(nested);
  return parts.every(isIconNode);
};

const iconOnly = (children: ReactNode): boolean => {
  const parts = Children.toArray(children).filter((node) => !(typeof node === 'string' && node.trim() === ''));
  return parts.length > 0 && parts.every(isIconNode);
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
  /** A button whose work is running says so to assistive tech. */
  readonly ariaBusy?: boolean;
  /** The accessible name of an icon-only ghost, where the glyph is hidden from the name. */
  readonly ariaLabel?: string;
  /** A primary whose action stops or deletes work: the same fill in the error colour. Still the
   *  primary tier (U-216) — a colour, not a fourth variant. */
  readonly danger?: boolean;
  /** Takes focus when it mounts: a dialog's default answer. */
  readonly autoFocus?: boolean;
  readonly children: ReactNode;
  readonly [dataAttr: `data-${string}`]: unknown;
}

export function ActionButton({
  variant = 'neutral',
  size = 'sm',
  disabled = false,
  onClick,
  title,
  ariaExpanded,
  ariaControls,
  ariaBusy,
  ariaLabel,
  danger = false,
  autoFocus = false,
  children,
  ...rest
}: ActionButtonProps) {
  const look: ButtonVariant = variant === 'ghost' && !iconOnly(children) ? 'neutral' : variant;
  const fill = look === 'primary' && danger ? DANGER_PRIMARY_CLASS : VARIANT_CLASS[look];
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-busy={ariaBusy === true ? true : undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-control border transition-[filter,background-color,color] duration-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${fill} ${SIZE_CLASS[size]}`}
      {...rest}
    >
      {children}
    </button>
  );
}
