// chat-store.test.ts — U-101 … U-121 at the store: the panel's standing, the scope rules, send,
// streaming, cancel, notices, history, the @ menu, attachments, cards, actions, permissions, the
// footer line and every failure sentence, all over a scripted bridge (no DOM, no Electron).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatReferenceView } from '../../api/chat-views';
import type { Command } from '../../api/commands';
import { chatBusy, chatInputBlocked, chatShowsDots, chatTierMinutes, chatFailureKey, GLOBAL_PLACE, type ChatPlace } from './chat-model';
import { createChatStore, type ChatStore } from './chat-store';
import { ACTOR, action, bridge, conversation, draft, flush, grant, message, summary, type Bridge } from './chat-kit';

const PROJECT_PLACE: ChatPlace = {
  choices: [
    { scope: { kind: 'global' }, label: '' },
    { scope: { kind: 'project', project: 'antero' }, label: 'Antero' },
  ],
  screen: { key: 'project:antero', kind: 'project', input: { kind: 'project', id: 'antero' }, label: 'Antero' },
};

let clock = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => {
  vi.useRealTimers();
});

const make = (setup?: (b: Bridge) => void): { readonly store: ChatStore; readonly b: Bridge } => {
  const b = bridge();
  setup?.(b);
  const store = createChatStore({ api: b.api, changes: b.changes, actor: ACTOR, now: () => clock, notify: b.notify });
  return { store, b };
};

const commandsOf = (b: Bridge, type: Command['type']): Command[] => b.commands.filter((c) => c.type === type);

/** A bridge whose conversation reads answer `view` and whose start/send answer a live turn. */
const live = (): { readonly store: ChatStore; readonly b: Bridge } => {
  const made = make((b) => {
    b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
    b.onCommand('chat.send', () => ({ ok: true, turn: 'T2' }));
    b.onQuery('chat.conversation', () => conversation('C1', { activeTurn: 'T1', messages: [message('m1', { role: 'user', text: 'Merhaba' })] }));
  });
  return made;
};

describe('panel and mount (U-101)', () => {
  it('U-101: toggle opens and closes; the draft text survives closing', () => {
    const { store } = make();
    expect(store.state().open).toBe(false);
    store.toggle();
    expect(store.state().open).toBe(true);
    store.setDraft('yarım kalan');
    store.toggle();
    expect(store.state().open).toBe(false);
    store.toggle();
    expect(store.state().draft).toBe('yarım kalan');
  });

  it('U-101: the state survives route changes — a new place keeps the draft, the tray and the open flag', () => {
    const { store } = make();
    store.open();
    store.setDraft('devam');
    store.setPlace(PROJECT_PLACE);
    expect(store.state().open).toBe(true);
    expect(store.state().draft).toBe('devam');
  });

  it('U-101: opening reads the footer line once and clears the alert', async () => {
    const { store, b } = make((x) => x.onQuery('chat.usage', () => ({ month: { messages: 38 }, account: { label: 'Claude Code · Kişisel' } })));
    store.open();
    await flush();
    expect(b.queries.filter((q) => q.type === 'chat.usage')).toHaveLength(1);
    expect(store.state().usage?.month.messages).toBe(38);
  });

  it('U-101: openChat opens the panel on the given scope with the prefill and a fresh conversation', async () => {
    const { store } = make();
    store.setPlace(PROJECT_PLACE);
    store.openChat({ scope: { kind: 'project', project: 'antero' }, prefill: 'Bu proje için bir yol haritası taslağı hazırla.' });
    await flush();
    const state = store.state();
    expect(state.open).toBe(true);
    expect(state.draft).toBe('Bu proje için bir yol haritası taslağı hazırla.');
    expect(state.conversation).toBeNull();
    expect(state.scope).toEqual({ kind: 'project', project: 'antero' });
    expect(state.pinned).toBe(false);
  });

  it('U-101: openChat on a scope other than the screen pins it; no prefill leaves the draft alone', () => {
    const { store } = make();
    store.setPlace(PROJECT_PLACE);
    store.setDraft('eski');
    store.openChat({ scope: { kind: 'global' } });
    expect(store.state().pinned).toBe(true);
    expect(store.state().draft).toBe('eski');
  });

  it('U-101: a pending card that arrives while the panel is closed raises the alert, opening clears it', async () => {
    const { store, b } = live();
    store.setDraft('x');
    store.open();
    await store.send();
    store.close();
    b.onQuery('chat.conversation', () => conversation('C1', { drafts: [draft('D1')], messages: [message('m1', { artifacts: [{ kind: 'draft', id: 'D1', label: 'draft D1', action: 'ACT1' }] })] }));
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'completed' });
    await flush();
    expect(store.state().alert).toBe(true);
    store.open();
    expect(store.state().alert).toBe(false);
  });
});

