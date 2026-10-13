// stores/project-bundle.ts — the project export and import bundle modal state (U-296).
import type { Api } from '../../api/api';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';

export const PROJECT_BUNDLE_KEYS = {
  menuTitle: 'project.menu.title',
  menuExport: 'project.menu.export',
  menuImport: 'project.menu.import',
  exportTitle: 'project.bundle.export.title',
  exportBody: 'project.bundle.export.body',
  exportConfirm: 'project.bundle.export.confirm',
  exportCancel: 'project.bundle.export.cancel',
  exportFinished: 'project.bundle.export.finished',
  importTitle: 'project.bundle.import.title',
  importBody: 'project.bundle.import.body',
  importConfirm: 'project.bundle.import.confirm',
  importCancel: 'project.bundle.import.cancel',
  importFinished: 'project.bundle.import.finished',
  importFileSelect: 'project.bundle.import.fileSelect',
} as const satisfies Record<string, LabelKey>;

export type ProjectBundleModal =
  | { readonly kind: 'export_confirm'; readonly project: string; readonly path: string }
  | { readonly kind: 'export_finished'; readonly path: string }
  | { readonly kind: 'import_confirm'; readonly path: string }
  | {
      readonly kind: 'import_finished';
      readonly warnings: readonly string[];
      readonly renames: readonly { readonly id: string; readonly to: string }[];
    };

export interface ProjectBundleState {
  readonly modal: ProjectBundleModal | null;
  readonly running: boolean;
  readonly error: string | null;
}

export const CLOSED_PROJECT_BUNDLE_STATE: ProjectBundleState = {
  modal: null,
  running: false,
  error: null,
};

export interface ProjectBundleStoreDeps {
  readonly api: Pick<Api, 'command'>;
  readonly actor: Actor;
  readonly defaultExportFolder?: string;
}

export interface ProjectBundleStore {
  state(): ProjectBundleState;
  subscribe(listener: () => void): () => void;
  openExport(project: string, folder?: string): void;
  confirmExport(): Promise<void>;
  openImport(filePath: string): void;
  confirmImport(): Promise<void>;
  close(): void;
}

export function createProjectBundleStore({
  api,
  actor,
  defaultExportFolder = '~/.docket/exports/',
}: ProjectBundleStoreDeps): ProjectBundleStore {
  let state: ProjectBundleState = CLOSED_PROJECT_BUNDLE_STATE;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openExport: (project: string, folder?: string) => {
      state = {
        modal: {
          kind: 'export_confirm',
          project,
          path: folder ?? defaultExportFolder,
        },
        running: false,
        error: null,
      };
      notify();
    },
    confirmExport: async () => {
      if (state.modal?.kind !== 'export_confirm') return;
      const project = state.modal.project;
      state = { ...state, running: true, error: null };
      notify();
      const res = await api.command(actor, { type: 'project.export', project });
      if (res.ok) {
        state = {
          modal: { kind: 'export_finished', path: res.path ?? '' },
          running: false,
          error: null,
        };
      } else {
        state = {
          ...state,
          running: false,
          error: res.code,
        };
      }
      notify();
    },
    openImport: (filePath: string) => {
      state = {
        modal: {
          kind: 'import_confirm',
          path: filePath,
        },
        running: false,
        error: null,
      };
      notify();
    },
    confirmImport: async () => {
      if (state.modal?.kind !== 'import_confirm') return;
      const path = state.modal.path;
      state = { ...state, running: true, error: null };
      notify();
      const res = await api.command(actor, { type: 'project.importBundle', path });
      if (res.ok) {
        state = {
          modal: {
            kind: 'import_finished',
            warnings: res.warnings ?? [],
            renames: res.renames ?? [],
          },
          running: false,
          error: null,
        };
      } else {
        state = {
          ...state,
          running: false,
          error: res.code,
        };
      }
      notify();
    },
    close: () => {
      state = CLOSED_PROJECT_BUNDLE_STATE;
      notify();
    },
  };
}
