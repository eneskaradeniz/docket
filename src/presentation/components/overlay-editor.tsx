// components/overlay-editor.tsx — the Roller section of repo settings (U-288): version badge,
// overlay instructions, proposal row, and the detach / re-link pair. A detached binding shows
// "Kütüphaneye bağla" (U-298); its confirm dialog (U-299) rides the shared ModalWindow shell, so
// the focus trap, Esc and the focus return to the row are the shell's contract; the polite
// region announces a finished re-link (U-300).
import { useState } from 'react';

import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { RelinkKeep, RepoFlow, RoleDef, RoleOverlay, RoleRef, RoleUpdateProposal, StageSlug, VersionRecord } from '../../domain/index';
import { effectiveRole, relinkRole } from '../../domain/index';
import { ActionButton } from './action-button';
import { ModalWindow } from './new-work-order-window';
import { WindowTitle } from './window-frame';

export interface OverlayEditorProps {
  readonly locale: Locale;
  readonly flow: RepoFlow | null;
  readonly stage: StageSlug | null;
  readonly library: readonly VersionRecord<RoleDef>[];
  readonly proposals: readonly RoleUpdateProposal[];
  readonly proposalBlocked: readonly (keyof RoleOverlay)[];
  readonly onInstructions: (stage: StageSlug, text: string) => void;
  readonly onDetach: (stage: StageSlug) => void;
  readonly onApplyProposal: (stage: StageSlug) => void;
  readonly onClearOverlayField: (stage: StageSlug, field: keyof RoleOverlay) => void;
  /** The re-link flow (U-298 … U-300): the open dialog's stage, the announced stage, and the three intents. */
  readonly relinkStage: StageSlug | null;
  readonly relinkNotice: StageSlug | null;
  readonly onRequestRelink: (stage: StageSlug) => void;
  readonly onCancelRelink: () => void;
  readonly onConfirmRelink: (version: number, keep: RelinkKeep) => void;
}

const versionBadge = (ref: { readonly version: number; readonly detached?: RoleDef } | undefined): string => {
  if (ref === undefined) return '';
  if (ref.detached !== undefined) return 'detached';
  return `v${ref.version}`;
};

const RELINK_FIELD_LABEL: Readonly<Record<keyof RoleOverlay, LabelKey>> = {
  name: 'repoSettings.relink.field.name',
  instructions: 'repoSettings.relink.field.instructions',
  writeScope: 'repoSettings.relink.field.writeScope',
  capabilities: 'repoSettings.relink.field.capabilities',
  docketTools: 'repoSettings.relink.field.docketTools',
};

interface RelinkDialogProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly ref: RoleRef;
  readonly library: readonly VersionRecord<RoleDef>[];
  readonly onCancel: () => void;
  readonly onConfirm: (version: number, keep: RelinkKeep) => void;
}

/** The re-link confirm dialog (U-299). Stays mounted so the shell's close paths — focus return,
 *  exit motion — survive; a fresh open resets to the defaults: latest version, local changes kept. */