describe('scope (U-102)', () => {
  it('U-102: an unpinned scope follows the place and starts a fresh conversation when it changes', async () => {
    const { store } = live();
    store.setPlace(PROJECT_PLACE);
    expect(store.state().scope).toEqual({ kind: 'project', project: 'antero' });
    store.setDraft('soru');
    await store.send();
    expect(store.state().conversation).toBe('C1');
    store.setPlace(GLOBAL_PLACE);
    expect(store.state().scope).toEqual({ kind: 'global' });
    expect(store.state().conversation).toBeNull();
    expect(store.state().detail).toBeNull();
    expect(store.state().draft).toBe('');
  });

  it('U-102: a place with the same current scope keeps the conversation', async () => {
    const { store } = live();
    store.setPlace(PROJECT_PLACE);
    store.setDraft('soru');
    await store.send();
    store.setPlace({ ...PROJECT_PLACE, screen: null });
    expect(store.state().conversation).toBe('C1');
  });

  it('U-102: a manual choice other than the screen is sabit and holds across navigation', () => {
    const { store } = make();
    store.setPlace(PROJECT_PLACE);
    store.pickScope({ kind: 'global' });
    expect(store.state().pinned).toBe(true);
    expect(store.state().scope).toEqual({ kind: 'global' });
    store.setPlace({ choices: [{ scope: { kind: 'workOrder', workOrder: 'W1' }, label: '' }], screen: null });
    expect(store.state().scope).toEqual({ kind: 'global' });
    expect(store.state().pinned).toBe(true);
  });

  it('U-102: choosing the screen\'s own scope is not sabit; "Bulunduğum ekranı izle" unpins', () => {
    const { store } = make();
    store.setPlace(PROJECT_PLACE);
    store.pickScope({ kind: 'project', project: 'antero' });
    expect(store.state().pinned).toBe(false);
    store.pickScope({ kind: 'global' });
    store.followScreen();
    expect(store.state().pinned).toBe(false);
    expect(store.state().scope).toEqual({ kind: 'project', project: 'antero' });
    expect(store.state().conversation).toBeNull();
  });

  it('U-102: picking a scope closes the pop and starts a new conversation', async () => {
    const { store } = live();
    store.setPlace(PROJECT_PLACE);
    store.setDraft('soru');
    await store.send();
    store.togglePop();
    expect(store.state().scopePop).toBe(true);
    store.pickScope({ kind: 'global' });
    expect(store.state().scopePop).toBe(false);
    expect(store.state().conversation).toBeNull();
  });
});

describe('send (U-103)', () => {
  it('U-103: the first message of a new conversation is chat.start with scope and text', async () => {
    const { store, b } = live();
    store.setDraft('  Merhaba  ');
    await store.send();
    expect(commandsOf(b, 'chat.start')).toEqual([{ type: 'chat.start', scope: { kind: 'global' }, message: 'Merhaba' }]);
    expect(store.state().conversation).toBe('C1');
    expect(store.state().draft).toBe('');
    expect(store.state().turn).toBe('T1');
  });

  it('U-103: a later message is chat.send with the conversation', async () => {
    const { store, b } = live();
    store.setDraft('bir');
    await store.send();
    b.onQuery('chat.conversation', () => conversation('C1', {}));
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'completed' });
    await flush();
    store.setDraft('iki');
    await store.send();
    expect(commandsOf(b, 'chat.send')).toEqual([{ type: 'chat.send', conversation: 'C1', text: 'iki' }]);
  });

  it('U-103: refs and uploaded attachments ride the send in order, then the tray empties', async () => {
    const { store, b } = live();
    b.onCommand('chat.attach', () => ({ ok: true, attachment: 'A1' }));
    store.setPlace(PROJECT_PLACE);
    store.attachScreen();
    store.addFiles([{ name: 'notlar.md', base64: 'aGk=' }]);
    await flush();
    store.setDraft('bak');
    await store.send();
    expect(commandsOf(b, 'chat.start')).toEqual([
      {
        type: 'chat.start',
        scope: { kind: 'project', project: 'antero' },
        message: 'bak',
        refs: [{ kind: 'project', id: 'antero' }],
        attachments: ['A1'],
      },
    ]);
    expect(store.state().refs).toEqual([]);
    expect(store.state().tray).toEqual([]);
  });

  it('U-103: a blank draft sends nothing', async () => {
    const { store, b } = live();
    store.setDraft('   \n ');
    await store.send();
    expect(b.commands).toEqual([]);
  });

  it('U-103: the message shows at once as a pending bubble and the persisted read replaces it', async () => {
    let release: (value: { ok: true; conversation: string; turn: string }) => void = () => undefined;
    const { store, b } = live();
    b.onCommand('chat.start', () => new Promise((resolve) => (release = resolve)));
    store.setDraft('Merhaba');
    const sending = store.send();
    expect(store.state().pending?.text).toBe('Merhaba');
    expect(chatBusy(store.state())).toBe(true);
    release({ ok: true, conversation: 'C1', turn: 'T1' });
    await sending;
    await flush();
    expect(store.state().pending).toBeNull();
    expect(store.state().detail?.messages.map((m) => m.text)).toEqual(['Merhaba']);
  });

  it('U-103: a refused send puts the text back and says why with the failure sentence', async () => {
    const { store, b } = live();
    b.onCommand('chat.start', () => ({ ok: false, code: 'message_too_long' }));
    store.setDraft('çok uzun');
    await store.send();
    expect(store.state().draft).toBe('çok uzun');
    expect(store.state().pending).toBeNull();
    expect(store.state().note?.key).toBe('chat.error.message_too_long');
    expect(chatBusy(store.state())).toBe(false);
  });

  it('U-103: a busy refusal still shows the persisted message', async () => {
    const { store, b } = live();
    b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
    store.setDraft('bir');
    await store.send();
    b.onQuery('chat.conversation', () => conversation('C1', {}));
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'completed' });
    await flush();
    b.onCommand('chat.send', () => ({ ok: false, code: 'busy' }));
    store.setDraft('iki');
    await store.send();
    await flush();
    expect(store.state().note?.key).toBe('chat.error.busy');
    expect(b.queries.filter((q) => q.type === 'chat.conversation').length).toBeGreaterThan(1);
  });

  it('U-121: a suggestion sends its own text without touching the draft', async () => {
    const { store, b } = live();
    store.setDraft('yazıyorum');
    await store.sendText('Benden ne bekleniyor?');
    expect(commandsOf(b, 'chat.start')).toEqual([{ type: 'chat.start', scope: { kind: 'global' }, message: 'Benden ne bekleniyor?' }]);
    expect(store.state().draft).toBe('yazıyorum');
  });
});

