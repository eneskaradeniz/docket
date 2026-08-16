// Spinner — the kit's in-flight mark (WO-0031). Decorative by default (aria-hidden); label when it
// stands alone.
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-inkdim', className)} role={label ? 'status' : undefined}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {label ? <span className="text-[11px]">{label}</span> : null}
    </span>
  );
}
