// components/project-bundle-dialog.tsx — the project bundle export and import dialogs (U-296).
import { useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import {
  PROJECT_BUNDLE_KEYS,
  type ProjectBundleState,
  type ProjectBundleStore,
} from '../stores/project-bundle';
import { failureKey } from '../stores/results';
import { ActionButton } from './action-button';
import { ModalWindow } from './new-work-order-window';
import { WindowTitle } from './window-frame';

export interface ProjectBundleDialogViewProps {
  readonly state: ProjectBundleState;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onConfirmExport: () => void;
  readonly onConfirmImport: () => void;
}

export function ProjectBundleDialogView({
  state,
  locale,
  onClose,
  onConfirmExport,
  onConfirmImport,
}: ProjectBundleDialogViewProps) {
  const modal = state.modal;
  if (modal === null) return null;

  const titleId = 'project-bundle-dialog-title';

  if (modal.kind === 'export_confirm') {
    const title = t(locale, PROJECT_BUNDLE_KEYS.exportTitle);
    const body = t(locale, PROJECT_BUNDLE_KEYS.exportBody).replace('{path}', modal.path);
    return (
      <ModalWindow
        open
        label={title}
        titleId={titleId}
        brand={title}
        dataMark="data-project-bundle-dialog"
        scrimMark="data-project-bundle-dialog-scrim"
        compact
        scrimCloses={false}
        onClose={onClose}
        head={
          <div id={titleId} className="min-w-0">
            <WindowTitle title={title} />
          </div>
        }
        footer={
          <>
            <span className="ml-auto inline-flex [&>button]:h-8">
              <ActionButton variant="neutral" size="md" autoFocus onClick={onClose}>
                {t(locale, PROJECT_BUNDLE_KEYS.exportCancel)}
              </ActionButton>
            </span>
            <span className="inline-flex [&>button]:h-8">
              <ActionButton
                variant="primary"
                size="md"
                disabled={state.running}
                onClick={onConfirmExport}
              >
                {t(locale, PROJECT_BUNDLE_KEYS.exportConfirm)}
              </ActionButton>
            </span>
          </>
        }
      >
        <div className="grid gap-2 p-4 text-[13px] text-ink">
          <p>{body}</p>
          {state.error !== null ? (
            <p className="text-error">{t(locale, failureKey(state.error))}</p>
          ) : null}
        </div>
      </ModalWindow>
    );
  }

  if (modal.kind === 'export_finished') {
    const title = t(locale, PROJECT_BUNDLE_KEYS.exportTitle);
    const body = t(locale, PROJECT_BUNDLE_KEYS.exportFinished).replace('{path}', modal.path);
    return (
      <ModalWindow
        open
        label={title}
        titleId={titleId}
        brand={title}
        dataMark="data-project-bundle-dialog"
        scrimMark="data-project-bundle-dialog-scrim"
        compact
        scrimCloses={false}
        onClose={onClose}
        head={
          <div id={titleId} className="min-w-0">
            <WindowTitle title={title} />
          </div>
        }
        footer={
          <span className="ml-auto inline-flex [&>button]:h-8">
            <ActionButton variant="primary" size="md" autoFocus onClick={onClose}>
              {t(locale, PROJECT_BUNDLE_KEYS.exportCancel)}
            </ActionButton>
          </span>
        }
      >
        <div className="grid gap-2 p-4 text-[13px] text-ink">
          <p>{body}</p>
        </div>
      </ModalWindow>
    );
  }

  if (modal.kind === 'import_confirm') {
    const title = t(locale, PROJECT_BUNDLE_KEYS.importTitle);
    const body = t(locale, PROJECT_BUNDLE_KEYS.importBody).replace('{path}', modal.path);
    return (
      <ModalWindow
        open
        label={title}
        titleId={titleId}
        brand={title}
        dataMark="data-project-bundle-dialog"
        scrimMark="data-project-bundle-dialog-scrim"
        compact
        scrimCloses={false}
        onClose={onClose}
        head={
          <div id={titleId} className="min-w-0">
            <WindowTitle title={title} />
          </div>
        }
        footer={
          <>
            <span className="ml-auto inline-flex [&>button]:h-8">
              <ActionButton variant="neutral" size="md" autoFocus onClick={onClose}>
                {t(locale, PROJECT_BUNDLE_KEYS.importCancel)}
              </ActionButton>
            </span>
            <span className="inline-flex [&>button]:h-8">
              <ActionButton
                variant="primary"
                size="md"
                disabled={state.running}
                onClick={onConfirmImport}
              >
                {t(locale, PROJECT_BUNDLE_KEYS.importConfirm)}
              </ActionButton>
            </span>
          </>
        }
      >
        <div className="grid gap-2 p-4 text-[13px] text-ink">
          <p>{body}</p>
          {state.error !== null ? (
            <p className="text-error">{t(locale, failureKey(state.error))}</p>
          ) : null}
        </div>
      </ModalWindow>
    );
  }

  if (modal.kind === 'import_finished') {
    const title = t(locale, PROJECT_BUNDLE_KEYS.importTitle);
    const body = t(locale, PROJECT_BUNDLE_KEYS.importFinished);
    return (
      <ModalWindow
        open
        label={title}
        titleId={titleId}
        brand={title}
        dataMark="data-project-bundle-dialog"
        scrimMark="data-project-bundle-dialog-scrim"
        compact
        scrimCloses={false}
        onClose={onClose}
        head={
          <div id={titleId} className="min-w-0">
            <WindowTitle title={title} />
          </div>
        }
        footer={
          <span className="ml-auto inline-flex [&>button]:h-8">
            <ActionButton variant="primary" size="md" autoFocus onClick={onClose}>
              {t(locale, PROJECT_BUNDLE_KEYS.importCancel)}
            </ActionButton>
          </span>
        }
      >
        <div className="grid gap-2 p-4 text-[13px] text-ink">
          <p>{body}</p>
          {modal.renames.length > 0 ? (
            <ul className="list-disc pl-5 font-mono text-[11px] text-inkdim">
              {modal.renames.map((r) => (
                <li key={r.id}>
                  {r.id} → {r.to}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </ModalWindow>
    );
  }

  return null;
}

export function ProjectBundleDialog({
  store,
  locale,
}: {
  readonly store: ProjectBundleStore;
  readonly locale: Locale;
}) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  return (
    <ProjectBundleDialogView
      state={state}
      locale={locale}
      onClose={store.close}
      onConfirmExport={() => void store.confirmExport()}
      onConfirmImport={() => void store.confirmImport()}
    />
  );
}