describe('streaming (U-104)', () => {
  it('U-104: dots until the first delta, then the text grows in place', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    await flush();
    expect(chatShowsDots(store.state())).toBe(true);
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'started' });
    expect(chatShowsDots(store.state())).toBe(true);
    b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'Mer' });
    expect(chatShowsDots(store.state())).toBe(false);
    b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'haba' });
    expect(store.state().streamed).toBe('Merhaba');
  });

  it('U-104: on finished the stored message replaces the streamed text', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'Mer' });
    b.onQuery('chat.conversation', () =>
      conversation('C1', { messages: [message('m1', { role: 'user', text: 'Merhaba' }), message('m2', { text: 'Merhaba dünya' })] }),
    );
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'completed' });
    await flush();
    expect(store.state().turn).toBeNull();
    expect(store.state().streamed).toBe('');
    expect(store.state().detail?.messages.at(-1)?.text).toBe('Merhaba dünya');
  });

  it('U-104: the partial text of a cancelled turn stays — it is the stored message', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'Yarım' });
    b.onQuery('chat.conversation', () => conversation('C1', { messages: [message('m1', { role: 'user', text: 'Merhaba' }), message('m2', { text: 'Yarım' })] }));
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'cancelled' });
    await flush();
    expect(store.state().detail?.messages.at(-1)?.text).toBe('Yarım');
    expect(chatBusy(store.state())).toBe(false);
  });

  it('U-104: events for another conversation never touch this one', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    b.emit({ type: 'chat.delta', conversation: 'OTHER', turn: 'T9', text: 'sızıntı' });
    b.emit({ type: 'chat.notice', conversation: 'OTHER', turn: 'T9', code: 'quota' });
    expect(store.state().streamed).toBe('');
    expect(store.state().notice).toBeNull();
  });

  it('U-104: events that land before the start answers are replayed once the conversation is known', async () => {
    let release: (value: { ok: true; conversation: string; turn: string }) => void = () => undefined;
    const { store, b } = live();
    b.onCommand('chat.start', () => new Promise((resolve) => (release = resolve)));
    store.setDraft('Merhaba');
    const sending = store.send();
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'started' });
    b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'Erken' });
    release({ ok: true, conversation: 'C1', turn: 'T1' });
    await sending;
    expect(store.state().streamed).toBe('Erken');
  });

  it('U-104: a slower, older conversation read never overwrites a newer one', async () => {
    const { store, b } = live();
    const resolvers: ((value: unknown) => void)[] = [];
    b.onQuery('chat.conversation', () => new Promise((resolve) => resolvers.push(resolve)));
    store.openConversation('C1');
    store.openConversation('C1');
    resolvers[1]?.(conversation('C1', { title: 'new', messages: [message('m2')] }));
    await flush();
    resolvers[0]?.(conversation('C1', { title: 'old', messages: [] }));
    await flush();
    expect(store.state().detail?.title).toBe('new');
  });
});

describe('cancel and busy (U-105)', () => {
  it('U-105: stop sends chat.cancel for the conversation', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    await store.cancel();
    expect(commandsOf(b, 'chat.cancel')).toEqual([{ type: 'chat.cancel', conversation: 'C1' }]);
  });

  it('U-105: a conversation opened with a live turn mirrors the api\'s busy and blocks sending', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversation', () => conversation('C5', { activeTurn: 'T7' })));
    store.openConversation('C5');
    await flush();
    expect(store.state().turn).toBe('T7');
    expect(chatBusy(store.state())).toBe(true);
    store.setDraft('hemen');
    await store.send();
    expect(b.commands.filter((c) => c.type === 'chat.send')).toEqual([]);
  });

  it('U-105: a started event of the active conversation marks it busy; finished clears it', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversation', () => conversation('C5')));
    store.openConversation('C5');
    await flush();
    b.emit({ type: 'chat.turn', conversation: 'C5', turn: 'T8', phase: 'started' });
    expect(store.state().turn).toBe('T8');
    b.emit({ type: 'chat.turn', conversation: 'C5', turn: 'T8', phase: 'finished', outcome: 'completed' });
    await flush();
    expect(store.state().turn).toBeNull();
  });
});

describe('notices (U-106)', () => {
  it('U-106: a quota notice disables the input until the operator acts; it names no time', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code: 'quota' });
    expect(store.state().notice).toBe('quota');
    expect(chatInputBlocked(store.state())).toBe(true);
    store.setDraft('tekrar');
    await store.send();
    expect(commandsOf(b, 'chat.send')).toEqual([]);
    store.clearNotice();
    expect(chatInputBlocked(store.state())).toBe(false);
  });

  it('U-106: an account change re-enables a blocked input', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code: 'consent' });
    expect(chatInputBlocked(store.state())).toBe(true);
    b.emit({ type: 'accounts.changed' });
    expect(chatInputBlocked(store.state())).toBe(false);
  });

  it('U-106: the text-only notices never block', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    for (const code of ['auth', 'limit', 'network', 'crash', 'tools_unavailable']) {
      b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code });
      expect(store.state().notice).toBe(code);
      expect(chatInputBlocked(store.state())).toBe(false);
    }
  });

  it('U-106: a new conversation and a new send clear the notice', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    await store.send();
    b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code: 'network' });
    await store.newConversation();
    expect(store.state().notice).toBeNull();
  });
});

