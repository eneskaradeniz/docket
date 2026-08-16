// Input / Textarea / Field — the kit's form primitives (WO-0031). Field owns label/hint/error copy
// (passed by the call site from labels.ts — components carry no display text, ADR-0007).
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const base =
  'w-full rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-inkdim/70 focus-visible:border-signal focus-visible:outline-none transition-colors';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(base, 'min-h-16 resize-y font-mono text-xs leading-relaxed', className)} {...props} />;
});

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-[11px] text-inkdim">{hint}</span> : null}
      {error ? <span className="mt-1 block text-[11px] text-error">{error}</span> : null}
    </label>
  );
}
