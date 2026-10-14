/// <reference types="vite/client" />
// new-project-panel.test.ts — "Proje ekle" opens as a panel like Settings (U-181 … U-190): the
// markup is drawn with the server renderer over a real store, and the wiring that lives in
// composition and effects is read off the shells' own sources, because markup cannot see it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Actor } from '../../domain/index';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import { createNewProjectStore } from '../stores/new-project';
import { NewProjectPanel } from './new-project';

const RAW = import.meta.glob(['./shell.tsx', './new-project.tsx', '../components/panel-overlay.tsx', '../stores/nav-history.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const src = (name: string): string => Object.entries(RAW).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? '';
const shell = src('shell.tsx');
const screen = src('new-project.tsx');
const overlay = src('panel-overlay.tsx');
const navHistory = src('nav-history.ts');

const actor: Actor = { kind: 'user', id: 'user-1' };
const api = {
  query: async () => [],
  command: async () => ({ ok: true }),
} as unknown as Pick<Api, 'query' | 'command'>;

const draw = (open: boolean, locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(NewProjectPanel, {
      open,
      origin: 'pointer',
      store: createNewProjectStore({ api, actor, reloadTree: async () => undefined }),
      locale,
      onClose: () => undefined,
      onDone: () => undefined,
    }),
  );

describe('the Proje ekle panel', () => {
  it('U-181: every entry goes through one opener that opens the panel, and no route is left to open', () => {
    expect(shell).toContain('onNewProject={openNewProject}');
    expect(shell.match(/onNewProject=\{/g)?.length).toBe(2);
    expect(shell).toMatch(/const openNewProject = useCallback\(\(\): void => \{[\s\S]*?type: 'open'/);
    expect(shell).not.toContain('<NewProjectScreen');
    expect(shell).not.toContain("navigate({ name: 'newProject' })");
    expect(navHistory).not.toContain('newProject');
  });

  it('U-184: the panel is the settings frame in the shared overlay, not a copy of either', () => {
    expect(overlay).toContain('<WindowFrame');
    expect(screen).toContain('<PanelOverlay');
    expect(screen).not.toContain('<WindowFrame');
    expect(screen).not.toContain('fixed inset-0');
    const html = draw(true);
    expect(html).toContain('data-window=""');
    expect(html).toContain('data-new-project-panel=""');
    expect(html).toContain('data-new-project-scrim');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`aria-label="${TR['setup.title']}"`);
  });

  it('U-183: the head carries the close control and the overlay wires Esc, the scrim and the focus return', () => {
    expect(draw(true)).toContain(`aria-label="${TR['newProject.close']}"`);
    expect(draw(true, 'en')).toContain(`aria-label="${EN['newProject.close']}"`);
    expect(overlay).toContain("event.key === 'Escape'");
    expect(overlay).toContain('focusRestoredOnClose(origin)');
    expect(overlay).toContain('onMouseDown');
    expect(overlay).toContain('motion-reduce:');
    expect(draw(false)).toBe('');
  });

  it('U-185: the approved page content stands inside the panel — cards, fields, footer', () => {
    const html = draw(true);
    for (const card of ['docket_ai', 'quick', 'detailed', 'import']) expect(html).toContain(`data-card="${card}"`);
    expect(html).toContain(TR['setup.method.group']);
    expect(html).toContain(TR['setup.quick.title']);
    expect(html).toContain(TR['newProject.cancel']);
    expect(html).toContain(TR['newProject.create']);
    expect(html).toContain(TR['newProject.copy'].replaceAll("'", '&#x27;'));
  });

  it('U-186: the page view yields while the panel is open, and its shortcuts and palette stay away', () => {
    expect(shell).toMatch(/overlayOpen=\{[^}]*newProjectPanel\.open[^}]*\}/);
    expect(shell).toMatch(/if \([^)]*wizardUp \|\| settingsPanel\.open \|\| newProjectPanel\.open\) return;/);
    expect(shell).toMatch(/modalOpen: wizardUp \|\| settingsPanel\.open \|\| newProjectPanel\.open/);
  });

  it('U-187: the chat dock hides under the open panel', () => {
    expect(shell).toContain('hidden={wizardUp || settingsPanel.open || newProjectPanel.open || phoneOpen}');
  });

  it('U-188: closing keeps the draft — opening resets nothing, only a finished creation does', () => {
    expect(shell).toMatch(/const openNewProject = useCallback\(\(\): void => \{(?:(?!reset)[\s\S])*?\}, \[/);
    expect(shell).toMatch(/const finishNewProject = useCallback\(\s*\(done: NewProjectDone\): void => \{\s*newProject\.reset\(\);/);
    expect(shell).toMatch(/onClose=\{\(\) => dispatchNewProjectPanel\(\{ type: 'close' \}\)\}/);
  });

  it('U-189: the content fills the panel width — no fixed card inside it', () => {
    expect(screen).not.toMatch(/w-\[\d+(px|rem)\]/);
    expect(screen).not.toContain('max-w-');
    expect(screen).not.toContain('mx-auto');
    expect(draw(true)).toContain('w-full');
  });

  it('U-190: copy is in both bundles and short; sizes are rem; radii are the tokens', () => {
    for (const bundle of [TR, EN]) {
      expect(bundle['newProject.close'].split(/\s+/).length).toBeLessThanOrEqual(4);
    }
    expect(screen).not.toMatch(/\d(\.\d+)?px\]/);
    expect(overlay).not.toMatch(/rounded-(?!control|card|panel|full)/);
    expect(screen).not.toMatch(/rounded-(?!control|card|panel|full)/);
  });
});
