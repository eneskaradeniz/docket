// components/detail-files.tsx — the read-only changed-files section (U-231): path and ± counts
// per file, capped at eight rows with the “Tümünü gör” fold, the calm line for a work order with
// no working copy or an unreadable diff, and no control that writes to git anywhere — the list
// is the record of what the runs changed, not a working surface.
import { useState } from 'react';
import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';
import type { WorkOrderChangeFile, WorkOrderChangesView } from '../stores/work-order-detail';

/** How many rows stand open before the “Tümünü gör” fold (U-231's cap). */
export const FILES_CAP = 8;

const FileRow = ({ file }: { readonly file: WorkOrderChangeFile }) => (
  <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-hairline py-2 font-mono text-[0.6875rem]">
    <span className="truncate text-ink" title={file.path}>{file.path}</span>
    <span className="whitespace-nowrap text-inkdim">
      {file.binary ? (
        <span>bin</span>
      ) : (
        <>
          <span className="text-proceed">+{file.added}</span> <span className="text-error">−{file.removed}</span>
        </>
      )}
    </span>
  </li>
);

export interface DetailFilesProps {
  readonly changes: WorkOrderChangesView | null;
  readonly locale: Locale;
}

export function DetailFiles({ changes, locale }: DetailFilesProps) {
  const [all, setAll] = useState(false);
  if (changes === null) return null;
  const calm =
    changes.state === 'no_worktree'
      ? t(locale, 'detail.files.noWorktree')
      : changes.state === 'unavailable'
        ? t(locale, 'detail.files.unavailable')
        : changes.files.length === 0
          ? t(locale, 'detail.files.empty')
          : null;
  const shown = all ? changes.files : changes.files.slice(0, FILES_CAP);
  const folded = changes.files.length - FILES_CAP;

  return (
    <section data-detail-files className="min-w-0">
      <h2 className="mb-3 text-[0.78125rem] font-semibold text-inkdim">
        {t(locale, 'detail.files.title')}
        {calm === null ? (
          <span className="ml-2 font-normal">
            · {t(locale, 'detail.files.count').replace('{n}', String(changes.files.length))} · {t(locale, 'detail.files.readOnly')}
          </span>
        ) : null}
      </h2>
      {calm !== null ? (
        <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[0.8125rem] text-inkdim">{calm}</p>
      ) : (
        <>
          <ul className="m-0 list-none border-t border-hairline p-0">
            {shown.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          {folded > 0 ? (
            <div className="py-2">
              <ActionButton ariaExpanded={all} onClick={() => setAll((open) => !open)}>
                {t(locale, all ? 'detail.files.hideAll' : 'detail.files.showAll')}
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
