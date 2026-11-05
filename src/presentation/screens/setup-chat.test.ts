/// <reference types="vite/client" />
// setup-chat.test.ts (screens) — the setup conversation as the main panel's screen (U-385 … U-388):
// the markup is drawn with the server renderer over a real store, and the wiring that lives in
// composition and effects — where the screen stands, what opens it, what hides around it — is read
// off the shell's and the root's own sources, because markup cannot see it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import { ACTOR, bridge, flush, type Bridge } from '../stores/chat-kit';
import { createSetupChatStore, type SetupChatStore } from '../stores/setup-chat';
import { SetupChatScreen } from './setup-chat';

const RAW = import.meta.glob(
  ['./shell.tsx', '../root.tsx', '../components/sidebar-tree.tsx', '../components/launcher-rows.tsx', './new-project.tsx', './cockpit.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const src = (name: string): string => Object.entries(RAW).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? '';
const shell = src('shell.tsx');
const root = src('root.tsx');
const sidebarTree = src('sidebar-tree.tsx');
const launcherRows = src('launcher-rows.tsx');
const newProject = src('new-project.tsx');
const cockpit = src('cockpit.tsx');

interface World {
  readonly store: SetupChatStore;
  readonly script: Bridge;
}

const world = (queries: (script: Bridge) => void = () => undefined): World => {
  const script = bridge();
  queries(script);
  const store = createSetupChatStore({ api: script.api, actor: ACTOR, changes: script.changes });
  return { store, script };
};

const draw = (worldOf: World, locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(SetupChatScreen, {
      store: worldOf.store,
      locale,
      onOpenPage: () => undefined,
      openPageId: null,
      onOpenPanelPath: () => undefined,
      onDone: () => undefined,
      onOpenAccounts: () => undefined,
      onOpenConsent: () => undefined,
      onOpenRoles: () => undefined,
    }),
  );

/** The fold's count line with its placeholder filled, the way the feed renders it. */
const fillFoldCount = (line: string, count: number): string => line.replace('{count}', String(count));

describe('where the setup conversation lives (U-385)', () => {
  it('U-385: the root composes the setup store and the shell mounts the screen in the main panel, not a route', () => {
    expect(root).toContain('createSetupChatStore({');
    expect(root).toContain('setupChat={setupChat}');
    expect(shell).toContain('<SetupChatScreen');
    // The conversation is the main panel's content, never a history entry.
    expect(shell).not.toContain("navigate({ name: 'setup'");
  });

  it('U-385: while the screen stands the dock hides and ⌘J opens nothing', () => {
    expect(shell).toMatch(/hidden=\{wizardUp \|\| settingsPanel\.open \|\| newProjectPanel\.open \|\| phoneOpen \|\| setupUp\}/);
    expect(shell).toMatch(/modalOpen: wizardUp \|\| settingsPanel\.open \|\| newProjectPanel\.open \|\| setupUp/);
  });

  it('U-385: the home launcher and the panel\'s AI path open the setup screen; the panel closes first', () => {
    // The launcher pill keeps its hook but opens the setup screen, not the chat panel.
    expect(launcherRows).toContain('data-launch="together"');
    expect(launcherRows).not.toContain('launchChat(');
    expect(cockpit).toMatch(/<HomeLaunchers onSetup=\{onSetupAi\} \/>/);
    expect(shell).toMatch(/onSetupAi=\{\(\) => void setupChat\.show\(\)\}/);
    // The panel's own AI path and its resume card step aside first, exactly as U-181 says.
    expect(newProject).toContain('onOpenSetupAi !== undefined');
    expect(shell).toMatch(/const openSetupFromPanel = useCallback\(\(\): void => \{\s*dispatchNewProjectPanel\(\{ type: 'close' \}\);\s*void setupChat\.show\(\);/);
    expect(shell).toContain('onOpenSetupAi={openSetupFromPanel}');
  });

  it('U-385: the sidebar carries the "Yeni proje" row under Projeler, lit while a turn runs', () => {
    expect(sidebarTree).toContain('data-setup-tree-row="new-project"');
    expect(shell).toContain('setupRow={');
    expect(TR['setup.chat.row']).toBe('Yeni proje');
  });

  it('U-385: a route change leaves the screen; the row shows it again', () => {
    // Both history movers leave the setup screen, so even a push of the route already current
    // (which adds no entry) steps aside.
    expect(shell).toMatch(/const move = useCallback\(\s*\(type: 'back' \| 'forward'\): void => \{\s*lastMoveRef\.current = type;\s*setupChat\.hide\(\);/);
    expect(shell).toMatch(/const navigate = useCallback\(\(next: NavRoute\): void => \{\s*lastMoveRef\.current = 'back';\s*setupChat\.hide\(\);/);
  });
});

describe('the empty start (U-386)', () => {
  it('U-386: the head, the heading, the dim sentence, the field and the pills all come from the bundle', () => {
    const html = draw(world((script) => script.onQuery('setup.draft', () => ({ draft: null }))));
    expect(html).toContain(TR['setup.title']);
    expect(html).toContain(TR['setup.ai.title']);
    expect(html).toContain(TR['setup.chat.heading']);
    expect(html).toContain(TR['setup.ai.desc']);
    expect(html).toContain(TR['setup.chat.folder']);
    expect(html).toContain(`placeholder="${TR['setup.chat.folder.placeholder']}"`);
    expect(html).toContain(TR['setup.chat.alt']);
    expect(html).toContain(TR['setup.quick.title']);
    expect(html).toContain(TR['setup.detailed.title']);
    expect(html).toContain(TR['setup.chat.existing']);
    // The start button is the screen's only primary and stands disabled on a blank field.
    expect(html).toContain(TR['setup.ai.start']);
    const startButton = html.match(/<button[^>]*data-setup-start-button="[^"]*"[^>]*>/)?.[0] ?? '';
    expect(startButton, 'the start button tag').not.toBe('');
    expect(startButton).toContain('disabled');
    expect(startButton).toContain('bg-signal');
    expect((html.match(/bg-signal/g) ?? []).length).toBe(1);
  });

  it('U-386: the English locale draws the English pack', () => {
    const html = draw(world((script) => script.onQuery('setup.draft', () => ({ draft: null }))), 'en');
    expect(html).toContain(EN['setup.chat.heading']);
    expect(html).toContain(EN['setup.ai.desc']);
    expect(html).toContain(EN['setup.chat.alt']);
    expect(html).toContain(EN['setup.chat.existing']);
  });

  it('U-386: a refused start keeps the empty start with its failure sentence', async () => {
    const w = world((script) => {
      script.onQuery('setup.draft', () => ({ draft: null }));
      script.onCommand('setup.ai.start', () => ({ ok: false, code: 'no_provider' }));
    });
    await w.store.show();
    w.store.setRepoPath('/a/b');
    await w.store.start('Kur: /a/b');
    const html = draw(w);
    expect(html).toContain(TR['setup.chat.heading']);
    expect(html).toContain(TR['setup.ai.noProvider']);
  });
});

describe('the running turn (U-387)', () => {
  /** A store standing on conversation 'c1' with the first message sent and the turn running. */
  const running = async (): Promise<World> => {
    const w = world((script) => {
      script.onCommand('setup.ai.start', () => ({ ok: true, conversation: 'c1' }));
    });
    await w.store.show();
    w.store.setRepoPath('/a/b');
    await w.store.start('Kur: /a/b');
    w.script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'started' });
    w.script.emit({ type: 'chat.thinking', conversation: 'c1', turn: 't1', text: 'Yapıya bakıyorum.' });
    w.script.emit({ type: 'chat.step', conversation: 'c1', turn: 't1', id: 's1', phase: 'called', tool: 'list_dir', target: '/a/b' });
    w.script.emit({ type: 'chat.delta', conversation: 'c1', turn: 't1', text: 'Klasörü okuyorum.' });
    await flush();
    return w;
  };

  it('U-387: the first message is the user\'s bubble with the path in mono', async () => {
    const w = world((script) => {
      script.onCommand('setup.ai.start', () => ({ ok: true, conversation: 'c1' }));
      script.onQuery('chat.conversation', () => ({
        id: 'c1', title: '', scope: { kind: 'global' }, pinned: false,
        messages: [{ id: 'm1', role: 'user', text: 'Kur: /a/b', artifacts: [] }],
        drafts: [], actions: [], grants: [],
      }));
    });
    await w.store.show();
    w.store.setRepoPath('/a/b');
    await w.store.start('Kur: /a/b');
    const html = draw(w);
    expect(html).toContain('Kur:');
    expect(html).toMatch(/<span class="font-mono">\/a\/b<\/span>/);
  });

  it('U-387: the streamed text, the thinking line and the stop word stand; thinking wins over steps', async () => {
    const html = await running().then(draw);
    expect(html).toContain('Klasörü okuyorum.');
    expect(html).toContain(TR['chat.thinking.heading']);
    expect(html).toContain('Yapıya bakıyorum.');
    // The dock's own preference order (U-377): once thinking arrived, the step rows stay hidden.
    expect(html).not.toContain('data-chat-steps');
    expect(html).toContain(`aria-label="${TR['chat.stop']}"`);
    // The composer is disabled while the turn runs, and carries no Öner tier and no usage line.
    expect(html).toMatch(/data-setup-text="[^"]*"[^>]*disabled/);
    expect(html).not.toContain(TR['chat.tier.suggest']);
    expect(html).not.toContain(TR['chat.usage.month'].split('{')[0]?.trim());
  });
});

describe('the finished turn (U-388)', () => {
  const finished = async (): Promise<World> => {
    const w = world((script) => {
      script.onCommand('setup.ai.start', () => ({ ok: true, conversation: 'c1' }));
      script.onQuery('chat.conversation', () => ({
        id: 'c1', title: '', scope: { kind: 'global' }, pinned: false,
        messages: [
          { id: 'm1', role: 'user', text: 'Kur: /a/b', artifacts: [] },
          {
            id: 'm2', role: 'assistant', text: 'Klasörü taradım.',
            artifacts: [
              { kind: 'page', id: 'pg-1', pageKind: 'html', version: 2, title: 'Kurulum özeti' },
              { kind: 'table', columns: ['Depo', 'Test'], rows: [['api', ''], ['web', 'npm test']] },
            ],
          },
        ],
        drafts: [], actions: [], grants: [],
      }));
    });
    await w.store.show();
    w.store.setRepoPath('/a/b');
    await w.store.start('Kur: /a/b');
    w.script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'started' });
    w.script.emit({ type: 'chat.step', conversation: 'c1', turn: 't1', id: 's1', phase: 'called', tool: 'list_dir' });
    w.script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'finished' });
    await flush();
    return w;
  };

  it('U-388: the stored message stands with its page card\'s Aç and the bare table, and the composer is back', async () => {
    const html = await finished().then(draw);
    expect(html).toContain('Klasörü taradım.');
    expect(html).toContain('Kurulum özeti');
    expect(html).toContain(TR['chat.card.page.open']);
    expect(html).toContain('html · sürüm 2');
    expect(html).toContain('<table');
    expect(html).toContain('>—<');
    // The steps folded under the stored message, the streamed text is gone, the composer answers.
    expect(html).toContain(fillFoldCount(TR['chat.step.fold'], 1));
    expect(html).not.toContain('Klasörü okuyorum.');
    expect(html).toContain(`aria-label="${TR['chat.send']}"`);
    expect(html).not.toContain(`aria-label="${TR['chat.stop']}"`);
  });

  it('U-388: the project_setup proposal is the one approval surface — Reddet and Onayla', async () => {
    const w = await finished();
    w.script.onQuery('proposals.list', () => [{ id: 'p1', target: 'project_setup', summary: '', at: 1 }]);
    w.script.onQuery('proposal.detail', () => ({
      summary: '', target: 'sayfa-atolyesi/repo.yaml', lines: [{ kind: 'add', text: '+ tests: npm test' }], after: '',
    }));
    w.script.emit({ type: 'setup.read.ask', conversation: 'c1' });
    w.script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't2', phase: 'finished' });
    await flush();
    const html = draw(w);
    expect(html).toContain(TR['setup.proposal.title']);
    expect(html).toContain(TR['chat.card.proposal.reject']);
    expect(html).toContain(TR['chat.card.proposal.approve']);
    expect(html).toContain('+ tests: npm test');
  });
});
