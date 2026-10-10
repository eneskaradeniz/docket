/// <reference types="vite/client" />
// chat-launcher-hosts.test.ts — U-129 … U-133 on the host screens themselves: the roadmap and the
// page viewer drawn over real stores inside the launcher context, and the other hosts pinned by
// their source (each mounts its row once, with the standing it already knows). The row's own
// conditions are tested in components/chat-launcher.test.ts; here the question is whether the
// screen wires them, and that nothing page-derived reaches a launcher.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { ChatScopeInput } from '../../api/commands';
import type { PageDetailView, Query, RoadmapPageView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { ChatLauncherContext } from '../components/chat-launcher';
import type { LaunchStore } from '../stores/chat-launcher';
import { createPageViewerStore, type PageViewHost } from '../stores/page-viewer';
import { createRoadmapStore } from '../stores/roadmap';
import { PageViewerScreen } from './page-viewer';
import { RoadmapScreen } from './roadmap';

const SOURCES = import.meta.glob(
  ['./cockpit.tsx', './new-project.tsx', './board.tsx', './detail.tsx', './settings.tsx', './shell.tsx', './roadmap.tsx', './page-viewer.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const source = (name: string): string => SOURCES[`./${name}`] ?? '';

const launchStore: LaunchStore = { state: () => ({ draft: '' }), openChat: () => undefined };
const within = (element: ReturnType<typeof createElement>): string =>
  renderToStaticMarkup(createElement(ChatLauncherContext.Provider, { value: { store: launchStore, locale: 'tr' } }, element));

describe('roadmap host', () => {
  const VIEW: RoadmapPageView = { phases: [], runnable: [] };
  const draw = async (wrap: boolean): Promise<string> => {
    const api: Pick<Api, 'query' | 'command'> = { query: () => Promise.resolve(VIEW), command: () => Promise.resolve({ ok: true }) };
    const store = createRoadmapStore({ api, changes: () => () => undefined });
    await store.load('antero');
    const screen = createElement(RoadmapScreen, { store, project: 'antero', name: 'Antero Başlığı', locale: 'tr', onOpenRepo: () => undefined, onOpenWorkOrder: () => undefined });
    return wrap ? within(screen) : renderToStaticMarkup(screen);
  };

  it('U-129: the roadmap draws "Docket AI ile planla" for its project after the heading', async () => {
    const html = await draw(true);
    expect(html).toContain('data-launch="plan"');
    expect(html).toContain('data-launch-scope="project:antero"');
    expect(html.indexOf('data-launch="plan"')).toBeGreaterThan(html.indexOf('Antero Başlığı'));
  });

  it('U-129: without the chat context the roadmap is exactly what it was', async () => {
    expect(await draw(false)).not.toContain('data-launch');
  });

  it('U-129: the project name is never a launcher\'s text — the scope carries the slug', async () => {
    const html = await draw(true);
    const launcher = html.slice(html.indexOf('data-launch="plan"'), html.indexOf('</button>', html.indexOf('data-launch="plan"')));
    expect(launcher).not.toContain('Antero Başlığı');
  });
});

describe('page viewer host', () => {
  const ACTOR: Actor = { kind: 'user', id: 'u-1' };
  const PAGE = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
  const detail = (delivered: boolean[]): PageDetailView => ({
    page: {
      id: PAGE,
      title: '<b>Hostile başlık</b>',
      kind: 'html',
      latestVersion: 1,
      approval: 'pending',
      updatedAt: 1,
      createdBy: { kind: 'agent', label: 'builder' },
      undeliveredComments: delivered.filter((d) => !d).length,
      versions: [{ n: 1, createdAt: 1, by: { kind: 'agent', label: 'builder' }, entry: 'index.html', files: [{ path: 'index.html', bytes: 1 }] }],
    },
    version: 1,
    comments: delivered.map((d, index) => ({ id: `c${index}`, version: 1, text: 'yorum', at: 1, delivered: d })),
  });
  const host: PageViewHost = { update: () => undefined, retry: () => undefined, state: () => ({ status: 'idle' }), subscribe: () => () => undefined, dispose: () => undefined };

  const draw = async (reply: PageDetailView, launchScope: ChatScopeInput | null): Promise<string> => {
    const api: Pick<Api, 'query' | 'command'> = {
      query: (query: Query) => Promise.resolve(query.type === 'page.detail' ? reply : null),
      command: () => Promise.resolve({ ok: true }),
    };
    const store = createPageViewerStore({ api, changes: () => () => undefined, actor: ACTOR });
    await store.open(PAGE);
    return within(createElement(PageViewerScreen, { store, host, pageId: PAGE, locale: 'tr', overlayOpen: false, now: 10, onBack: () => undefined, launchScope }));
  };

  it('U-133: a page with an open comment shows "Yorumlarımı düzelt" in the header actions, scoped as the shell said', async () => {
    const html = await draw(detail([true, false]), { kind: 'workOrder', workOrder: 'wo-3' });
    expect(html).toContain('data-launch="fixComments"');
    expect(html).toContain('data-launch-scope="workOrder:wo-3"');
    const header = html.slice(html.indexOf('data-page-header'), html.indexOf('data-page-stage'));
    expect(header).toContain('data-launch="fixComments"');
  });

  it('U-133: with every comment delivered, or none, or an unknown scope, it is hidden', async () => {
    expect(await draw(detail([true, true]), { kind: 'project', project: 'p' })).not.toContain('data-launch');
    expect(await draw(detail([]), { kind: 'project', project: 'p' })).not.toContain('data-launch');
    expect(await draw(detail([false]), null)).not.toContain('data-launch');
  });

  it('U-133: the page\'s title and comment text never appear inside the launcher', async () => {
    const html = await draw(detail([false]), { kind: 'project', project: 'p' });
    const at = html.indexOf('data-launch="fixComments"');
    const launcher = html.slice(at, html.indexOf('</button>', at));
    expect(launcher).not.toContain('Hostile');
    expect(launcher).not.toContain('yorum');
  });

  it('U-133: the viewer\'s launcher sits in the header, not over the native view area', () => {
    const text = source('page-viewer.tsx');
    expect(text.indexOf('<PageLaunchers')).toBeGreaterThan(text.indexOf('data-page-header'));
    expect(text.indexOf('<PageLaunchers')).toBeLessThan(text.indexOf('data-page-stage'));
  });
});

describe('the other hosts mount their row', () => {
  it('U-129: home (the cockpit) and the new-project screen mount the global launcher row', () => {
    expect(source('cockpit.tsx')).toContain('<HomeLaunchers');
    expect(source('new-project.tsx')).toContain('<HomeLaunchers');
  });

  it('U-130: the board mounts the work-order creation launcher inside its create form', () => {
    const text = source('board.tsx');
    expect(text).toContain('<BoardLaunchers');
    expect(text.indexOf('<BoardLaunchers')).toBeGreaterThan(text.indexOf('<BoardCreateForm'));
  });

  it('U-131: the work-order detail passes its id and its status to the launcher row', () => {
    expect(source('detail.tsx')).toMatch(/<WorkOrderLaunchers workOrder=\{workOrderId\} status=\{view\.state\.status\}/);
  });

  it('U-132: settings mounts the section launcher and closes itself before the chat opens', () => {
    expect(source('settings.tsx')).toMatch(/<SettingsLaunchers section=\{section\} onLaunch=\{onClose\}/);
  });

  it('U-126: the shell provides the launcher context once, from the chat store and the locale', () => {
    const text = source('shell.tsx');
    expect(text.match(/ChatLauncherContext\.Provider/g)?.length).toBe(2);
    expect(text).toContain('store: chat');
  });
});