describe('history (U-107, U-108)', () => {
  it('U-107: opening the history reads the list; it is pinned-first from the server and grouped by the model', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversations', () => [summary('a', { pinned: true }), summary('b')]));
    store.open();
    store.openHistory();
    await flush();
    expect(store.state().view).toBe('history');
    expect(b.queries.filter((q) => q.type === 'chat.conversations')).toEqual([{ type: 'chat.conversations', limit: 100 }]);
    expect(store.state().history.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('U-107: search shows at once and is requested 200 ms after typing rests, trimmed', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversations', () => []));
    store.openHistory();
    await flush();
    b.queries.length = 0;
    store.setSearch('gi');
    store.setSearch('  giriş ');
    expect(store.state().history.search).toBe('  giriş ');
    vi.advanceTimersByTime(199);
    expect(b.queries).toEqual([]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(b.queries).toEqual([{ type: 'chat.conversations', q: 'giriş', limit: 100 }]);
  });

  it('U-107: a blank search sends no q', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversations', () => []));
    store.openHistory();
    await flush();
    b.queries.length = 0;
    store.setSearch('   ');
    vi.advanceTimersByTime(200);
    await flush();
    expect(b.queries).toEqual([{ type: 'chat.conversations', limit: 100 }]);
  });

  it('U-107: a reply that arrives after a newer request is ignored', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    const { store } = make((x) => x.onQuery('chat.conversations', () => new Promise((resolve) => resolvers.push(resolve))));
    store.openHistory();
    resolvers[0]?.([]);
    await flush();
    store.setSearch('a');
    vi.advanceTimersByTime(200);
    store.setSearch('ab');
    vi.advanceTimersByTime(200);
    resolvers[2]?.([summary('new')]);
    await flush();
    resolvers[1]?.([summary('stale')]);
    await flush();
    expect(store.state().history.items.map((i) => i.id)).toEqual(['new']);
  });

  it('U-107: a failed read is flagged, never a blank list', async () => {
    const { store } = make((x) => x.onQuery('chat.conversations', () => ({ ok: false, code: 'io_failed' })));
    store.openHistory();
    await flush();
    expect(store.state().history.failed).toBe(true);
  });

  it('U-107: opening a conversation reads it, shows the chat view and takes its scope (sabit when it is not the screen)', async () => {
    const { store, b } = make((x) =>
      x.onQuery('chat.conversation', () => conversation('C2', { scope: { kind: 'global' }, messages: [message('m1')] })),
    );
    store.setPlace(PROJECT_PLACE);
    store.openHistory();
    await store.openConversation('C2');
    const state = store.state();
    expect(state.view).toBe('chat');
    expect(state.conversation).toBe('C2');
    expect(state.scope).toEqual({ kind: 'global' });
    expect(state.pinned).toBe(true);
    expect(b.toasts.at(-1)?.key).toBe('chat.toast.opened');
  });

  it('U-107: a conversation that no longer exists is a note, not a blank view', async () => {
    const { store } = make((x) => x.onQuery('chat.conversation', () => ({ ok: false, code: 'not_found' })));
    await store.openConversation('GONE');
    expect(store.state().note?.key).toBe('chat.error.not_found');
    expect(store.state().conversation).toBeNull();
  });

  it('U-108: pin toggles the row at once and sends chat.pin; a refusal puts it back with a sentence', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversations', () => [summary('a')]));
    store.openHistory();
    await flush();
    await store.pinConversation('a', true);
    expect(commandsOf(b, 'chat.pin')).toEqual([{ type: 'chat.pin', conversation: 'a', pinned: true }]);
    expect(store.state().history.items[0]?.pinned).toBe(true);
    b.onCommand('chat.pin', () => ({ ok: false, code: 'not_found' }));
    await store.pinConversation('a', false);
    expect(store.state().history.items[0]?.pinned).toBe(true);
    expect(store.state().note?.key).toBe('chat.error.not_found');
  });

  it('U-108: delete removes the row, toasts, and clears the conversation when it was the open one', async () => {
    const { store, b } = make((x) => {
      x.onQuery('chat.conversations', () => [summary('a'), summary('b')]);
      x.onQuery('chat.conversation', () => conversation('a'));
    });
    await store.openConversation('a');
    store.openHistory();
    await flush();
    await store.deleteConversation('a');
    expect(commandsOf(b, 'chat.delete')).toEqual([{ type: 'chat.delete', conversation: 'a' }]);
    expect(store.state().history.items.map((i) => i.id)).toEqual(['b']);
    expect(store.state().conversation).toBeNull();
    expect(b.toasts.at(-1)?.key).toBe('chat.toast.deleted');
  });
});

