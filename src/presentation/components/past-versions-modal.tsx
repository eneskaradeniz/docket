// components/past-versions-modal.tsx — read-only immutable revision list (U-292).
import { t, type Locale } from '../labels/t';
import type { DefinitionVersionView } from '../stores/roles';
import { ActionButton } from './action-button';
import { ModalWindow } from './new-work-order-window';
import { EmptyCard } from './settings-cards';
import { WindowTitle } from './window-frame';
import { formatDateTime } from './detail-format';

export interface PastVersionsModalProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly roleName: string;
  readonly currentVersion: number;
  readonly versions: readonly DefinitionVersionView[];
  readonly onClose: () => void;
}

export function PastVersionsModal({ open, locale, roleName, currentVersion, versions, onClose }: PastVersionsModalProps) {
  const titleId = 'past-versions-title';
  const title = t(locale, 'definition.pastVersions.title');
  const past = versions.filter((entry) => entry.version < currentVersion).sort((a, b) => b.version - a.version);
  return (
    <ModalWindow
      open={open}
      label={title}
      titleId={titleId}
      brand={title}
      dataMark="data-past-versions-dialog"
      scrimMark="data-past-versions-scrim"
      compact
      onClose={onClose}
      head={
        <div id={titleId} className="min-w-0">
          <WindowTitle title={title} lead={roleName} />
        </div>
      }
      footer={
        <span className="ml-auto inline-flex [&>button]:h-8">
          <ActionButton variant="neutral" size="md" onClick={onClose}>
            {t(locale, 'common.close')}
          </ActionButton>
        </span>
      }
    >
      <div className="grid gap-3 text-[13px] text-ink">
        {past.length === 0 ? (
          <EmptyCard mark="past-versions" title={t(locale, 'definition.pastVersions.empty')} />
        ) : (
          <ul className="grid gap-1.5">
            {past.map((entry) => (
              <li
                key={entry.version}
                className="flex min-h-[2.75rem] items-center justify-between gap-3 rounded-card border border-hairline bg-surface px-3 py-2"
              >
                <span className="font-mono text-[12px] text-ink">
                  {t(locale, 'definition.version.badge').replace('{version}', String(entry.version))}
                </span>
                <span className="text-[12px] text-inkdim" title={formatDateTime(locale, entry.recordedAt)}>
                  {formatDateTime(locale, entry.recordedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalWindow>
  );
}
