// Segmented — the kit's inline one-of-many picker (WO-0031): replaces the role tabs and the SADE/DETAY
// toggles. Uncontrolled-free: value/onValueChange; no inactive items (unavailable options are absent).
import { cn } from './cn';

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-0.5 rounded-md border border-hairline bg-bg p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onValueChange(o.value)}
          className={cn(
            'rounded font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
            o.value === value ? 'bg-raised text-ink' : 'text-inkdim hover:bg-raised/60 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
