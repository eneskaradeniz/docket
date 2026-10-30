/// <reference types="vite/client" />
// components/settings-cards.test.ts — U-165, U-166, U-168 … U-176, U-178 … U-180 as markup and
// source scans: the nav without group titles, the Hesaplar disclosures and their empty cards, the
// account card's order, the Roller banner and its empty card, the full-width Yetenekler card, the
// copy limit and the measure of the new surfaces. Defaults live in stores/settings-cards.test.ts
// (U-167) and the width scan in screens/width-rules.test.ts (U-177).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EN } from '../labels/en';
import type { LabelKey } from '../labels/keys';
import { TR } from '../labels/tr';
import { groupAccountRows, type GroupProvider } from '../stores/account-groups';
import { SETTINGS_SECTIONS } from '../stores/settings-panel';
import { AccountGroups, type AccountRowView } from './account-groups';
import { AccountsSections } from './accounts-sections';
import { SettingsMenu } from './settings-menu';
import { RolesUnsetBanner } from './settings-cards';
import { AccountEditorDialog } from './account-editor-dialog';
import { createAccountEditorStore, type EditorOutcome } from '../stores/account-editor';
import type { SettingsAccountView } from '../../api/queries';
import type { Command } from '../../api/commands';

const SOURCES = import.meta.glob(['./settings-cards.tsx', './settings-menu.tsx', './capability-section.tsx', './accounts-sections.tsx', './provider-list.tsx', './account-editor.tsx', './account-editor-dialog.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const source = (name: string): string => {
  const hit = SOURCES[`./${name}`];
  if (hit === undefined) throw new Error(`source not globbed: ${name}`);
  return hit;
};

const noop = (): void => undefined;

const EDITOR_ACCOUNT: SettingsAccountView = {
  id: 'editor-test',
  provider: 'claude',
  label: 'İş',
  authMode: 'subscription',
  billing: 'included',
  plan: 'pro',
  limitPolicy: 'ask',
  reserve: { short: 0.1, long: 0.2 },
  hasWeeklyPool: false,
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
};

const editorHtml = (locale: 'tr' | 'en', account = EDITOR_ACCOUNT, store = createAccountEditorStore({
  run: async (_command: Command): Promise<EditorOutcome> => ({ result: { ok: true }, labelKey: 'success.account.save' }),
  now: () => 0,
})): string =>
  renderToStaticMarkup(
    createElement(AccountEditorDialog, {
      host: 'settings',
      account,
      locale,
      store,
      formatTime: () => null,
      onRefresh: noop,
      mark: null,
      title: 'Claude · İş',
      meta: '',
      billing: 'included',
      viaKey: false,
      status: { tone: 'proceed', text: locale === 'tr' ? 'Hazır' : 'Ready' },
      onClose: noop,
    }),
  );
const menu = (locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(createElement(SettingsMenu, { locale, section: 'accounts', onSection: noop, dot: false }));

describe('settings nav (U-165)', () => {
  it('U-165: no group title is drawn; the agent group is named only for assistive tech', () => {
    for (const locale of ['tr', 'en'] as const) {
      const out = menu(locale);
      for (const word of ['Çalışma', 'Uygulama', 'Work', 'App']) expect(out).not.toContain(`>${word}<`);
      const agentLabel = locale === 'tr' ? 'Ajan yetenekleri' : 'Agent capabilities';
      expect(out).toContain(`aria-label="${agentLabel}"`);
      expect(out).not.toContain(`>${agentLabel}<`);
    }
  });

  describe('settings account editor draft contract', () => {
    it('U-281: the footer appears only for a dirty draft and Saved follows a real save', async () => {
      const run = async (_command: Command): Promise<EditorOutcome> => ({ result: { ok: true }, labelKey: 'success.account.save' });
      const store = createAccountEditorStore({ run, now: () => 0 });
      const clean = editorHtml('tr', EDITOR_ACCOUNT, store);
      expect(clean).not.toContain('Kaydedilmemiş değişiklik');
      expect(clean).not.toContain('>Kaydet<');
      expect(clean).not.toContain('>Kaydedildi<');

      store.setDraftPolicy(EDITOR_ACCOUNT, 'wait_resume');
      const dirty = editorHtml('tr', EDITOR_ACCOUNT, store);
      expect(dirty).toContain('Kaydedilmemiş değişiklik');
      expect(dirty).toContain('>Vazgeç<');
      expect(dirty).toContain('>Kaydet<');
      expect(dirty).not.toContain('>Kaydedildi<');
      expect(editorHtml('en', EDITOR_ACCOUNT, store)).toContain('Unsaved change');
      expect(editorHtml('en', EDITOR_ACCOUNT, store)).toContain('>Cancel<');
      expect(editorHtml('en', EDITOR_ACCOUNT, store)).toContain('>Save<');

      await store.saveDraft(EDITOR_ACCOUNT);
      expect(editorHtml('tr', EDITOR_ACCOUNT, store)).toContain('>Kaydedildi<');
      expect(editorHtml('en', EDITOR_ACCOUNT, store)).toContain('>Saved<');
    });

    it('U-282: each differing field renders one quiet marker and reset icon, with no head reset line', () => {
      const store = createAccountEditorStore({
        run: async (_command: Command): Promise<EditorOutcome> => ({ result: { ok: true }, labelKey: 'success.account.save' }),
        now: () => 0,
      });
      store.setTab('limits');
      const html = editorHtml('tr', EDITOR_ACCOUNT, store);
      const markers = html.match(/class="h-1\.5 w-1\.5 rounded-full bg-inkdim"/g) ?? [];
      const resetButtons = html.match(/aria-label="Önerilen değere döndür"/g) ?? [];
      expect(markers).toHaveLength(2);
      expect(resetButtons).toHaveLength(2);
      expect(html).toContain('title="Önerilen: Sıfırlanınca sürdür"');
      expect(html).toContain('title="Önerilen: Yok"');
      expect(html).not.toContain('ayar önerilenden farklı');
      expect(html).not.toContain('Hepsini önerilene döndür');
      store.setDraftPolicy(EDITOR_ACCOUNT, 'wait_resume');
      expect(store.state().draft?.limitPolicy).toBe('wait_resume');
      expect(store.state().dirty).toBe(true);
    });

    it('U-283: clean closing stays silent and dirty closing uses the exact bilingual confirmation actions', () => {
      const clean = editorHtml('tr');
      expect(clean).not.toContain('role="alertdialog"');
      const dialogSource = SOURCES['./account-editor-dialog.tsx'];
      expect(dialogSource).toContain("t(locale, 'editor.footer.discardPrompt')");
      expect(dialogSource).toContain("t(locale, 'editor.footer.exitWithoutSaving')");
      expect(dialogSource).toContain("t(locale, 'editor.footer.returnToEditing')");
      expect(TR['editor.footer.discardPrompt']).toBe('Kaydedilmemiş değişiklikler var');
      expect(TR['editor.footer.exitWithoutSaving']).toBe('Kaydetmeden çık');
      expect(TR['editor.footer.returnToEditing']).toBe('Düzenlemeye dön');
      expect(EN['editor.footer.discardPrompt']).toBe('You have unsaved changes');
      expect(EN['editor.footer.exitWithoutSaving']).toBe('Exit without saving');
      expect(EN['editor.footer.returnToEditing']).toBe('Return to editing');
      expect(dialogSource).toContain('setConfirmingClose(true)');
      expect(dialogSource).toContain('store.discardDraft()');
      expect(dialogSource).toContain('confirmAction?.()');
    });
  });

  it('U-165: the rows keep the section order, one button each, and a hairline between the groups', () => {
    const out = menu();
    const labels = SETTINGS_SECTIONS.map((section) => TR[`settings.section.${section}` as LabelKey]);
    const htmlLabel = (label: string): string => label.replace(/'/g, '&#x27;');
    const positions = labels.map((label) => out.indexOf(`>${htmlLabel(label)}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect((out.match(/<button/g) ?? []).length).toBe(SETTINGS_SECTIONS.length);
    expect(out).toContain('border-t border-hairline');
  });
});

const PROVIDERS: readonly GroupProvider[] = [{ id: 'atlas', name: 'Atlas', installed: true }];
const row = (id: string): AccountRowView => ({
  id,
  providerId: 'atlas',
  standing: 'ready',
  label: id,
  billing: 'included',
  viaKey: false,
  path: `~/${id}`,
  host: null,
  status: { tone: 'proceed', text: 'Hazır' },
});

const sections = (over: Partial<Parameters<typeof AccountsSections>[0]> = {}, locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(AccountsSections, {
      locale,
      addedCount: 2,
      unaddedCount: 3,
      addedOpen: true,
      unaddedOpen: false,
      onToggle: noop,
      onAdd: noop,
      added: createElement('i', { 'data-added-body': '' }),
      unadded: createElement('i', { 'data-unadded-body': '' }),
      ...over,
    }),
  );

describe('Hesaplar disclosures (U-166, U-168 … U-170)', () => {
  it('U-166: Eklenenler and Eklenmemiş are disclosures with a chevron, a count badge and aria-expanded', () => {
    const out = sections();
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-expanded="false"');
    expect((out.match(/<button[^>]*aria-controls=/g) ?? []).length).toBe(2);
    expect((out.match(/data-count-badge/g) ?? []).length).toBe(2);
    expect(out).toContain('>Eklenenler<');
    expect(out).toContain('>Eklenmemiş<');
    expect((out.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('U-166: a closed section keeps its body out of sight', () => {
    const out = sections();
    expect(out).toMatch(/id="accounts-unadded-body"[^>]*hidden/);
    expect(out).not.toMatch(/id="accounts-added-body"[^>]*hidden/);
  });

  it('U-168: both bodies ride the same bordered panel card with 16 spacing and 12 between rows', () => {
    const out = sections();
    expect((out.match(/rounded-panel border border-hairline/g) ?? []).length).toBe(2);
    expect((out.match(/grid gap-3 p-4/g) ?? []).length).toBe(2);
  });

  it('U-169: no account added draws the centred card with a primary Hesap ekle, and the plain line is gone', () => {
    const out = sections({ addedCount: 0 });
    expect(out).toContain('data-empty-card="accounts-added"');
    expect(out).toContain('>Henüz hesap eklenmedi<');
    expect(out).toContain('>Hesap ekle<');
    expect(out).toContain('border-signal bg-signal');
    expect(out).toContain('text-center');
    expect(out).not.toContain('Henüz hesap yok.');
    expect(out).not.toContain('data-added-body');
  });

  it('U-170: nothing to add draws the Eklenecek hesap bulunamadı card and keeps the header slot free', () => {
    const out = sections({ unaddedCount: 0, unaddedOpen: true });
    expect(out).toContain('data-empty-card="accounts-unadded"');
    expect(out).toContain('>Eklenecek hesap bulunamadı<');
    expect(out).not.toContain('Eklenecek hesap bulunamadı.');
    expect(out).toContain('data-section-aside="unadded"');
    expect(out).not.toContain('>Yeniden tara<');
  });

  it('U-166: a section with accounts shows its body, not the card', () => {
    const out = sections({ unaddedOpen: true });
    expect(out).toContain('data-added-body');
    expect(out).toContain('data-unadded-body');
    expect(out).not.toContain('data-empty-card');
  });
});

describe('list bottom fade (#1354)', () => {
  it('#1354: the sections list ends with the fade strip — pinned, translucent to the window surface, never blocking the pointer', () => {
    const out = sections();
    const tag = out.match(/<div[^>]*data-list-bottom-fade[^>]*>/)?.[0] ?? '';
    expect(tag).not.toBe('');
    for (const cls of ['sticky', 'bottom-0', 'h-4', 'bg-gradient-to-b', 'from-transparent', 'to-surface', 'pointer-events-none']) {
      expect(tag, cls).toContain(cls);
    }
    expect(tag).toContain('aria-hidden="true"');
    // The strip stands after both disclosures — it is the list's own last row, not a panel's.
    expect(out.indexOf('data-list-bottom-fade')).toBeGreaterThan(out.lastIndexOf('data-account-disclosure'));
  });

  it('#1354: the fade is the one shared strip both scrolled Hesaplar lists wear', () => {
    expect(source('settings-cards.tsx')).toContain('export function ListBottomFade');
    expect(source('accounts-sections.tsx')).toContain('<ListBottomFade />');
  });
});

describe('account card order (U-171)', () => {
  const render = (actionsRight: boolean): string =>
    renderToStaticMarkup(
      createElement(AccountGroups, {
        locale: 'tr',
        groups: groupAccountRows([row('a1')], PROVIDERS),
        markFor: () => null,
        nameOf: () => 'Atlas',
        onEdit: noop,
        trailing: () => createElement('button', { type: 'button', 'data-trailing': '' }, 'Test et'),
        actionsRight,
      }),
    );

  it('U-171: identity and the status chip come first, the actions stand last at the right edge', () => {
    const out = render(true);
    const status = out.indexOf('Hazır');
    const actions = out.indexOf('data-account-actions');
    expect(status).toBeGreaterThan(0);
    expect(actions).toBeGreaterThan(status);
    expect(out.indexOf('data-trailing')).toBeGreaterThan(actions);
    expect(out.indexOf('aria-label="Düzenle"')).toBeGreaterThan(actions);
    expect(out).toMatch(/data-account-actions=""[^>]*class="[^"]*ml-auto[^"]*items-center/);
  });

  it('U-171: the wizard keeps its own order — no actions container', () => {
    expect(render(false)).not.toContain('data-account-actions');
  });
});

describe('Roller banner and empty cards (U-172 … U-175)', () => {
  const banner = (): string => renderToStaticMarkup(createElement(RolesUnsetBanner, { locale: 'tr', count: 8, onApply: noop }));

  it('U-172: the unset line is a bordered info banner with the icon on the left', () => {
    const out = banner();
    expect(out).toContain('data-roles-unset');
    expect(out).toContain('8 rol önerilen çalışma biçimini kullanmıyor');
    expect(out).toMatch(/border border-/);
    expect(out.indexOf('<svg')).toBeGreaterThan(-1);
    expect(out.indexOf('<svg')).toBeLessThan(out.indexOf('8 rol'));
  });

  it('U-173: the apply button sits inside the banner, after the text, at the right', () => {
    const out = banner();
    expect(out.indexOf('>Önerilenleri uygula<')).toBeGreaterThan(out.indexOf('8 rol'));
    expect(out.indexOf('</button>')).toBeLessThan(out.lastIndexOf('</div>'));
    expect(out).toContain('ml-auto');
  });

  it('U-174: Asistan sırası carries one short line', () => {
    expect(TR['roles.chain.purpose']).toBe('Hesaplar bu sırayla denenir.');
    expect(EN['roles.chain.purpose'].split(/\s+/).length).toBeLessThanOrEqual(8);
  });
});

describe('Ajan yetenekleri and the audit (U-176, U-180)', () => {
  it('U-176: an empty capability kind is a card with exactly one action and no width cap', () => {
    const text = source('capability-section.tsx');
    expect(text).toContain('mark={`capabilities-${section}`}');
    expect(text).toContain('capabilities.import.action');
    expect(text).not.toContain('max-w');
  });

  it('U-180: the Sağlayıcılar empty state is a card, the plain line is gone', () => {
    const text = source('provider-list.tsx');
    expect(text).toContain('EmptyCard');
    expect(text).not.toMatch(/<p[^>]*>\{t\(locale, 'providers\.empty'\)\}<\/p>/);
  });
});

const NEW_KEYS = [
  'roles.chain.purpose',
  'roles.chain.empty',
  'roles.chain.unbound',
  'roles.chain.empty.line',
  'roles.chain.unbound.line',
  'roles.chain.empty.go',
  'roles.unset.line',
  'roles.unset.apply',
  'accounts.added.empty.title',
  'accounts.added.empty.line',
  'accounts.added.empty.add',
  'accounts.unadded.empty.title',
  'accounts.unadded.empty.line',
  'providers.empty',
  'providers.empty.line',
  'capabilities.empty.memory.title',
  'capabilities.empty.memory.line',
  'capabilities.empty.roles.title',
  'capabilities.empty.roles.line',
  'capabilities.empty.plugins.title',
  'capabilities.empty.plugins.line',
  'capabilities.empty.mcp.title',
  'capabilities.empty.mcp.line',
  'capabilities.empty.skills.title',
  'capabilities.empty.skills.line',
  'capabilities.empty.commands.title',
  'capabilities.empty.commands.line',
  'capabilities.empty.hooks.title',
  'capabilities.empty.hooks.line',
  'capabilities.empty.createAction',
  'capabilities.memory.autoAccept.purpose',
  'capabilities.memory.truncated',
  'capabilities.import.action',
  'capabilities.import.manual',
  'capabilities.import.added',
  'capabilities.warning.degraded',
  'capabilities.warning.unsupported',
  'capabilities.warning.unverified',
  'settings.hint.memory',
  'settings.hint.plugins',
  'settings.hint.mcp',
  'settings.hint.skills',
  'settings.hint.commands',
  'settings.hint.hooks',
] as const satisfies readonly LabelKey[];

const U178_EXCEPTIONS = ['capabilities.import.secretNotice'] as const satisfies readonly LabelKey[];

describe('copy and measure (U-178, U-179)', () => {
  it('U-178: every sentence of the new copy is at most 8 words, in both languages', () => {
    for (const bundle of [TR, EN]) {
      for (const key of NEW_KEYS) {
        for (const sentence of bundle[key].split(/[.!?]\s*/).filter((part) => part.trim() !== '')) {
          expect(sentence.trim().split(/\s+/).length, `${key}: ${sentence}`).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('U-178: capabilities.import.secretNotice is the only U-285 exception — 10 words in English', () => {
    expect(EN['capabilities.import.secretNotice'].split(/\s+/).length).toBe(10);
    for (const key of U178_EXCEPTIONS) {
      expect(TR[key].length).toBeGreaterThan(0);
    }
  });

  it('U-178: the group titles left the bundles', () => {
    for (const bundle of [TR, EN]) {
      expect(Object.keys(bundle)).not.toContain('settings.group.work');
      expect(Object.keys(bundle)).not.toContain('settings.group.app');
    }
  });

  it('U-179: the new surfaces speak rem — no px length, radii from the four names, no max-w', () => {
    for (const name of ['settings-cards.tsx', 'settings-menu.tsx', 'accounts-sections.tsx']) {
      const text = source(name);
      expect(text, name).not.toMatch(/\[\d*\.?\d+px\]/);
      expect(text, name).not.toMatch(/(?<![\w-])rounded(?!-(?:full|control|card|panel)(?![\w-]))/);
      expect(text, name).not.toContain('max-w-');
    }
  });
});
