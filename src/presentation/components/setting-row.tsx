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
  /** One sentence under the title; absent when it would only repeat the title (no empty slot). */
  readonly purpose?: string;
  /** The one control at the right edge; null when the row's options are a block (`below`). */
  readonly control: ReactNode;
  /** A full-width block under the title and purpose, for options too wide for the control slot. */
  readonly below?: ReactNode;
  /** The recommended value's text when the setting differs from it; absent = on the recommendation. */
  readonly differsFrom?: string;
  readonly onReset?: () => void;
  readonly saved?: boolean;
  /** The resolved U-8 copy of a failed save, shown under the row. */
  readonly failure?: string;
  /** An amber line under the row, e.g. a standing warning that is not a failure. */
  readonly note?: string;
  readonly disclosure?: { readonly label: string; readonly startsOpen: boolean; readonly children: ReactNode };
  /** The row sits in a `SettingRows` card (U-41): padded to the card, divided from its neighbours. */
  readonly framed?: boolean;
}

/** The card the wizard's and Settings' rows sit in (U-41): rows divided by hairlines. */
export function SettingRows({ children }: { readonly children: ReactNode }) {
  return <div className="rounded-card border border-hairline bg-surface">{children}</div>;
}

export function SettingRow({ locale, title, purpose, control, below, differsFrom, onReset, saved = false, failure, note, disclosure, framed = false }: SettingRowProps) {
  const [open, setOpen] = useState(disclosure?.startsOpen ?? false);
  return (
    <div
      className={framed ? 'grid min-h-16 content-center gap-1.5 border-t border-hairline px-4 py-3.5 first:border-t-0' : 'grid gap-1.5 border-b border-hairline py-3 last:border-b-0'}
      data-setting-row={title}
    >
      <div className={`flex justify-between gap-4 ${purpose === undefined || purpose === '' ? 'items-center' : 'items-start'}`}>
        <div className="min-w-0">
          <p className={framed ? 'font-bold text-ink' : 'text-[13.5px] font-semibold text-ink'}>{title}</p>
          {purpose !== undefined && purpose !== '' ? <p className={framed ? 'text-[13px] text-inkdim' : 'text-[12.5px] text-inkdim'}>{purpose}</p> : null}
        </div>
        <div className="flex flex-none items-center gap-2">
          {saved ? (
            <span role="status" className="text-[12px] text-proceed">
              {t(locale, 'editor.saved')}
            </span>
          ) : null}
          {control}
        </div>
      </div>
      {below !== undefined ? <div>{below}</div> : null}
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
