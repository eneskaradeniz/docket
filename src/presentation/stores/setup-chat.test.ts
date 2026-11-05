/// <reference types="vite/client" />
// setup-chat.test.ts — the setup conversation's own store (U-385 … U-388): the screen's standing,
// the empty start and the start command, the running turn riding the dock's own rules (streaming,
// thinking, tool steps, the fold), the finished turn's re-read, and the project_setup proposal's
// decision through proposal.decide. Driven over the scripted bridge the chat store's tests use.
import { describe, expect, it } from 'vitest';

import type { Command, CommandResult } from '../../api/commands';
import { ACTOR, bridge, flush, type Bridge } from './chat-kit';
import type { ChatStepRow } from './chat-model';
import { createSetupChatStore, type SetupChatStore } from './setup-chat';

const okStart = (conversation: string): CommandResult => ({ ok: true, conversation });

const setupWorld = (): { store: SetupChatStore; script: Bridge } => {
  const script = bridge();
  const store = createSetupChatStore({ api: script.api, actor: ACTOR, changes: script.changes, reloadTree: async () => undefined });
  return { store, script };
};

/** A store standing on a live conversation 'c1', with the first message sent. */
const liveConversation = async (): Promise<{ store: SetupChatStore; script: Bridge }> => {
  const { store, script } = setupWorld();
  script.onCommand('setup.ai.start', () => okStart('c1'));
  await store.show();
  store.setRepoPath('/a/b');
  await store.start('Kur: /a/b');
  script.queries.length = 0;
  script.commands.length = 0;
  return { store, script };
};

describe('the screen\'s standing (U-385)', () => {
  it('U-385: with no draft the screen opens on the empty start and never lists conversations', async () => {
    const { store, script } = setupWorld();
    script.onQuery('setup.draft', () => ({ draft: null }));
    await store.show();
    expect(store.state().visible).toBe(true);
    expect(store.state().conversation).toBe(null);
    expect(script.queries.map((query) => query.type)).not.toContain('chat.conversations');
    expect(script.queries.map((query) => query.type)).not.toContain('chat.conversation');
  });

  it('U-385: a standing draft is re-registered on open and its conversation shows', async () => {
    const { store, script } = setupWorld();
    script.onQuery('setup.draft', () => ({ draft: { id: 'd1', repoPath: '/eski/yol' } }));
    script.onCommand('setup.ai.start', () => okStart('c9'));
    await store.show();
    expect(script.commands[0]).toMatchObject({ type: 'setup.ai.start', draft: 'd1' });
    expect(store.state().conversation).toBe('c9');
    expect(store.state().conversationPath).toBe('/eski/yol');
    // The resumed conversation shows its stored messages, and no first message is sent.
    expect(script.commands.filter((command: Command) => command.type === 'chat.send')).toHaveLength(0);
  });

  it('U-385: events of another conversation never touch this one — a dock conversation stays out', async () => {
    const { store, script } = await liveConversation();
    script.emit({ type: 'chat.turn', conversation: 'dock-1', turn: 't1', phase: 'started' });
    script.emit({ type: 'chat.delta', conversation: 'dock-1', turn: 't1', text: 'yabancı' });
    script.emit({ type: 'chat.thinking', conversation: 'dock-1', turn: 't1', text: 'düşün' });
    expect(store.state().turn).toBe(null);
    expect(store.state().streamed).toBe('');
    expect(store.state().thinking).toBe('');
  });

  it('U-385: hiding the screen leaves the conversation standing, and show() returns to it', async () => {
    const { store, script } = await liveConversation();
    store.hide();
    expect(store.state().visible).toBe(false);
    expect(store.state().conversation).toBe('c1');
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'started' });
    expect(store.state().turn).toBe('t1');
    await store.show();
    expect(store.state().visible).toBe(true);
    expect(store.state().conversation).toBe('c1');
  });
});

