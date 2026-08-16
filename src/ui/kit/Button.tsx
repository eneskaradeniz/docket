// Button — the kit's action control (WO-0031). Variants instead of boolean props (composition rule);
// NO inactive variant exists — an unavailable action is absent at the call site (ADR-0001), never a
// greyed button. `busy` swaps the label for a spinner (an honest in-flight state, not a lock).
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
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
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, busy, children, ...props },
  ref,
) {
  return (
    <button ref={ref} type="button" className={cn(buttonVariants({ variant, size }), className)} {...(busy ? { 'aria-busy': true } : {})} {...props}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
