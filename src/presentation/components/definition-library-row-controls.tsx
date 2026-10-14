// components/definition-library-row-controls.tsx — version badge, past versions and removal (U-292, U-293).
import { t, type Locale } from '../labels/t';
import type { RemovalVerdict } from '../../domain/index';
import type { RoleListItem } from '../../api/queries';
import {
  removalActionOf,
  removalBlockNote,
  removalLabelAction,
  type DefinitionVersionView,
} from '../stores/roles';
import { ActionButton } from './action-button';
import { PastVersionsModal } from './past-versions-modal';
import { RemovalActionButton } from './removal-action-button';
import { VersionBadge } from './version-badge';

export interface DefinitionLibraryRowControlsProps {
  readonly locale: Locale;
  readonly name: string;
  readonly version: number;
  readonly pastVersions: readonly DefinitionVersionView[] | null;
  readonly pastVersionsOpen: boolean;
  readonly removal: RemovalVerdict;
  readonly stages: RoleListItem['stages'];
  readonly onOpenPastVersions: () => void;
  readonly onClosePastVersions: () => void;
  readonly onRemove: () => void;
}

const hasPastVersions = (current: number, versions: readonly DefinitionVersionView[] | null): boolean =>
  versions !== null && versions.some((entry) => entry.version < current);

export function DefinitionLibraryRowControls({
  locale,
  name,
  version,
  pastVersions,
  pastVersionsOpen,
  removal,
  stages,
  onOpenPastVersions,
  onClosePastVersions,
  onRemove,
}: DefinitionLibraryRowControlsProps) {
  const blockNote = removalBlockNote(locale, removal, stages);
  return (
    <>
      <div className="flex flex-wrap items-start justify-end gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <VersionBadge locale={locale} version={version} />
          {hasPastVersions(version, pastVersions) ? (
            <ActionButton variant="neutral" size="sm" aria-label={t(locale, 'definition.pastVersions.trigger')} onClick={onOpenPastVersions}>
              {t(locale, 'definition.pastVersions.trigger')}
            </ActionButton>
          ) : null}
        </span>
        <RemovalActionButton
          locale={locale}
          action={removalActionOf(removal)}
          labelAction={removalLabelAction(removal)}
          blockNote={blockNote}
          onAction={onRemove}
        />
      </div>
      {pastVersions !== null ? (
        <PastVersionsModal
          open={pastVersionsOpen}
          locale={locale}
          roleName={name}
          currentVersion={version}
          versions={pastVersions}
          onClose={onClosePastVersions}
        />
      ) : null}
    </>
  );
}
