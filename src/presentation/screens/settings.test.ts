import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { ProjectTree, Query, SettingsAccountView } from '../../api/queries';
import type { Actor, RepoFlow, StageSlug } from '../../domain/index';
import { parseSlug } from '../../domain/index';
import { AccountEditorPanels } from '../components/account-editor';
import { createAccountEditorStore } from '../stores/account-editor';
import { createAccountModelsStore } from '../stores/account-models';
import { createCandidatesStore } from '../stores/candidates';
import { createLocaleStore } from '../stores/locale';
import { createProviderMarksStore } from '../stores/provider-marks';
import { createProvidersStore } from '../stores/providers';
import { createRolesStore } from '../stores/roles';
import { createSettingsStore, type SettingsStore } from '../stores/settings';
import { createThemeStore } from '../stores/theme';
import { createUpdateStore } from '../stores/update';
import { SettingsPanel, SETTINGS_SECTIONS } from './settings';

// The panel reaches its bridge through `window.docket`; the node test world has no window, so a
// bare one stands in — the agent-capabilities store then talks to a bridge that answers nothing,
// which the repo section never reads.
(globalThis as { window?: unknown }).window = {};

const ACCOUNT: SettingsAccountView = {
  id: 'acc-1',
  provider: 'claude',
  label: 'Work',
  authMode: 'subscription',
  billing: 'included',
  plan: 'pro',
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: '/home/u/.claude',
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
};

describe('SETTINGS_SECTIONS', () => {
  it('U-24: update stays at the end of the list', () => {
    expect(SETTINGS_SECTIONS.at(-1)).toBe('update');
    expect(SETTINGS_SECTIONS).not.toContain('phone');
  });

  it('every section appears exactly once — a duplicated door would split the menu', () => {
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
  });
});

describe('Account editor Usage panel states (U-266, U-267)', () => {
  it('U-266: while a refresh runs in Settings, Yenile is disabled and the skeleton shows after 150 ms', () => {
    const store = createAccountEditorStore({
      run: async () => ({ result: { ok: true }, labelKey: 'success.account.save' }),
      now: () => 1000,
    });
    store.setTab('usage');

    // With refreshing: true before 150 ms: Yenile disabled, no skeleton yet, no no-usage message
    const htmlBefore = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        skeletonNow: () => 0,
      }),
    );
    expect(htmlBefore).toContain('disabled');
    expect(htmlBefore).not.toContain('data-usage-skeleton');
    expect(htmlBefore).not.toContain('Bu asistan kullanım bilgisi vermiyor');

    // With refreshing: true after 150 ms: skeleton visible
    let step = 0;
    const htmlAfter = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        skeletonNow: () => {
          const val = step;
          step += 200;
          return val;
        },
      }),
    );
    expect(htmlAfter).toContain('disabled');
    expect(htmlAfter).toContain('data-usage-skeleton');
    expect(htmlAfter).not.toContain('Bu asistan kullanım bilgisi vermiyor');
  });

  it('U-267: a failed refresh in Settings shows the reason and "Tekrar dene"; a retry re-enters the loading state', () => {
    const store = createAccountEditorStore({
      run: async () => ({ result: { ok: true }, labelKey: 'success.account.save' }),
      now: () => 1000,
    });
    store.setTab('usage');

    const htmlFailed = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: false,
        refreshFailure: 'network',
      }),
    );
    expect(htmlFailed).toContain('data-usage-error');
    expect(htmlFailed).toContain('Bağlantı kurulamadı; kullanım okunamadı.');
    expect(htmlFailed).toContain('Tekrar dene');

    // Retry re-enters loading state
    let retryStep = 0;
    const htmlRetrying = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        refreshFailure: null,
        skeletonNow: () => {
          const val = retryStep;
          retryStep += 200;
          return val;
        },
      }),
    );
    expect(htmlRetrying).not.toContain('data-usage-error');
    expect(htmlRetrying).toContain('data-usage-skeleton');
  });
});

// ——— Depo ayarları (U-301, U-302, U-283, U-288) ————————————————————————————————————————————
// The real SettingsPanel over the real stores and a fake api: the assertions read the wiring
// itself — the region, the three groups, the save bar, the four states, and the dialogs — so a
// component that stops being rendered fails here, not only in its own colocated test.

const ACTOR: Actor = { kind: 'user', id: 'settings-test', label: 'Test' };
const noop = (): void => undefined;
const changes = (): (() => void) => () => undefined;