describe('the empty start (U-386)', () => {
  it('U-386: a blank folder path never starts anything', async () => {
    const { store, script } = setupWorld();
    script.onQuery('setup.draft', () => ({ draft: null }));
    await store.show();
    store.setRepoPath('   ');
    await store.start('Kur: /a/b');
    expect(script.commands).toHaveLength(0);
    expect(store.state().conversation).toBe(null);
  });

  it('U-386: starting sends setup.ai.start with the trimmed path, then the first message as chat.send', async () => {
    const { store, script } = setupWorld();
    script.onQuery('setup.draft', () => ({ draft: null }));
    script.onCommand('setup.ai.start', () => okStart('c1'));
    await store.show();
    store.setRepoPath('  /yeni/proje  ');
    await store.start('Kur: /yeni/proje');
    expect(script.commands[0]).toMatchObject({ type: 'setup.ai.start', repoPath: '/yeni/proje' });
    expect(script.commands[1]).toMatchObject({ type: 'chat.send', conversation: 'c1', text: 'Kur: /yeni/proje' });
    expect(store.state().conversationPath).toBe('/yeni/proje');
  });

  it('U-386: a refused start keeps the empty start and shows its own failure sentence', async () => {
    const { store, script } = setupWorld();
    script.onQuery('setup.draft', () => ({ draft: null }));
    script.onCommand('setup.ai.start', () => ({ ok: false, code: 'no_provider' }));
    await store.show();
    store.setRepoPath('/a/b');
    await store.start('Kur: /a/b');
    expect(store.state().conversation).toBe(null);
    expect(store.state().visible).toBe(true);
    expect(store.state().note).toBe('setup.ai.noProvider');
    // The path stays: the refused start keeps the empty start as it was.
    expect(store.state().repoPath).toBe('/a/b');
  });
});

describe('the running turn (U-387)', () => {
  it('U-387: the turn streams in place, the thinking and the steps ride the dock\'s own order', async () => {
    const { store, script } = await liveConversation();
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'started' });
    expect(store.state().turn).toBe('t1');
    script.emit({ type: 'chat.delta', conversation: 'c1', turn: 't1', text: 'Mer' });
    script.emit({ type: 'chat.delta', conversation: 'c1', turn: 't1', text: 'haba' });
    expect(store.state().streamed).toBe('Merhaba');
    script.emit({ type: 'chat.thinking', conversation: 'c1', turn: 't1', text: 'önce yapıya bakayım' });
    expect(store.state().thinking).toContain('yapıya');
    script.emit({ type: 'chat.step', conversation: 'c1', turn: 't1', id: 's1', phase: 'called', tool: 'list_dir' });
    script.emit({ type: 'chat.step', conversation: 'c1', turn: 't1', id: 's1', phase: 'done', tool: 'list_dir' });
    const rows: readonly ChatStepRow[] = store.state().steps;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phase).toBe('done');
    // A step of a foreign turn never lands.
    script.emit({ type: 'chat.step', conversation: 'c1', turn: 't9', id: 's2', phase: 'called', tool: 'read_file' });
    expect(store.state().steps).toHaveLength(1);
  });

  it('U-387: the first message shows at once as the user\'s bubble while its send runs', async () => {
    const { store, script } = setupWorld();
    let answer: (value: CommandResult) => void = () => undefined;
    script.onCommand('setup.ai.start', () => okStart('c1'));
    script.onCommand('chat.send', () => new Promise<CommandResult>((resolve) => { answer = resolve; }));
    await store.show();
    store.setRepoPath('/a/b');
    const going = store.start('Kur: /a/b');
    await flush();
    expect(store.state().pending).toMatchObject({ text: 'Kur: /a/b', first: true });
    answer({ ok: true });
    await going;
    expect(store.state().pending).toBe(null);
  });

  it('U-387: while the turn runs the composer is busy and the stop control sends chat.cancel', async () => {
    const { store, script } = await liveConversation();
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'started' });
    expect(store.state().turn).toBe('t1');
    await store.cancel();
    expect(script.commands[0]).toMatchObject({ type: 'chat.cancel', conversation: 'c1' });
  });

  it('U-387: a follow-up message sends on the same conversation and restores the draft on refusal', async () => {
    const { store, script } = await liveConversation();
    script.onCommand('chat.send', () => ({ ok: false, code: 'busy' }));
    store.setDraft('bir soru daha');
    await store.send();
    expect(script.commands[0]).toMatchObject({ type: 'chat.send', conversation: 'c1', text: 'bir soru daha' });
    expect(store.state().draft).toBe('bir soru daha');
    expect(store.state().note).toBe('chat.error.busy');
  });
});

