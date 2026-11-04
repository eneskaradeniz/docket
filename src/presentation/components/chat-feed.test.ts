// chat-feed.test.ts — the running message's under-rows at the markup a person would see: the
// thinking string and the tool steps of U-377 … U-380, the untrusted-text law of U-382 and the
// chat-steps pack's own drawing of U-383. The feed is drawn over a real store and a scripted
// bridge with the server renderer, the way the layer's other markup tests draw; hostile text is
// data on purpose.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TR } from '../labels/tr';
import { createChatStore, type ChatStore } from '../stores/chat-store';
import { ACTOR, bridge, conversation, flush, message, type Bridge } from '../stores/chat-kit';
import { ChatFeed } from './chat-feed';

const draw = (store: ChatStore, locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(createElement(ChatFeed, { state: store.state(), store, locale, onOpenPage: () => undefined }));

const stepEvent = (
  id: string,
  phase: 'called' | 'done' | 'failed',
  patch: { readonly tool?: string; readonly server?: string; readonly target?: string; readonly turn?: string } = {},
) =>
  ({
    type: 'chat.step',
    conversation: 'C1',
    turn: patch.turn ?? 'T1',
    id,
    phase,
    tool: patch.tool ?? 'docket_get',
    ...(patch.server === undefined ? {} : { server: patch.server }),
    ...(patch.target === undefined ? {} : { target: patch.target }),
  }) as const;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the chat feed\'s thinking and tool steps (U-377 … U-383)', () => {
  const liveFeed = async (): Promise<{ readonly store: ChatStore; readonly b: Bridge }> => {
    const b = bridge();
    b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
    b.onQuery('chat.conversation', () => conversation('C1', { activeTurn: 'T1', messages: [message('m1', { role: 'user', text: 'bak' })] }));
    const store = createChatStore({ api: b.api, changes: b.changes, actor: ACTOR, now: () => 1_000_000, notify: b.notify });
    store.open();
    store.setDraft('bak');
    await store.send();
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'started' });
    await flush();
    return { store, b };
  };

  it('U-377: the thinking string draws under the running message and replaces the step rows', async () => {
    const { store, b } = await liveFeed();
    b.emit(stepEvent('s1', 'called', { tool: 'docket_search', target: 'docs/arama.md' }));
    let markup = draw(store);
    expect(markup).toContain(TR['chat.step.called']);
    expect(markup).toContain('docket_search');
    b.emit({ type: 'chat.thinking', conversation: 'C1', turn: 'T1', text: 'Planı düşünüyorum.' });
    markup = draw(store);
    expect(markup).toContain(TR['chat.thinking.heading']);
    expect(markup).toContain('Planı düşünüyorum.');
    expect(markup).not.toContain(TR['chat.step.called']);
  });

  it('U-378: thinking draws as one muted, pre-wrapped text — never inside the assistant text', async () => {
    const { store, b } = await liveFeed();
    b.emit({ type: 'chat.thinking', conversation: 'C1', turn: 'T1', text: 'bir satır\nikinci satır' });
    b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'yanıt metni' });
    const markup = draw(store);
    // The thinking block is its own pre-wrapped box under the streamed assistant text.
    expect(markup).toContain('whitespace-pre-wrap');
    expect(markup).toContain('bir satır\nikinci satır');
    expect(markup).toContain('yanıt metni');
  });

  it('U-379: a row shows its state sentence, the tool name and — only when carried — the one-line target', async () => {
    const { store, b } = await liveFeed();
    b.emit(stepEvent('s1', 'called', { tool: 'docket_search', target: 'docs/uzun-bir-dosya-adi.md' }));
    b.emit(stepEvent('s1', 'done', { tool: 'docket_search', target: 'docs/uzun-bir-dosya-adi.md' }));
    b.emit(stepEvent('s2', 'called', { tool: 'docket_get' }));
    b.emit(stepEvent('s2', 'failed', { tool: 'docket_get' }));
    const markup = draw(store);
    expect(markup).toContain(TR['chat.step.done']);
    expect(markup).toContain(TR['chat.step.failed']);
    expect(markup).not.toContain(TR['chat.step.called']);
    expect(markup).toContain('docs/uzun-bir-dosya-adi.md');
    // A row without a target draws no target slot.
    expect(markup).toContain('data-chat-step="s2"');
    // The target is one line with ellipsis: the row's machine line never wraps.
    expect(markup).toContain('truncate');
    // The rows sit in their own polite live region (U-383).
    expect(markup).toContain('data-chat-steps');
    expect(markup).toContain('aria-live="polite"');
  });

  it('U-380: at finished the rows fold into one closed disclosure headed by the count line; opening lists them', async () => {
    const { store, b } = await liveFeed();
    b.emit(stepEvent('s1', 'called', { target: 'docs/plan.md' }));
    b.emit(stepEvent('s1', 'done', { target: 'docs/plan.md' }));
    b.onQuery('chat.conversation', () => conversation('C1', { messages: [message('m1', { role: 'user', text: 'bak' }), message('m2', { text: 'Bitti.' })] }));
    b.emit({ type: 'chat.turn', conversation: 'C1', turn: 'T1', phase: 'finished', outcome: 'completed' });
    await flush();
    let markup = draw(store);
    expect(markup).toContain(TR['chat.step.fold'].replace('{count}', '1'));
    expect(markup).toContain(TR['chat.step.fold.aria']);
    expect(markup).not.toContain(TR['chat.step.done']);
    store.toggleSteps();
    markup = draw(store);
    expect(markup).toContain(TR['chat.step.done']);
    expect(markup).toContain('data-chat-step="s1"');
  });

  it('U-382: thinking, tool, server and target are untrusted text — escaped, never a link, never a title', async () => {
    const { store, b } = await liveFeed();
    const hostile = '<script>kötü()</script>';
    b.emit(stepEvent('x1', 'called', { tool: '<img src=x>arac', server: 'sunucu-8f3f', target: 'docs/<i>hedef</i>.md' }));
    let markup = draw(store);
    // The carried names render as React text nodes: escaped, no injected markup, no anchor, no title.
    expect(markup).toContain('&lt;img src=x&gt;arac');
    expect(markup).toContain('sunucu-8f3f/');
    expect(markup).toContain('docs/&lt;i&gt;hedef&lt;/i&gt;.md');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<i>hedef</i>');
    expect(markup).not.toContain('<a href');
    expect(markup).not.toContain('title="docs/');
    // The thinking string is as untrusted as the names; it replaces the rows for the turn.
    b.emit({ type: 'chat.thinking', conversation: 'C1', turn: 'T1', text: `<b>kalın</b> ${hostile}` });
    markup = draw(store);
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('&lt;b&gt;kalın&lt;/b&gt;');
    // The thinking text is not announced per fragment (U-383): its box opts out of the live feed.
    expect(markup).toContain('aria-live="off"');
  });

  it('U-383: an unusable carried name draws as the pack\'s placeholder sentence, never the raw key', async () => {
    const { store, b } = await liveFeed();
    b.emit(stepEvent('p1', 'called', { tool: 'chat.step.name_placeholder' }));
    const markup = draw(store);
    expect(markup).toContain(TR['chat.step.name_placeholder']);
    expect(markup).not.toContain('chat.step.name_placeholder');
    // The more-line of a long turn counts the rows the feed does not draw.
    for (let n = 0; n < 60; n += 1) b.emit(stepEvent(`m${n}`, 'called', { tool: 'docket_get' }));
    const more = draw(store);
    expect(more).toContain(TR['chat.step.more'].replace('{count}', '11'));
  });
});