const stage = (id: string): StageSlug => {
  const parsed = parseSlug<'stage'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};
const role = (id: string) => {
  const parsed = parseSlug<'role'>(id);
  if (!parsed.ok) throw new Error(id);
  return parsed.value;
};
const flowSlug = () => {
  const parsed = parseSlug<'flow'>('standard');
  if (!parsed.ok) throw new Error('flow slug');
  return parsed.value;
};

const sampleFlow = (): RepoFlow => ({
  flowId: flowSlug(),
  version: 1,
  stages: [{ id: stage('implement'), name: 'Implement', role: role('developer'), exit: [] }],
  bindings: [
    {
      stage: stage('implement'),
      role: { roleId: role('developer'), version: 1, overlay: { instructions: 'Local tweak.' } },
      accounts: [],
    },
  ],
});

const treeOf = (repos: readonly string[]): ProjectTree =>
  repos.length === 0
    ? []
    : [
        {
          project: 'p1',
          name: 'Proj',
          mainRepo: repos[0] ?? '',
          repos: repos.map((repo, index) => ({ repo, name: repo, main: index === 0, active: 0, running: 0, waiting: 0, status: 'idle' })),
          active: 0,
          running: 0,
          waiting: 0,
          status: 'idle',
        },
      ];

interface PanelWorld {
  readonly store: SettingsStore;
  readonly html: () => string;
}

/** The panel and every store it takes, over one fake api — `answer` decides the world the repo
 *  section lands in (populated, loading, error or empty) by answering the three queries. */
const panelOver = (answer: (query: Query) => unknown): PanelWorld => {
  const api: Pick<Api, 'query' | 'command'> = {
    query: async (query) => answer(query),
    command: async () => ({ ok: true }),
  };
  const store = createSettingsStore({ api, changes, actor: ACTOR, locale: () => 'tr' });
  const candidates = createCandidatesStore({ api, actor: ACTOR });
  const providers = createProvidersStore({ api });
  const marks = createProviderMarksStore({ api });
  const roles = createRolesStore({ api, changes, actor: ACTOR, now: () => 0 });
  const models = createAccountModelsStore({ api, changes, actor: ACTOR });
  const update = createUpdateStore({ api, changes, actor: ACTOR });
  const themeStore = createThemeStore({ getItem: () => null, setItem: noop }, { prefersDark: () => false, subscribe: () => () => undefined });
  const localeStore = createLocaleStore({ getItem: () => null, setItem: noop });
  const html = (): string =>
    renderToStaticMarkup(
      createElement(SettingsPanel, {
        open: true,
        origin: 'keyboard',
        section: 'repo',
        subPage: null,
        tab: null,
        fineTune: null,
        onOpenTarget: noop,
        onSection: noop,
        onBack: noop,
        onEnterSubPage: noop,
        onEscape: noop,
        onClose: noop,
        candidateDot: false,
        candidates,
        providers,
        themeStore,
        store,
        marks,
        models,
        roles,
        update,
        locale: 'tr',
        localeStore,
      }),
    );
  return { store, html };
};

const populatedWorld = (): PanelWorld => {
  const world = panelOver((query) => {
    if (query.type === 'project.tree') return treeOf(['web']);
    if (query.type === 'repo.flow') return { ok: true, flow: sampleFlow() };
    if (query.type === 'settings.accounts') return { accounts: [], bindings: [] };
    return { ok: false, code: 'not_found' };
  });
  return world;
};

