// ToastHost (WO-0031c / v4 §5) — the top-right notification surface: haber (amber, breathing lamp,
// click → the work order's detail), hata (red, persistent, manual close only), teyit (green, ~2.6s).
// The RULE lives with the caller, not here: an on-screen action's result is a screen change, never a
// toast — only events from a work order you are NOT looking at (and rule-change confirmations) toast.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../kit';
import { UI } from '../data/labels';

export interface ToastItem {
  id: number;
  kind: 'news' | 'error' | 'confirm';
  title: string;
  body?: string;
  /** news: navigate on click. */
  onActivate?: () => void;
}

let nextId = 1;
const listeners = new Set<(toasts: ToastItem[]) => void>();
let toasts: ToastItem[] = [];
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const l of listeners) l(toasts);
}

function dismiss(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

export const toast = {
  push(item: Omit<ToastItem, 'id'>, autoDismissMs?: number): number {
    const id = nextId++;
    toasts = [...toasts, { ...item, id }].slice(-4); // a small stack; old falls off
    emit();
    const ttl = autoDismissMs ?? (item.kind === 'confirm' ? 2600 : item.kind === 'news' ? 8000 : undefined);
    if (ttl !== undefined) timers.set(id, setTimeout(() => dismiss(id), ttl));
    return id;
  },
  dismiss,
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>(toasts);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-14 z-80 flex w-[296px] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          data-toast={t.kind}
          className={cn(
            'pointer-events-auto flex items-stretch overflow-hidden rounded-md border bg-surface/95 shadow-lg backdrop-blur',
            t.kind === 'error' ? 'border-error/50' : t.kind === 'news' ? 'border-signal/40' : 'border-proceed/40',
          )}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <div className={cn('lamp', t.kind === 'error' ? 'lamp-error' : t.kind === 'news' ? 'lamp-signal-breathe' : 'lamp-done')} />
          <button
            type="button"
            className={cn('min-w-0 flex-1 rounded px-3 py-2 text-left', t.onActivate ? 'irow' : '')}
            onClick={() => {
              t.onActivate?.();
              dismiss(t.id);
            }}
          >
            <p className={cn('truncate text-[12.5px] font-semibold', t.kind === 'error' ? 'text-error' : 'text-ink')}>{t.title}</p>
            {t.body ? <p className="mt-0.5 truncate text-[11.5px] text-inkdim">{t.body}</p> : null}
          </button>
          {t.kind === 'error' ? (
            <button
              type="button"
              aria-label={UI.close}
              onClick={() => dismiss(t.id)}
              className="ibtn shrink-0"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