function RelinkDialog({ open, locale, ref, library, onCancel, onConfirm }: RelinkDialogProps) {
  const versions = library
    .filter((record) => record.definitionId === ref.roleId)
    .map((record) => record.version)
    .sort((left, right) => left - right);
  const latest = versions[versions.length - 1] ?? ref.version;
  const [chosen, setChosen] = useState<number | null>(null);
  const [keep, setKeep] = useState<RelinkKeep>('overlay');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChosen(null);
      setKeep('overlay');
    }
  }
  const version = chosen !== null && versions.includes(chosen) ? chosen : latest;
  const preview = relinkRole(ref, library, version, 'overlay');
  const overlayFields: readonly (keyof RoleOverlay)[] = preview.ok
    ? (Object.keys(preview.value.overlay ?? {}) as (keyof RoleOverlay)[])
    : [];
  const title = t(locale, 'repoSettings.relink.confirm.title');

  return (
    <ModalWindow
      open={open}
      label={title}
      titleId="relink-dialog-title"
      brand={title}
      dataMark="data-relink-dialog"
      scrimMark="data-relink-dialog-scrim"
      compact
      onClose={onCancel}
      head={
        <div id="relink-dialog-title" className="min-w-0">
          <WindowTitle title={title} />
        </div>
      }
      footer={
        <>
          <span className="ml-auto inline-flex [&>button]:h-8">
            <ActionButton variant="neutral" size="md" autoFocus onClick={onCancel}>
              {t(locale, 'repoSettings.relink.cancel')}
            </ActionButton>
          </span>
          <span className="inline-flex [&>button]:h-8">
            <ActionButton variant="primary" size="md" disabled={versions.length === 0} onClick={() => onConfirm(version, keep)}>
              {t(locale, 'repoSettings.relink.confirm')}
            </ActionButton>
          </span>
        </>
      }
    >
      <div className="grid gap-3 text-[13px] text-ink">
        <p>{t(locale, 'repoSettings.relink.confirm.body')}</p>
        <div className="grid gap-1.5">
          <label className="text-[12px] font-medium text-inkdim" htmlFor="relink-version">
            {t(locale, 'repoSettings.relink.version')}
          </label>
          <select
            id="relink-version"
            value={version}
            onChange={(event) => setChosen(Number(event.target.value))}
            className="h-8 w-full rounded-control border border-bord bg-raised px-2 text-[13px] text-ink"
          >
            {versions.map((entry) => (
              <option key={entry} value={entry}>
                v{entry}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label={t(locale, 'repoSettings.relink.confirm.title')} className="flex flex-col gap-1">
          <label className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-raised">
            <input type="radio" name={`relink-keep-${ref.roleId}`} checked={keep === 'overlay'} onChange={() => setKeep('overlay')} />
            <span className="text-[13px] text-ink">{t(locale, 'repoSettings.relink.keep.overlay')}</span>
          </label>
          <label className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-raised">
            <input type="radio" name={`relink-keep-${ref.roleId}`} checked={keep === 'library'} onChange={() => setKeep('library')} />
            <span className="text-[13px] text-ink">{t(locale, 'repoSettings.relink.keep.library')}</span>
          </label>
        </div>
        {keep === 'overlay' ? (
          <div className="rounded-card border border-hairline bg-sunk px-3 py-2">
            <p className="m-0 text-[12px] text-inkdim">{t(locale, 'repoSettings.relink.overlayFields')}</p>
            {overlayFields.length === 0 ? (
              <p className="m-0 mt-1 text-[13px] text-ink">{t(locale, 'repoSettings.relink.overlayFields.none')}</p>
            ) : (
              <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-[13px] text-ink">
                {overlayFields.map((field) => (
                  <li key={field}>{t(locale, RELINK_FIELD_LABEL[field])}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </ModalWindow>
  );
}

export function OverlayEditor({
  locale,
  flow,
  stage,
  library,
  proposals,
  proposalBlocked,
  onInstructions,
  onDetach,
  onApplyProposal,
  onClearOverlayField,
  relinkStage,
  relinkNotice,
  onRequestRelink,
  onCancelRelink,
  onConfirmRelink,
}: OverlayEditorProps) {
  const sectionLabel = t(locale, 'repoSettings.section.roles');
  if (flow === null || stage === null) {
    return (
      <section role="group" aria-label={sectionLabel} className="mb-4 rounded-card border border-hairline bg-surface px-3 py-4 text-[13px] text-inkdim">
        {t(locale, 'repoSettings.empty')}
      </section>
    );
  }
  const binding = flow.bindings.find((row) => row.stage === stage);
  const ref = binding?.role;
  const resolved = ref === undefined ? null : effectiveRole(ref, library);
  const instructions = ref?.overlay?.instructions ?? (resolved?.ok ? resolved.value.instructions : '');
  const proposal = proposals.find((row) => row.stage === stage);
  const blocked = proposalBlocked.length > 0;
  const inLibrary = ref === undefined ? false : library.some((record) => record.definitionId === ref.roleId);

  return (
    <>
      <section role="group" aria-label={sectionLabel} className="mb-4 rounded-card border border-hairline bg-surface px-3 py-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="m-0 text-[13px] font-bold text-ink">{sectionLabel}</h2>
          {ref !== undefined ? (
            <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-inkdim">{versionBadge(ref)}</span>
          ) : null}
          {ref !== undefined && ref.detached !== undefined ? (
            <>
              <ActionButton
                variant="neutral"
                size="sm"
                disabled={!inLibrary}
                onClick={() => onRequestRelink(stage)}
              >
                {t(locale, 'repoSettings.relink')}
              </ActionButton>
              {!inLibrary ? (
                <span className="text-[12px] text-inkdim">{t(locale, 'repoSettings.relink.missing')}</span>
              ) : null}
            </>
          ) : ref !== undefined ? (
            <ActionButton variant="neutral" size="sm" onClick={() => onDetach(stage)}>
              {t(locale, 'repoSettings.detach')}
            </ActionButton>
          ) : null}
          <span role="status" aria-live="polite" className="sr-only">
            {relinkNotice === stage ? t(locale, 'repoSettings.relink.announced') : ''}
          </span>
        </div>
        <label className="mb-1 block text-[12px] font-medium text-inkdim" htmlFor="repo-overlay-instructions">
          {t(locale, 'repoSettings.overlay.instructions')}
        </label>
        <textarea
          id="repo-overlay-instructions"
          value={instructions}
          onChange={(event) => onInstructions(stage, event.target.value)}
          rows={4}
          className="mb-2 w-full min-h-8 resize-y rounded-control border border-hairline bg-bg px-2 py-1.5 text-[13px] text-ink"
        />
        {proposal !== undefined ? (
          <div role="list" className="mt-2 rounded-card border border-hairline bg-sunk px-3 py-2">
            <div role="listitem" className="flex flex-wrap items-center gap-2 text-[13px]">
              <span>{t(locale, 'repoSettings.version.updateAvailable')}</span>
              <span className="text-inkdim">v{proposal.from} → v{proposal.to}</span>
              {blocked ? (
                <span className="text-[12px] text-signal-soft">{proposalBlocked.join(', ')}</span>
              ) : null}
              <ActionButton
                variant="primary"
                size="sm"
                disabled={blocked}
                onClick={() => onApplyProposal(stage)}
              >
                {t(locale, 'repoSettings.version.apply')}
              </ActionButton>
              {blocked
                ? proposalBlocked.map((field) => (
                    <ActionButton key={field} variant="neutral" size="sm" onClick={() => onClearOverlayField(stage, field)}>
                      {String(field)}
                    </ActionButton>
                  ))
                : null}
            </div>
          </div>
        ) : null}
      </section>
      {ref !== undefined && ref.detached !== undefined ? (
        <RelinkDialog
          open={relinkStage === stage}
          locale={locale}
          ref={ref}
          library={library}
          onCancel={onCancelRelink}
          onConfirm={onConfirmRelink}
        />
      ) : null}
    </>
  );
}
