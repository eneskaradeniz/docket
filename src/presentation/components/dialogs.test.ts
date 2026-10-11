// dialogs.test.ts — U-245 … U-250: the new-work-order dialog and the Telefon window.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from '../screens/settings';
import { t } from '../labels/t';
import type { LaunchStore } from '../stores/chat-launcher';
import { commandResultKey } from '../stores/results';
import {
  boardFlowChoices,
  defaultFlow,
  focusTarget,
  openedWorkOrderForm,
  STANDARD_FLOW,
  workOrderDraft,
  workOrderFormReducer,
  workOrderOpenToast,
} from '../stores/work-order-window';
import { ChatLauncherContext } from './chat-launcher';
import { NewWorkOrderWindow } from './new-work-order-window';
import { PhoneWindow } from './phone-window';
import { SidebarNav } from './sidebar-nav';

const RAW = import.meta.glob(
  [
    './new-work-order-window.tsx',
    './phone-window.tsx',
    '../screens/board.tsx',
    '../screens/settings.tsx',
    '../screens/shell.tsx',
    '../stores/settings-panel.ts',
    '../../../e2e/journeys.mjs',
    '../../../e2e/layout-audit.mjs',
    '../../../e2e/layout-rules.mjs',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const source = (name: string): string => {
  const found = Object.entries(RAW).find(([path]) => path.endsWith(name));
  return found === undefined ? '' : found[1];
};

const launchStore: LaunchStore = { state: () => ({ draft: '' }), openChat: () => undefined };

const draw = (element: ReturnType<typeof createElement>): string =>
  renderToStaticMarkup(createElement(ChatLauncherContext.Provider, { value: { store: launchStore, locale: 'tr' } }, element));

const workOrder = (): string =>
  draw(
    createElement(NewWorkOrderWindow, {
      open: true,
      locale: 'tr',
      projectName: 'Kadife Odoo',
      flows: boardFlowChoices('standard'),
      launchProject: 'kadife',
      onClose: () => undefined,
      onCreated: () => undefined,
      onCreate: () => Promise.resolve({ ok: true as const }),
    }),
  );

const phone = (): string =>
  draw(
    createElement(PhoneWindow, {
      open: true,
      locale: 'tr',
      onClose: () => undefined,
    }),
  );

describe('new work order window (U-245, U-246, U-247)', () => {
  it('U-245: "+ Yeni iş emri" opens a dialog with Başlık, an Akış select defaulting to standard, and Aç / Vazgeç / Tarif et; the board has no inline create form', () => {
    const html = workOrder();
    expect(html).toContain('role="dialog"');
    expect(html).toContain(t('tr', 'workOrder.new.title'));
    expect(html).toContain(t('tr', 'workOrder.new.titleLabel'));
    expect(html).toContain('<input');
    expect(html).toContain(t('tr', 'workOrder.new.flowLabel'));
    expect(html).toContain('<select');
    expect(html).toContain(`value="${STANDARD_FLOW}"`);
    expect(html).toContain(t('tr', 'workOrder.new.open'));
    expect(html).toContain(t('tr', 'workOrder.new.cancel'));
    expect(html).toContain(t('tr', 'launch.describe'));
    expect(html).toContain('Kadife Odoo');
    const board = source('board.tsx');
    expect(board).toContain('<NewWorkOrderWindow');
    expect(board).not.toContain('BoardCreateForm');
    expect(board).not.toContain('<input');
  });

  it('U-246: the Akış default is standard when that flow is listed, otherwise the first flow, on every open including after a successful create', () => {
    const withStandard = [
      { id: 'release', name: 'release' },
      { id: STANDARD_FLOW, name: 'Standard' },
    ];
    expect(defaultFlow(withStandard)).toBe(STANDARD_FLOW);
    const onlyRelease = boardFlowChoices('release');
    expect(onlyRelease.map((flow) => flow.id)).toEqual(['release']);
    expect(defaultFlow(onlyRelease)).toBe('release');
    expect(defaultFlow(boardFlowChoices('standart-akis'))).toBe('standart-akis');
    expect(defaultFlow(boardFlowChoices('standard'))).toBe(STANDARD_FLOW);
    expect(defaultFlow([])).toBe('');
    let state = openedWorkOrderForm('Taslak', withStandard);
    expect(state.flow).toBe(STANDARD_FLOW);
    state = workOrderFormReducer(state, { type: 'flow', value: 'release' });
    expect(state.flow).toBe('release');
    state = workOrderFormReducer(state, { type: 'created', options: withStandard });
    state = workOrderFormReducer(state, { type: 'open', draft: state.title, options: withStandard });
    expect(state.flow).toBe(STANDARD_FLOW);
    state = workOrderFormReducer(state, { type: 'open', draft: 'Taslak', options: onlyRelease });
    expect(state.flow).toBe('release');
    const empty = draw(
      createElement(NewWorkOrderWindow, {
        open: true,
        locale: 'tr',
        projectName: 'Kadife Odoo',
        flows: [],
        launchProject: null,
        onClose: () => undefined,
        onCreated: () => undefined,
        onCreate: () => Promise.resolve({ ok: true as const }),
      }),
    );
    expect(empty).toContain(t('tr', 'workOrder.new.noFlow'));
    expect(empty).toContain('disabled');
    expect(source('new-work-order-window.tsx')).not.toContain('flowToOpen');
  });

  it('U-247: an empty title is refused with a field message; Enter submits; success closes the dialog and names the card to focus', () => {
    workOrderDraft.clear();
    const listed = [{ id: STANDARD_FLOW, name: STANDARD_FLOW }];
    const open = openedWorkOrderForm('   ', listed);
    const refused = workOrderFormReducer(open, { type: 'invalid', field: 'title_required' });
    expect(refused.fieldError).toBe('title_required');
    expect(refused.failure).toBeNull();
    expect(source('new-work-order-window.tsx')).toContain('validate.title_required');
    expect(source('new-work-order-window.tsx')).toContain("event.key === 'Enter'");
    workOrderDraft.remember('   ');
    expect(workOrderDraft.read()).toBe('');
    workOrderDraft.remember('Kapı');
    expect(workOrderDraft.read()).toBe('Kapı');
    const created = workOrderFormReducer(workOrderFormReducer(open, { type: 'title', value: 'Kapı' }), { type: 'created', options: listed });
    expect(created.title).toBe('');
    expect(created.flow).toBe(defaultFlow(listed));
    workOrderDraft.clear();
    expect(focusTarget('Kapı', [{ id: 'wo-1', title: 'Kapı' }, { id: 'wo-2', title: 'Diğer' }])).toBe('wo-1');
    expect(focusTarget('Yok', [{ id: 'wo-1', title: 'Kapı' }])).toBeNull();
    expect(source('board.tsx')).toContain('focusTarget');
    expect(source('board.tsx')).toContain('.focus()');
  });

  it('U-247: a workOrder.open result is toasted through commandResultKey, success and failure alike', () => {
    const opened = workOrderOpenToast({ ok: true, id: 'wo-1' });
    expect(opened).toEqual({
      result: { ok: true, id: 'wo-1' },
      labelKey: commandResultKey('workOrder.open', { ok: true }),
    });
    expect(t('tr', opened.labelKey)).toBe('İş emri açıldı.');
    const refused = workOrderOpenToast({ ok: false, code: 'flow_not_enabled' });
    expect(refused.labelKey).toBe(commandResultKey('workOrder.open', { ok: false, code: 'flow_not_enabled' }));
    expect(refused.result).toEqual({ ok: false, code: 'flow_not_enabled' });
    // The window publishes that notice; it does not invent the success sentence itself.
    const windowSource = source('new-work-order-window.tsx');
    expect(windowSource).toContain('toastOutcome(');
    expect(windowSource).toContain('workOrderOpenToast(');
    expect(windowSource).not.toContain("t(locale, 'success.workOrder.open')");
    expect(windowSource).not.toContain('flowToOpen');
  });
});

describe('phone window and settings (U-248)', () => {
  it('U-248: the Telefon row opens the phone window; Settings has no phone section and no Telefon tab; the section union has no phone', () => {
    expect(SETTINGS_SECTIONS).not.toContain('phone');
    expect(source('settings-panel.ts')).not.toContain("'phone'");
    expect(source('settings.tsx')).not.toContain("section === 'phone'");
    expect(source('settings.tsx')).not.toContain('settings.section.phone');
    expect(source('shell.tsx')).toContain('<PhoneWindow');
    expect(source('shell.tsx')).not.toContain("openSettings('phone')");
    const html = phone();
    expect(html).toContain('role="dialog"');
    expect(html).toContain(t('tr', 'phone.none'));
    expect(html).toContain(t('tr', 'phone.soon'));
    expect(html).toContain(t('tr', 'phone.pair'));
    expect(html).toContain('disabled');
    const nav = (phoneCurrent: boolean): string =>
      renderToStaticMarkup(
        createElement(SidebarNav, {
          locale: 'tr',
          homeCurrent: false,
          searchCurrent: false,
          settingsSection: null,
          phoneCurrent,
          libraryCurrent: false,
          libraryCount: 0,
          badge: null,
          onHome: () => undefined,
          onSearch: () => undefined,
          onLibrary: () => undefined,
          onPhone: () => undefined,
          onSettings: () => undefined,
        }),
      );
    const row = (markup: string, label: string): string => {
      const at = markup.indexOf(`>${label}<`);
      return markup.slice(Math.max(0, at - 500), at);
    };
    const open = nav(true);
    expect(row(open, 'Telefon')).toContain('aria-current="true"');
    expect(row(open, 'Ayarlar')).not.toContain('aria-current');
    expect(row(nav(false), 'Telefon')).not.toContain('aria-current');
  });
});

describe('window contract (U-249)', () => {
  it('U-249: both windows are dialogs with a focus trap, Esc, and focus returning to the opener', () => {
    const modal = source('new-work-order-window.tsx');
    const windows = [
      { name: 'work order', html: workOrder(), titleId: 'new-work-order-title' },
      { name: 'phone', html: phone(), titleId: 'phone-window-title' },
    ];
    for (const window of windows) {
      expect(window.html, window.name).toContain('role="dialog"');
      expect(window.html, window.name).toContain('aria-modal="true"');
      expect(window.html, window.name).toContain(`aria-labelledby="${window.titleId}"`);
      expect(window.html, window.name).toContain(`id="${window.titleId}"`);
      expect(window.html, window.name).toContain('h-8');
      expect(window.html, window.name).toContain('motion-reduce:');
    }
    expect(source('phone-window.tsx')).toContain('<ModalWindow');
    expect(modal).toContain('<ModalWindow');
    expect(modal).toContain("event.key === 'Escape'");
    expect(modal).toContain("event.key === 'Tab'");
    expect(modal).toContain('.focus()');
    expect(modal).toContain('restoreRef');
  });
});

describe('journeys and layout (U-250)', () => {
  it('U-250: a journey step creates a work order through the dialog, and the layout audit measures both windows at 1024×640 and 1152×720', () => {
    const journeys = source('journeys.mjs');
    expect(journeys).toContain('data-new-work-order');
    expect(journeys).toContain('U-250');
    const audit = source('layout-audit.mjs');
    expect(audit).toContain('data-new-work-order');
    expect(audit).toContain('data-phone-window');
    const rules = source('layout-rules.mjs');
    expect(rules).toContain('[1024, 640]');
    expect(rules).toContain('[1152, 720]');
    expect(audit).toContain('1024×640');
    expect(audit).toContain('1152×720');
  });
});