describe('Depo ayarları on the real panel (U-301, U-302)', () => {
  it('U-301: the section renders the region with its three groups and the overlay editor — no save bar while clean', async () => {
    const { store, html } = populatedWorld();
    await store.repoSettings.load();
    const out = html();
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-label="Depo ayarları"');
    expect(out).toContain('aria-label="Akış"');
    expect(out).toContain('aria-label="Roller"');
    expect(out).toContain('aria-label="Limit politikası"');
    // The stage strip carries the stage and its role; the overlay editor is reachable (its
    // textarea and the Ayır action render).
    expect(out).toContain('>Implement<');
    expect(out).toContain('id="repo-overlay-instructions"');
    expect(out).toContain('>Ayır<');
    // Clean draft: no save bar anywhere.
    expect(out).not.toContain('data-repo-save-bar');
  });

  it('U-301: an overlay edit raises the save bar with Vazgeç / Kaydet; Kaydet is disabled only when clean', async () => {
    const { store, html } = populatedWorld();
    await store.repoSettings.load();
    store.repoSettings.setOverlayInstructions(stage('implement'), 'Another tweak.');
    const dirty = html();
    expect(dirty).toContain('data-repo-save-bar');
    expect(dirty).toContain('role="toolbar"');
    expect(dirty).toContain('Kaydedilmemiş değişiklik');
    expect(dirty).toContain('>Vazgeç<');
    const save = dirty.match(/<button[^>]*>Kaydet<\/button>/)?.[0] ?? '';
    expect(save).not.toContain('disabled=""');
    store.repoSettings.cancelDraft();
    const clean = html();
    expect(clean).not.toContain('data-repo-save-bar');
  });

  it('U-301: Detach asks through a modal dialog with its own title and confirm action', async () => {
    const { store, html } = populatedWorld();
    await store.repoSettings.load();
    store.repoSettings.requestDetach(stage('implement'));
    const out = html();
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('Rolü kütüphaneden ayır?');
    expect(out).toContain('Bu depo kendi kopyasını yönetir.');
  });

  it('U-302: no repository shows the empty state with guidance and the project-setup link', async () => {
    const { store, html } = panelOver((query) => {
      if (query.type === 'project.tree') return treeOf([]);
      return { ok: false, code: 'not_found' };
    });
    await store.repoSettings.load();
    const out = html();
    expect(out).toContain('data-repo-empty');
    expect(out).toContain('Depo yok');
    expect(out).toContain('Önce bir proje ve depo ekle.');
    expect(out).toContain('Proje kurulumunu aç');
    expect(out).not.toContain('aria-label="Akış"');
  });

  it('U-302: while the flow loads the section shows skeleton tiles and no groups', () => {
    const { store, html } = panelOver(() => new Promise(() => undefined));
    void store.repoSettings.load();
    const out = html();
    expect(out).toContain('data-repo-loading');
    expect(out).toContain('role="status"');
    expect(out).toContain('Yükleniyor…');
    expect(out).not.toContain('aria-label="Akış"');
    expect(out).not.toContain('data-repo-empty');
  });

  it('U-302: a failed repo.flow shows the error card with a retry action', async () => {
    const { store, html } = panelOver((query) => {
      if (query.type === 'project.tree') return treeOf(['web']);
      if (query.type === 'repo.flow') return { ok: false, code: 'not_found' };
      return { ok: false, code: 'not_found' };
    });
    await store.repoSettings.load();
    const out = html();
    expect(out).toContain('data-repo-error');
    expect(out).toContain('role="alert"');
    expect(out).toContain('Akış okunamadı.');
    expect(out).toContain('>Yeniden dene<');
    expect(out).not.toContain('aria-label="Akış"');
  });

  it('U-283: leaving a dirty draft raises the discard dialog with its bilingual actions', async () => {
    const { store, html } = populatedWorld();
    await store.repoSettings.load();
    store.repoSettings.setOverlayInstructions(stage('implement'), 'Another tweak.');
    expect(store.repoSettings.requestLeave()).toBe(false);
    const out = html();
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('Kaydedilmemiş değişiklikler var');
    expect(out).toContain('>Kaydetmeden çık<');
    expect(out).toContain('>Düzenlemeye dön<');
    store.repoSettings.cancelDiscardLeave();
    expect(store.repoSettings.state().confirmDiscard).toBe(false);
  });

  it('U-288: one repo draws no repo navigation; several draw the top tab bar with the active repo selected', async () => {
    const single = panelOver((query) => {
      if (query.type === 'project.tree') return treeOf(['web']);
      if (query.type === 'repo.flow') return { ok: true, flow: sampleFlow() };
      return { ok: false, code: 'not_found' };
    });
    await single.store.repoSettings.load();
    expect(single.html()).not.toContain('role="tablist"');

    const multi = panelOver((query) => {
      if (query.type === 'project.tree') return treeOf(['api', 'mobile']);
      if (query.type === 'repo.flow') return { ok: true, flow: sampleFlow() };
      return { ok: false, code: 'not_found' };
    });
    await multi.store.repoSettings.load();
    const out = multi.html();
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Depo"');
    expect(out.match(/role="tab"/g)?.length).toBe(2);
    expect(out).toContain('aria-selected="true"');
  });
});