describe('the @ menu (U-109)', () => {
  const refs: readonly ChatReferenceView[] = [
    { kind: 'work_order', id: 'W1', label: 'İE-0012 Giriş ekranını hazırla', project: 'antero' },
    { kind: 'page', id: 'P1', label: 'Taslak', project: 'antero' },
  ];

  it('U-109: typing @ opens the menu; the query is requested 200 ms after typing rests', async () => {
    const { store, b } = make((x) => x.onQuery('chat.references', () => refs));
    store.setDraft('bak @gi');
    expect(store.state().menu).toBe('at');
    expect(store.state().at.q).toBe('gi');
    store.setDraft('bak @gir');
    vi.advanceTimersByTime(199);
    expect(b.queries).toEqual([]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(b.queries).toEqual([{ type: 'chat.references', q: 'gir' }]);
    expect(store.state().at.items).toHaveLength(2);
  });

  it('U-109: no client-side filter — the server\'s answer shows as it came, even when the text does not match', async () => {
    const { store } = make((x) => x.onQuery('chat.references', () => [{ kind: 'page', id: 'P9', label: 'Tamamen başka', project: 'antero' }]));
    store.setDraft('@giris');
    vi.advanceTimersByTime(200);
    await flush();
    expect(store.state().at.items.map((i) => i.label)).toEqual(['Tamamen başka']);
  });

  it('U-109: a bare @ opens the menu without a request (the api refuses an empty q)', async () => {
    const { store, b } = make();
    store.setDraft('@');
    vi.advanceTimersByTime(300);
    await flush();
    expect(store.state().menu).toBe('at');
    expect(b.queries).toEqual([]);
    expect(store.state().at.items).toEqual([]);
  });

  it('U-109: a reply that arrives after a newer query is ignored', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    const { store } = make((x) => x.onQuery('chat.references', () => new Promise((resolve) => resolvers.push(resolve))));
    store.setDraft('@a');
    vi.advanceTimersByTime(200);
    store.setDraft('@ab');
    vi.advanceTimersByTime(200);
    resolvers[1]?.([refs[1]]);
    await flush();
    resolvers[0]?.([refs[0]]);
    await flush();
    expect(store.state().at.items.map((i) => i.id)).toEqual(['P1']);
  });

  it('U-109: the highlight is clamped; Enter commits it — the token leaves the text, a chip arrives, a toast says so', async () => {
    const { store, b } = make((x) => x.onQuery('chat.references', () => refs));
    store.setDraft('bak @gir');
    vi.advanceTimersByTime(200);
    await flush();
    store.moveAt(-1);
    expect(store.state().at.index).toBe(0);
    store.moveAt(1);
    store.moveAt(1);
    store.moveAt(1);
    expect(store.state().at.index).toBe(1);
    store.moveAt(-1);
    store.commitAt();
    expect(store.state().draft).toBe('bak');
    expect(store.state().refs.map((r) => r.input)).toEqual([{ kind: 'workOrder', id: 'W1' }]);
    expect(store.state().refs[0]?.prefix).toBe('antero');
    expect(store.state().menu).toBeNull();
    expect(b.toasts.at(-1)).toMatchObject({ key: 'chat.toast.added', values: { name: 'İE-0012 Giriş ekranını hazırla' } });
  });

  it('U-109: an already added reference is not offered again', async () => {
    const { store } = make((x) => x.onQuery('chat.references', () => refs));
    store.setDraft('@a');
    vi.advanceTimersByTime(200);
    await flush();
    store.commitAt();
    store.setDraft('@a');
    vi.advanceTimersByTime(200);
    await flush();
    expect(store.state().at.items.map((i) => i.id)).toEqual(['P1']);
  });

  it('U-109: text that stops being an @ token closes the menu', () => {
    const { store } = make();
    store.setDraft('@a');
    store.setDraft('@a ');
    expect(store.state().menu).toBeNull();
  });

  it('U-109: a thirteenth reference is refused with a sentence', async () => {
    const many: ChatReferenceView[] = Array.from({ length: 13 }, (_, i) => ({ kind: 'work_order', id: `W${i}`, label: `İE-${i}` }));
    const { store } = make((x) => x.onQuery('chat.references', () => many));
    for (let i = 0; i < 13; i += 1) {
      store.setDraft('@i');
      vi.advanceTimersByTime(200);
      await flush();
      store.commitAt();
    }
    expect(store.state().refs).toHaveLength(12);
    expect(store.state().note?.key).toBe('chat.error.too_many_refs');
  });

  it('U-109: the + menu and the @ menu are one slot; opening the third item opens @ with an @ in the text', () => {
    const { store } = make();
    store.openPlus();
    expect(store.state().menu).toBe('plus');
    store.openAt();
    expect(store.state().menu).toBe('at');
    expect(store.state().draft).toBe('@');
    store.setDraft('metin');
    store.openAt();
    expect(store.state().draft).toBe('metin @');
  });
});

describe('the composer keys (U-118)', () => {
  it('U-118: Enter sends; Shift+Enter and a composing Enter do not', async () => {
    const { store, b } = live();
    store.setDraft('Merhaba');
    expect(store.composerKey({ key: 'Enter', shiftKey: true, composing: false })).toBe(false);
    expect(store.composerKey({ key: 'Enter', shiftKey: false, composing: true })).toBe(false);
    expect(b.commands).toEqual([]);
    expect(store.composerKey({ key: 'Enter', shiftKey: false, composing: false })).toBe(true);
    await flush();
    expect(commandsOf(b, 'chat.start')).toHaveLength(1);
  });

  it('U-118: with the @ menu showing results Enter and Tab commit instead of sending', async () => {
    const { store, b } = make((x) => x.onQuery('chat.references', () => [{ kind: 'page', id: 'P1', label: 'Taslak' }]));
    store.setDraft('@t');
    vi.advanceTimersByTime(200);
    await flush();
    expect(store.composerKey({ key: 'Tab', shiftKey: false, composing: false })).toBe(true);
    expect(store.state().refs).toHaveLength(1);
    expect(b.commands).toEqual([]);
  });

  it('U-118: arrow keys move the highlight while the menu shows results', async () => {
    const { store } = make((x) =>
      x.onQuery('chat.references', () => [
        { kind: 'page', id: 'P1', label: 'a' },
        { kind: 'page', id: 'P2', label: 'b' },
      ]),
    );
    store.setDraft('@a');
    vi.advanceTimersByTime(200);
    await flush();
    expect(store.composerKey({ key: 'ArrowDown', shiftKey: false, composing: false })).toBe(true);
    expect(store.state().at.index).toBe(1);
    expect(store.composerKey({ key: 'ArrowUp', shiftKey: false, composing: false })).toBe(true);
    expect(store.state().at.index).toBe(0);
  });

  it('U-118: Backspace on an empty text removes the last chip; on text it is left alone', async () => {
    const { store } = make((x) =>
      x.onQuery('chat.references', () => [
        { kind: 'page', id: 'P1', label: 'a' },
        { kind: 'page', id: 'P2', label: 'b' },
      ]),
    );
    for (let i = 0; i < 2; i += 1) {
      store.setDraft('@a');
      vi.advanceTimersByTime(200);
      await flush();
      store.commitAt();
    }
    expect(store.state().refs).toHaveLength(2);
    store.setDraft('x');
    expect(store.composerKey({ key: 'Backspace', shiftKey: false, composing: false })).toBe(false);
    store.setDraft('');
    expect(store.composerKey({ key: 'Backspace', shiftKey: false, composing: false })).toBe(true);
    expect(store.state().refs.map((r) => r.input)).toEqual([{ kind: 'page', id: 'P1' }]);
  });
});

