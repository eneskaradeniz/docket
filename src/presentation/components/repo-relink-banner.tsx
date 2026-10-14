// components/repo-relink-banner.tsx — one registry health banner per affected repo (U-312).
import { t, type Locale } from '../labels/t';
import type { RepoRelinkRow } from '../stores/repo-relink-status';
import { repoRelinkErrorKey } from '../stores/repo-relink-status';
import { ActionButton } from './action-button';

export interface RepoRelinkBannerProps {
  readonly locale: Locale;
  readonly row: RepoRelinkRow;
  readonly busy: boolean;
  readonly onLinkOffered: () => void;
  readonly onPickFolder: () => void;
  readonly onPickOther: () => void;
}

export function RepoRelinkBanner({
  locale,
  row,
  busy,
  onLinkOffered,
  onPickFolder,
  onPickOther,
}: RepoRelinkBannerProps) {
  const headline =
    row.status === 'folder_not_found'
      ? t(locale, 'repoSettings.status.folderNotFound')
      : t(locale, 'repoSettings.status.movedMaybe');

  return (
    <div
      role="status"
      aria-live="polite"
      data-repo-relink-banner=""
      data-repo-relink-status={row.status}
      className="flex flex-col gap-2 rounded-card border border-signal/40 bg-surface px-4 py-3"
    >
      <p className="m-0 flex flex-wrap items-center gap-2 text-[0.8125rem] leading-[1.25rem] text-ink">
        <span>{headline}</span>
        {row.status === 'relink_offered' ? (
          <code className="rounded-control bg-sunk px-1.5 py-0.5 font-mono text-[12px] text-ink">{row.path}</code>
        ) : null}
      </p>
      {row.error !== null ? (
        <p role="alert" className="m-0 text-[0.8125rem] leading-[1.25rem] text-error">
          {t(locale, repoRelinkErrorKey(row.error))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {row.status === 'folder_not_found' ? (
          <ActionButton variant="neutral" size="sm" disabled={busy} onClick={onPickFolder}>
            {t(locale, 'repoSettings.status.pickFolder')}
          </ActionButton>
        ) : (
          <>
            <ActionButton variant="neutral" size="sm" disabled={busy} onClick={onLinkOffered}>
              {t(locale, 'repoSettings.status.linkOffered')}
            </ActionButton>
            <ActionButton variant="neutral" size="sm" disabled={busy} onClick={onPickOther}>
              {t(locale, 'repoSettings.status.pickOther')}
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}
