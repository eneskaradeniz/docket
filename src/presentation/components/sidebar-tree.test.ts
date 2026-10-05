// sidebar-tree.test.ts — U-51's Projeler half: the section header's type scale, the row sizes,
// and the empty state — a centred dashed box with a folder icon, the standing line and the
// secondary Yeni proje button that opens the U-40 page. Rendered against the real tree store
// (a resolved fake api), so the markup is the component's own output.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { ProjectTree } from '../../api/queries';
import { SidebarTree } from './sidebar-tree';
import { createProjectTreeStore } from '../stores/project-tree';
import type { ShellChangeSignal } from '../stores/shell';

const treeApi = (reply: unknown): Pick<Api, 'query'> => ({
  query: () => Promise.resolve(reply),
});

const noChange: ShellChangeSignal = () => () => undefined;

const clock = (): number => 0;

const persistence = { getItem: () => null, setItem: () => undefined } as const;

const renderTree = async (tree: ProjectTree): Promise<string> => {
  const store = createProjectTreeStore({ api: treeApi(tree), changes: noChange, now: clock, persistence });
  await store.load();
  return renderToStaticMarkup(
    createElement(SidebarTree, {
      store,
      selection: { project: null, repo: null },
      locale: 'tr',
      onOpenProject: () => undefined,
      onOpenRepo: () => undefined,
      onNewProject: () => undefined,
    }),
  );
};

const project = (name: string, repos: number): ProjectTree[number] => ({
  project: name.toLowerCase(),
  name,
  mainRepo: `${name.toLowerCase()}-ana`,
  repos: Array.from({ length: repos }, (_, index) => ({
    repo: `${name.toLowerCase()}-${index}`,
    name: `${name} Depo ${index}`,
    main: index === 0,
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle',
  })),
  active: 0,
  running: 0,
  waiting: 0,
  status: 'idle',
});

describe('SidebarTree (U-51)', () => {
  it('U-51: with no project, Projeler shows the centred dashed box — line, folder icon, Yeni proje button', async () => {
    const html = await renderTree([]);
    expect(html).toContain('Projelerin burada görünecek.');
    // The old bare line is gone.
    expect(html).not.toContain('Henüz proje yok');
    // The dashed box in the card radius, centred.
    expect(html).toContain('border-dashed');
    expect(html).toContain('rounded-card');
    expect(html).toContain('text-center');
    // The folder icon and the secondary button that opens the U-40 page.
    expect(html).toMatch(/<svg[^>]*data-folder-icon/);
    expect(html).toContain('Yeni proje');
    // The header keeps its own + button (U-40) beside the section title.
    expect(html).toContain('title="Yeni proje"');
  });

  it('U-51: the Projeler section header is 14 px/700, project and repo rows 13.5–14 px', async () => {
    const html = await renderTree([project('Docket', 2)]);
    expect(html).toMatch(/text-\[14px\][^>]*font-bold/);
    expect(html).toMatch(/text-\[13\.5px\]/);
  });
});