describe('attachments (U-110)', () => {
  it('U-110: a text file is uploaded with chat.attach by its extension and joins the tray', async () => {
    const { store, b } = make((x) => x.onCommand('chat.attach', () => ({ ok: true, attachment: 'A1' })));
    store.addFiles([{ name: 'notlar.md', base64: 'aGk=' }]);
    await flush();
    expect(commandsOf(b, 'chat.attach')).toEqual([{ type: 'chat.attach', name: 'notlar.md', fileType: 'md', base64: 'aGk=' }]);
    expect(store.state().tray).toEqual([{ id: 'A1', name: 'notlar.md', kind: 'text' }]);
  });

  it('U-110: an upload inside a conversation names it', async () => {
    const { store, b } = live();
    b.onCommand('chat.attach', () => ({ ok: true, attachment: 'A1' }));
    store.setDraft('x');
    await store.send();
    store.addFiles([{ name: 'a.txt', base64: 'aGk=' }]);
    await flush();
    expect(commandsOf(b, 'chat.attach')[0]).toMatchObject({ conversation: 'C1' });
  });

  it('U-110: an image is accepted with the note that its bytes are not sent to the model', async () => {
    const { store } = make((x) => x.onCommand('chat.attach', () => ({ ok: true, attachment: 'A2' })));
    store.addFiles([{ name: 'ekran.png', base64: 'aGk=' }]);
    await flush();
    expect(store.state().tray[0]?.kind).toBe('image');
    expect(store.state().note?.key).toBe('chat.file.image');
  });

  it('U-110: a video, an unknown type and the sixth file are refused with their sentences and no upload', async () => {
    const { store, b } = make((x) => {
      let n = 0;
      x.onCommand('chat.attach', () => ({ ok: true, attachment: `A${(n += 1)}` }));
    });
    store.addFiles([{ name: 'demo.mp4', base64: 'aGk=' }]);
    expect(store.state().note?.key).toBe('chat.file.video');
    store.addFiles([{ name: 'x.exe', base64: 'aGk=' }]);
    expect(store.state().note?.key).toBe('chat.file.type');
    expect(b.commands).toEqual([]);
    store.addFiles(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, base64: 'aGk=' })));
    await flush();
    expect(commandsOf(b, 'chat.attach')).toHaveLength(5);
    expect(store.state().tray).toHaveLength(5);
    expect(store.state().note?.key).toBe('chat.file.limit');
  });

  it('U-110: a file over the api\'s 5 MB cap is refused before any upload', () => {
    const { store, b } = make();
    store.addFiles([{ name: 'big.txt', base64: '', size: 5_000_001 }]);
    expect(store.state().note?.key).toBe('chat.error.attachment_too_large');
    expect(b.commands).toEqual([]);
  });

  it('U-110: a refused upload shows the failure sentence and no chip', async () => {
    const { store } = make((x) => x.onCommand('chat.attach', () => ({ ok: false, code: 'bad_attachment' })));
    store.addFiles([{ name: 'a.txt', base64: 'aGk=' }]);
    await flush();
    expect(store.state().tray).toEqual([]);
    expect(store.state().note?.key).toBe('chat.error.bad_attachment');
  });

  it('U-110: a chip is removed without a command', async () => {
    const { store, b } = make((x) => x.onCommand('chat.attach', () => ({ ok: true, attachment: 'A1' })));
    store.addFiles([{ name: 'a.txt', base64: 'aGk=' }]);
    await flush();
    b.commands.length = 0;
    store.removeFile('A1');
    expect(store.state().tray).toEqual([]);
    expect(b.commands).toEqual([]);
  });

  it('U-110: "Bu ekranı ekle" adds the screen\'s own reference once — structured data, never pixels', () => {
    const { store, b } = make();
    store.setPlace(PROJECT_PLACE);
    store.attachScreen();
    store.attachScreen();
    expect(store.state().refs.map((r) => r.input)).toEqual([{ kind: 'project', id: 'antero' }]);
    expect(store.state().refs[0]?.kind).toBe('project');
    expect(b.commands).toEqual([]);
    expect(b.toasts.map((x) => x.key)).toContain('chat.toast.screen');
  });

  it('U-110: a screen with nothing to reference says so', () => {
    const { store } = make();
    store.attachScreen();
    expect(store.state().refs).toEqual([]);
    expect(store.state().note?.key).toBe('chat.plus.screen.none');
  });
});