describe('the finished turn (U-388)', () => {
  it('U-388: on chat.turn finished the conversation is re-read, the stored message stands and the steps fold', async () => {
    const { store, script } = await liveConversation();
    script.onQuery('chat.conversation', () => ({
      id: 'c1',
      title: '',
      scope: { kind: 'global' },
      pinned: false,
      messages: [
        { id: 'm1', role: 'user', text: 'Kur: /a/b', artifacts: [] },
        { id: 'm2', role: 'assistant', text: 'Klasörü taradım.', artifacts: [] },
      ],
      drafts: [],
      actions: [],
      grants: [],
    }));
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'started' });
    script.emit({ type: 'chat.step', conversation: 'c1', turn: 't1', id: 's1', phase: 'called', tool: 'list_dir' });
    script.emit({ type: 'chat.delta', conversation: 'c1', turn: 't1', text: 'kısmi metin' });
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'finished' });
    await flush();
    expect(script.queries.map((query) => query.type)).toContain('chat.conversation');
    expect(store.state().messages).toHaveLength(2);
    expect(store.state().streamed).toBe('');
    expect(store.state().thinking).toBe('');
    expect(store.state().steps).toHaveLength(1);
    expect(store.state().stepsOpen).toBe(false);
    expect(store.state().turn).toBe(null);
    store.toggleSteps();
    expect(store.state().stepsOpen).toBe(true);
  });

  it('U-388: the agent\'s project_setup proposal becomes the card and approval finishes the setup', async () => {
    const { store, script } = await liveConversation();
    const body = {
      project: { name: 'Sayfa Atolyesi', repos: ['sayfa-atolyesi'] },
      repo: {
        id: 'sayfa-atolyesi',
        flow: { flowId: 'standard', version: 1, stages: [], bindings: [] },
        defaultLimitPolicy: 'wait_resume',
        commandSets: { tests: ['npm test'] },
        docsRoot: 'docs',
        testGlobs: ['**/*.test.ts'],
      },
      warnings: [],
      differsFromRecommended: [],
    };
    script.onQuery('proposals.list', () => [{ id: 'p1', target: 'project_setup', summary: 'Kurulum önerisi', at: 1 }]);
    script.onQuery('proposal.detail', () => ({
      summary: 'Kurulum önerisi',
      target: 'project_setup',
      lines: [{ kind: 'add', text: '+ test: npm test' }],
      after: JSON.stringify(body),
    }));
    script.onQuery('project.tree', () => [{ project: 'sayfa-atolyesi', name: 'Sayfa Atolyesi', firstRepo: 'sayfa-atolyesi', repos: [{ repo: 'sayfa-atolyesi' }] }]);
    script.onQuery('chat.conversation', () => ({
      id: 'c1', title: '', scope: { kind: 'global' }, pinned: false, messages: [], drafts: [], actions: [], grants: [],
    }));
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'finished' });
    await flush();
    expect(store.state().proposal?.id).toBe('p1');
    expect(store.state().proposal?.status).toBe('ready');
    await store.decideProposal('approved');
    const decided = script.commands.find((command: Command) => command.type === 'proposal.decide');
    expect(decided).toMatchObject({ type: 'proposal.decide', id: 'p1', decision: 'approved' });
    expect(store.state().done).toMatchObject({ target: { kind: 'board', repo: 'sayfa-atolyesi' }, toastKey: 'newProject.created' });
    // finish() clears the conversation: the setup is over, the screen returns to the empty start.
    store.finish();
    expect(store.state().conversation).toBe(null);
    expect(store.state().visible).toBe(false);
  });

  it('U-388: rejection decides and keeps the conversation open for the next message', async () => {
    const { store, script } = await liveConversation();
    script.onQuery('proposals.list', () => [{ id: 'p1', target: 'project_setup', summary: 'Kurulum önerisi', at: 1 }]);
    script.onQuery('proposal.detail', () => ({ summary: '', target: '', lines: [], after: '' }));
    script.onQuery('chat.conversation', () => ({
      id: 'c1', title: '', scope: { kind: 'global' }, pinned: false, messages: [], drafts: [], actions: [], grants: [],
    }));
    script.emit({ type: 'chat.turn', conversation: 'c1', turn: 't1', phase: 'finished' });
    await flush();
    await store.decideProposal('rejected');
    expect(script.commands.find((command: Command) => command.type === 'proposal.decide')).toMatchObject({ decision: 'rejected' });
    expect(store.state().done).toBe(null);
    expect(store.state().conversation).toBe('c1');
    expect(store.state().proposal?.decided).toBe('rejected');
  });
});

describe('the read-permission prompt (U-272 … U-279, unchanged)', () => {
  it('U-387: an ask opens the one prompt and the answer rides setup.read.answer', async () => {
    const { store, script } = await liveConversation();
    script.onQuery('setup.read.pending', () => ({ ask: { path: '/a/b/.env.local', reason: 'paket kilidi' }, secrets: 0 }));
    script.emit({ type: 'setup.read.ask', conversation: 'c1' });
    await flush();
    expect(store.state().permission).toMatchObject({ path: '/a/b/.env.local' });
    store.allowPermission();
    expect(script.commands[0]).toMatchObject({ type: 'setup.read.answer', conversation: 'c1', path: '/a/b/.env.local', allow: true });
    expect(store.state().permission).toBe(null);
  });
});
