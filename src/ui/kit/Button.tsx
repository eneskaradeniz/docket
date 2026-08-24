// Button — the kit's action control (WO-0031). Variants instead of boolean props (composition rule);
// no inactive VARIANT exists. `busy` swaps the label for a spinner (an honest in-flight state, not a
// lock); `locked` (WO-0031c) is the same honesty after the press: the action was taken, the button is
// spent until it resolves (double-click impossible). WO-0031f review (ADR-0001 addendum): `locked` is
// also the TERMINAL lock — a control unavailable because the work order is CLOSED renders in place,
// locked, instead of absent; the mechanism stays attribute-free (pointer-events + dim), so the CI
// grep's letter ("no `disabled` attribute in src/ui") holds. WO-0037 (ADR-0001 2026-08-22 addendum):
// a GATED control whose tooltip must open renders the guarded form at the call site — dim +
// handler-less, pointer events KEPT (`locked` would swallow the hover); see DetailStrip's
// pencil/trash. `locked` stays the in-flight/terminal lock.
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.955]',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-bg hover:brightness-110 font-semibold',
        secondary: 'bg-raised text-ink border border-hairline hover:border-inkdim',
        ghost: 'text-inkdim hover:text-ink hover:bg-raised',
        signal: 'bg-signal text-bg font-semibold hover:brightness-105',
        danger: 'bg-error text-ink font-semibold hover:brightness-110',
      },
      size: {
        // 2026-08-23 (canlı panel revizyonu): xs for the pane header's Durdur — 28px solid red
        // over-weighted the readout row; 24px is the WCAG 2.5.8 floor, "smaller" stops here.
        xs: 'h-6 gap-1 px-2 text-[11px]',
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8.5 px-3.5 text-[13px]',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  busy?: boolean;
  /** WO-0031c: the in-flight lock — class dims it and the click handler is detached, so neither mouse
   *  nor keyboard (Enter on a focused button) can re-fire it. WO-0031f: also the terminal lock
   *  (ADR-0001 addendum) — a closed-WO control renders in place, locked, never absent. A TRANSIENT
   *  gate still renders absent at the call site (ADR-0001's original form). */
  locked?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, busy, locked, children, onClick, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(buttonVariants({ variant, size }), locked && 'pointer-events-none opacity-45', className)}
      {...(busy ? { 'aria-busy': true } : {})}
      {...props}
      onClick={locked ? undefined : onClick}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