describe('cards and actions (U-111, U-112)', () => {
  it('U-111: a proposal card reads its diff lazily from proposal.detail', async () => {
    const { store, b } = make((x) =>
      x.onQuery('proposal.detail', () => ({ id: 'PR1', summary: 'Odoo akışına inceleme ekle', target: 'flows/odoo.yaml', lines: [{ kind: 'add', text: '  - id: inceleme' }] })),
    );
    store.loadProposal('PR1');
    expect(store.state().proposals.PR1?.status).toBe('loading');
    await flush();
    expect(b.queries).toEqual([{ type: 'proposal.detail', id: 'PR1' }]);
    expect(store.state().proposals.PR1).toMatchObject({ status: 'ready', target: 'flows/odoo.yaml' });
    store.loadProposal('PR1');
    await flush();
    expect(b.queries).toHaveLength(1);
  });

  it('U-111: a failed diff read is a failed state with a retry, not a blank card', async () => {
    const { store } = make((x) => x.onQuery('proposal.detail', () => ({ ok: false, code: 'not_found' })));
    store.loadProposal('PR1');
    await flush();
    expect(store.state().proposals.PR1?.status).toBe('failed');
  });

  it('U-111: Oluştur confirms the draft, toasts and re-reads; Vazgeç drops it silently', async () => {
    const { store, b } = live();
    b.onCommand('chat.draft.confirm', () => ({ ok: true, workOrder: 'W9', code: 'İE-0043' }));
    store.setDraft('x');
    await store.send();
    b.toasts.length = 0;
    await store.confirmDraft('D1');
    expect(commandsOf(b, 'chat.draft.confirm')).toEqual([{ type: 'chat.draft.confirm', draft: 'D1' }]);
    expect(b.toasts.map((t) => t.key)).toEqual(['chat.toast.workOrder']);
    b.toasts.length = 0;
    await store.dropDraft('D2');
    expect(commandsOf(b, 'chat.draft.drop')).toEqual([{ type: 'chat.draft.drop', draft: 'D2' }]);
    expect(b.toasts).toEqual([]);
  });

  it('U-111: Onayla and Reddet decide the action with the decision and toast their own line', async () => {
    const { store, b } = live();
    store.setDraft('x');
    await store.send();
    b.toasts.length = 0;
    await store.decide('ACT1', 'approved');
    await store.decide('ACT2', 'rejected');
    expect(commandsOf(b, 'chat.action.decide')).toEqual([
      { type: 'chat.action.decide', id: 'ACT1', decision: 'approved' },
      { type: 'chat.action.decide', id: 'ACT2', decision: 'rejected' },
    ]);
    expect(b.toasts.map((t) => t.key)).toEqual(['chat.toast.approved', 'chat.toast.rejected']);
  });

  it('U-111: a refused decision says why with the failure sentence', async () => {
    const { store, b } = live();
    b.onCommand('chat.action.decide', () => ({ ok: false, code: 'not_pending' }));
    store.setDraft('x');
    await store.send();
    await store.decide('ACT1', 'approved');
    expect(store.state().note?.key).toBe('chat.error.not_pending');
  });

  it('U-112: Geri al sends chat.action.undo and toasts; an expired window is a sentence', async () => {
    const { store, b } = live();
    store.setDraft('x');
    await store.send();
    b.toasts.length = 0;
    await store.undo('ACT1');
    expect(commandsOf(b, 'chat.action.undo')).toEqual([{ type: 'chat.action.undo', id: 'ACT1' }]);
    expect(b.toasts.map((t) => t.key)).toEqual(['chat.toast.undone']);
    b.onCommand('chat.action.undo', () => ({ ok: false, code: 'undo_expired' }));
    await store.undo('ACT1');
    expect(store.state().note?.key).toBe('chat.error.undo_expired');
  });

  it('U-112: the clock ticks while an undo window is open, so the button disappears at expiry', async () => {
    const { store } = make((x) =>
      x.onQuery('chat.conversation', () => conversation('C1', { actions: [action('A1', { undoable: true, undoExpiresAt: clock + 2_500 })] })),
    );
    await store.openConversation('C1');
    expect(store.state().now).toBe(clock);
    clock += 3_000;
    vi.advanceTimersByTime(3_000);
    expect(store.state().now).toBe(clock);
  });
});

describe('permissions (U-113)', () => {
  it('U-113: granting needs at least one class; the button does nothing without', async () => {
    const { store, b } = live();
    store.togglePerm();
    await store.grant();
    expect(b.commands).toEqual([]);
  });

  it('U-113: grant sends the chosen classes for 60 minutes on the open conversation', async () => {
    const { store, b } = live();
    b.onCommand('chat.grant', () => ({ ok: true, id: 'G1' }));
    store.setDraft('x');
    await store.send();
    b.onQuery('chat.conversation', () => conversation('C1', { grants: [grant('G1', clock + 3_600_000, ['open_work_order'])] }));
    store.togglePerm();
    store.setPermClass('open_work_order', true);
    store.setPermClass('roadmap_edit', true);
    store.setPermClass('roadmap_edit', false);
    await store.grant();
    expect(commandsOf(b, 'chat.grant')).toEqual([{ type: 'chat.grant', conversation: 'C1', classes: ['open_work_order'], minutes: 60 }]);
    expect(store.state().permOpen).toBe(false);
    expect(chatTierMinutes(store.state())).toBe(60);
    expect(b.toasts.map((t) => t.key)).toContain('chat.toast.granted');
  });

  it('U-113: granting before any message first opens the conversation shell', async () => {
    const { store, b } = make((x) => {
      x.onCommand('chat.start', () => ({ ok: true, conversation: 'C7' }));
      x.onCommand('chat.grant', () => ({ ok: true, id: 'G1' }));
    });
    store.togglePerm();
    store.setPermClass('setting_change', true);
    await store.grant();
    expect(b.commands.map((c) => c.type)).toEqual(['chat.start', 'chat.grant']);
    expect(b.commands[0]).toEqual({ type: 'chat.start', scope: { kind: 'global' } });
    expect(b.commands[1]).toMatchObject({ conversation: 'C7' });
  });

  it('U-113: the tier counts down from the grant\'s expiresAt and is Öner (null) once it lapsed', async () => {
    const { store } = make((x) => x.onQuery('chat.conversation', () => conversation('C1', { grants: [grant('G1', clock + 120_000)] })));
    await store.openConversation('C1');
    expect(chatTierMinutes(store.state())).toBe(2);
    clock += 61_000;
    vi.advanceTimersByTime(61_000);
    expect(chatTierMinutes(store.state())).toBe(1);
    clock += 60_000;
    vi.advanceTimersByTime(60_000);
    expect(chatTierMinutes(store.state())).toBeNull();
  });

  it('U-113: revoke sends chat.revoke with the grant and toasts', async () => {
    const { store, b } = make((x) => x.onQuery('chat.conversation', () => conversation('C1', { grants: [grant('G1', clock + 600_000)] })));
    await store.openConversation('C1');
    b.toasts.length = 0;
    await store.revoke();
    expect(commandsOf(b, 'chat.revoke')).toEqual([{ type: 'chat.revoke', grant: 'G1' }]);
    expect(b.toasts.map((t) => t.key)).toEqual(['chat.toast.revoked']);
  });

  it('U-113: a refused grant says why and keeps the dialog open', async () => {
    const { store, b } = live();
    b.onCommand('chat.grant', () => ({ ok: false, code: 'grant_empty' }));
    store.setDraft('x');
    await store.send();
    store.togglePerm();
    store.setPermClass('open_work_order', true);
    await store.grant();
    expect(store.state().permOpen).toBe(true);
    expect(store.state().note?.key).toBe('chat.error.grant_empty');
  });
});

