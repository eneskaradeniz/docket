// components/setting-row.tsx — the one anatomy of every setting (U-29): title and one sentence of
// purpose on the left, one control on the right, an optional "Önerilenden farklı" line with its
// "Önerilene dön" intent, the "Kaydedildi" flag, a U-8 failure under the row, and an optional
// disclosure for the setting's deeper parameters that starts open when its content differs from
// the recommendation. Purely presentational; copy arrives resolved.
import { useState, type ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';

export interface SettingRowProps {
  readonly locale: Locale;
  readonly title: string;
  readonly purpose: string;
  readonly control: ReactNode;
  /** The recommended value's text when the setting differs from it; absent = on the recommendation. */
  readonly differsFrom?: string;
  readonly onReset?: () => void;
  readonly saved?: boolean;
  /** The resolved U-8 copy of a failed save, shown under the row. */
  readonly failure?: string;
  /** An amber line under the row, e.g. a standing warning that is not a failure. */
  readonly note?: string;
  readonly disclosure?: { readonly label: string; readonly startsOpen: boolean; readonly children: ReactNode };
}

export function SettingRow({ locale, title, purpose, control, differsFrom, onReset, saved = false, failure, note, disclosure }: SettingRowProps) {
  const [open, setOpen] = useState(disclosure?.startsOpen ?? false);
  return (
    <div className="grid gap-1.5 border-b border-hairline py-3 last:border-b-0" data-setting-row={title}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink">{title}</p>
          <p className="text-[12.5px] text-inkdim">{purpose}</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {saved ? (
            <span role="status" className="font-mono text-[11px] text-proceed">
              {t(locale, 'editor.saved')}
            </span>
          ) : null}
          {control}
        </div>
      </div>
      {differsFrom !== undefined ? (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-signal-soft">
          <span>{t(locale, 'editor.differs').replace('{value}', differsFrom)}</span>
          {onReset !== undefined ? (
            <ActionButton variant="ghost" onClick={onReset}>
              {t(locale, 'editor.reset')}
            </ActionButton>
          ) : null}
        </p>
      ) : null}
      {note !== undefined ? <p className="text-[12px] text-signal-soft">{note}</p> : null}
      {failure !== undefined ? (
        <p role="alert" className="text-[12px] text-error">
          {failure}
        </p>
      ) : null}
      {disclosure !== undefined ? (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="rounded-control text-[12.5px] text-inkdim hover:text-ink"
          >
            {open ? '⌄' : '›'} {disclosure.label}
          </button>
          {open ? <div className="mt-2 grid gap-2">{disclosure.children}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
