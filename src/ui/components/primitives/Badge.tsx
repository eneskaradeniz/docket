import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'provisional';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  provisional: 'bg-violet-50 text-violet-700 border-violet-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