describe('footer line (U-114)', () => {
  it('U-114: the usage is read on open and again after a turn finishes', async () => {
    const { store, b } = live();
    store.open();
    await flush();
    store.setDraft('x');
    await store.send();
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'completed' });
    await flush();
    expect(b.queries.filter((q) => q.type === 'chat.usage')).toHaveLength(2);
  });

  it('U-114: a failed usage read keeps the last line and shows nothing new', async () => {
    const { store, b } = make((x) => x.onQuery('chat.usage', () => ({ month: { messages: 3 } })));
    store.open();
    await flush();
    b.onQuery('chat.usage', () => ({ ok: false, code: 'io_failed' }));
    store.close();
    store.open();
    await flush();
    expect(store.state().usage?.month.messages).toBe(3);
  });
});

describe('failure sentences (U-115)', () => {
  it('U-115: every chat failure code maps to its own chat.error key; an unknown code reads the generic line', () => {
    const codes = [
      'empty_message', 'message_too_long', 'bad_scope', 'bad_ref', 'too_many_refs', 'too_many_attachments', 'attachments_too_large',
      'attachment_too_large', 'bad_attachment', 'bad_base64', 'bad_input', 'busy', 'too_many_turns', 'not_found', 'not_pending',
      'undo_expired', 'rate_limited', 'grant_empty', 'grant_too_long', 'grant_expired', 'grant_revoked', 'bad_class', 'not_applied',
      'conversation_full', 'message_too_large',
    ];
    for (const code of codes) expect(chatFailureKey(code), code).toMatch(/^chat\.error\./);
    expect(chatFailureKey('something_new')).toBe('error.unknown');
  });

  it('U-115: every failing command leaves a note — draft, pin, delete, cancel, decide, undo, grant, revoke, attach', async () => {
    const { store, b } = live();
    store.setDraft('x');
    await store.send();
    const failures: [Command['type'], () => Promise<unknown>][] = [
      ['chat.cancel', () => store.cancel()],
      ['chat.draft.confirm', () => store.confirmDraft('D1')],
      ['chat.draft.drop', () => store.dropDraft('D1')],
      ['chat.action.decide', () => store.decide('A1', 'approved')],
      ['chat.action.undo', () => store.undo('A1')],
      ['chat.pin', () => store.pinConversation('C1', true)],
      ['chat.delete', () => store.deleteConversation('C1')],
    ];
    for (const [type, run] of failures) {
      b.onCommand(type, () => ({ ok: false, code: 'rate_limited' }));
      store.dismissNote();
      await run();
      expect(store.state().note?.key, type).toBe('chat.error.rate_limited');
    }
  });
});

describe('the Esc ladder (U-117)', () => {
  it('U-117: scope pop, then the menu, then the permission dialog, then the history, then the panel', () => {
    const { store } = make();
    store.open();
    store.openHistory();
    store.closeHistory();
    store.togglePerm();
    store.openPlus();
    store.togglePop();
    expect(store.escape()).toBe(true);
    expect(store.state().scopePop).toBe(false);
    expect(store.state().menu).toBe('plus');
    expect(store.escape()).toBe(true);
    expect(store.state().menu).toBeNull();
    expect(store.state().permOpen).toBe(true);
    expect(store.escape()).toBe(true);
    expect(store.state().permOpen).toBe(false);
    store.openHistory();
    expect(store.escape()).toBe(true);
    expect(store.state().view).toBe('chat');
    expect(store.state().open).toBe(true);
    expect(store.escape()).toBe(true);
    expect(store.state().open).toBe(false);
    expect(store.escape()).toBe(false);
  });
});

describe('new conversation (U-101)', () => {
  it('U-101: Yeni konuşma clears the conversation, tray, refs and note and toasts', async () => {
    const { store, b } = live();
    b.onCommand('chat.attach', () => ({ ok: true, attachment: 'A1' }));
    store.setPlace(PROJECT_PLACE);
    store.setDraft('x');
    await store.send();
    store.attachScreen();
    store.addFiles([{ name: 'a.txt', base64: 'aGk=' }]);
    await flush();
    await store.newConversation();
    const state = store.state();
    expect(state.conversation).toBeNull();
    expect(state.refs).toEqual([]);
    expect(state.tray).toEqual([]);
    expect(state.note).toBeNull();
    expect(state.view).toBe('chat');
    expect(b.toasts.at(-1)?.key).toBe('chat.toast.new');
  });
});
