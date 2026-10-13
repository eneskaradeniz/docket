// presentation/stores/project-bundle.test.ts — project-menu export/import (U-296).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Command } from '../../api/commands';
import { TR } from '../labels/tr';
import { EN } from '../labels/en';
import {
  CLOSED_PROJECT_BUNDLE_STATE,
  PROJECT_BUNDLE_KEYS,
  createProjectBundleStore,
} from './project-bundle';
import { ProjectBundleDialogView } from '../components/project-bundle-dialog';
import { ProjectMenu } from '../components/project-menu';

const SOURCE_DIALOG = import.meta.glob('../components/project-bundle-dialog.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SOURCE_MENU = import.meta.glob('../components/project-menu.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const setup = () => {
  const sent: Command[] = [];
  const store = createProjectBundleStore({
    api: {
      command: async (_actor, command) => {
        sent.push(command);
        if (command.type === 'project.export') {
          return {
            ok: true,
            path: '/Users/op/.docket/exports/atolye.20261013T120000Z.docket-bundle.json',
            counts: { projects: 1, repos: 1, definitions: 5, memoryNotes: 2 },
          };
        }
        if (command.type === 'project.importBundle') {
          return {
            ok: true,
            warnings: [],
            renames: [{ id: 'atolye', to: 'atolye-2' }],
          };
        }
        return { ok: true };
      },
    },
    actor: { kind: 'user', id: 'u-1' },
    defaultExportFolder: '~/.docket/exports/',
  });
  return { store, sent };
};

describe('ProjectBundle (U-296)', () => {
  it('U-296: project menu offers Export and Import; export opens confirm dialog naming target path in ~/.docket/exports/ folder with Export and Cancel buttons', () => {
    const { store } = setup();
    expect(store.state()).toEqual(CLOSED_PROJECT_BUNDLE_STATE);

    store.openExport('atolye');
    const state = store.state();
    expect(state.modal).toEqual({
      kind: 'export_confirm',
      project: 'atolye',
      path: '~/.docket/exports/',
    });

    // Turkish render
    const htmlTr = renderToStaticMarkup(
      createElement(ProjectBundleDialogView, {
        state,
        locale: 'tr',
        onClose: () => undefined,
        onConfirmExport: () => undefined,
        onConfirmImport: () => undefined,
      }),
    );
    expect(htmlTr).toContain('Paket şuraya yazılacak: ~/.docket/exports/');
    expect(htmlTr).toContain('Dışa aktar');
    expect(htmlTr).toContain('Vazgeç');

    // English render
    const htmlEn = renderToStaticMarkup(
      createElement(ProjectBundleDialogView, {
        state,
        locale: 'en',
        onClose: () => undefined,
        onConfirmExport: () => undefined,
        onConfirmImport: () => undefined,
      }),
    );
    expect(htmlEn).toContain('The bundle will be written to: ~/.docket/exports/');
    expect(htmlEn).toContain('Export');
    expect(htmlEn).toContain('Cancel');
  });

  it('U-296: confirming export calls project.export and finished state shows the written file absolute path', async () => {
    const { store, sent } = setup();
    store.openExport('atolye');
    await store.confirmExport();

    expect(sent).toEqual([{ type: 'project.export', project: 'atolye' }]);
    const state = store.state();
    expect(state.modal?.kind).toBe('export_finished');
    if (state.modal?.kind === 'export_finished') {
      expect(state.modal.path).toBe('/Users/op/.docket/exports/atolye.20261013T120000Z.docket-bundle.json');
    }

    const htmlTr = renderToStaticMarkup(
      createElement(ProjectBundleDialogView, {
        state,
        locale: 'tr',
        onClose: () => undefined,
        onConfirmExport: () => undefined,
        onConfirmImport: () => undefined,
      }),
    );
    expect(htmlTr).toContain('/Users/op/.docket/exports/atolye.20261013T120000Z.docket-bundle.json');
  });

  it('U-296: import after file picker opens confirm dialog naming picked file with Import and Cancel buttons', () => {
    const { store } = setup();
    store.openImport('/Users/op/Downloads/atolye.docket-bundle.json');
    const state = store.state();
    expect(state.modal).toEqual({
      kind: 'import_confirm',
      path: '/Users/op/Downloads/atolye.docket-bundle.json',
    });

    const htmlTr = renderToStaticMarkup(
      createElement(ProjectBundleDialogView, {
        state,
        locale: 'tr',
        onClose: () => undefined,
        onConfirmExport: () => undefined,
        onConfirmImport: () => undefined,
      }),
    );
    expect(htmlTr).toContain('Şu dosya içe aktarılacak: /Users/op/Downloads/atolye.docket-bundle.json');
    expect(htmlTr).toContain('İçe aktar');
    expect(htmlTr).toContain('Vazgeç');

    const htmlEn = renderToStaticMarkup(
      createElement(ProjectBundleDialogView, {
        state,
        locale: 'en',
        onClose: () => undefined,
        onConfirmExport: () => undefined,
        onConfirmImport: () => undefined,
      }),
    );
    expect(htmlEn).toContain('This file will be imported: /Users/op/Downloads/atolye.docket-bundle.json');
    expect(htmlEn).toContain('Import');
    expect(htmlEn).toContain('Cancel');
  });

  it('U-296: confirming import calls project.importBundle and reports renames', async () => {
    const { store, sent } = setup();
    store.openImport('/Users/op/Downloads/atolye.docket-bundle.json');
    await store.confirmImport();

    expect(sent).toEqual([
      { type: 'project.importBundle', path: '/Users/op/Downloads/atolye.docket-bundle.json' },
    ]);
    const state = store.state();
    expect(state.modal?.kind).toBe('import_finished');
    if (state.modal?.kind === 'import_finished') {
      expect(state.modal.renames).toEqual([{ id: 'atolye', to: 'atolye-2' }]);
    }
  });

  it('U-296: every string lives in both label bundles, never inline in a component', () => {
    for (const key of Object.values(PROJECT_BUNDLE_KEYS)) {
      expect(TR[key]).toBeDefined();
      expect(EN[key]).toBeDefined();
      expect(TR[key].length).toBeGreaterThan(0);
      expect(EN[key].length).toBeGreaterThan(0);
    }

    const dialogSrc = Object.values(SOURCE_DIALOG)[0] ?? '';
    const menuSrc = Object.values(SOURCE_MENU)[0] ?? '';

    // No hardcoded Turkish phrases inline in dialog or menu component
    expect(dialogSrc).not.toContain("'Paket şuraya yazılacak");
    expect(dialogSrc).not.toContain("'Şu dosya içe aktarılacak");
    expect(dialogSrc).not.toContain("'Dışa aktar'");
    expect(dialogSrc).not.toContain("'İçe aktar'");
    expect(menuSrc).not.toContain("'Dışa aktar'");
    expect(menuSrc).not.toContain("'İçe aktar'");
  });

  it('U-296: ProjectMenu renders menu trigger button with title', () => {
    const { store } = setup();
    const html = renderToStaticMarkup(
      createElement(ProjectMenu, { locale: 'tr', store, project: 'atolye' }),
    );
    expect(html).toContain('data-project-menu');
    expect(html).toContain('Proje menüsü');
  });
});
