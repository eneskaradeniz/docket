// chat-launcher.test.ts — U-126 … U-128 and U-131 … U-133 on the launchers' pure rules: what a click
// hands the chat store, what happens to an unsent draft, when the caret is placed, and which
// launchers a host shows for its standing. The chat store here is a fake that only records.
import { describe, expect, it } from 'vitest';

import type { ChatScopeInput } from '../../api/commands';
import {
  caretDelayMs,
  launchChat,
  pageLaunchScope,
  settingsLaunchSections,
  workOrderLaunchOf,
  type LaunchStore,
} from './chat-launcher';

type Call = { readonly scope: ChatScopeInput; readonly prefill?: string };

const fakeStore = (draft = ''): LaunchStore & { readonly calls: Call[]; readonly sent: string[] } => {
  const calls: Call[] = [];
  const sent: string[] = [];
  return {
    calls,
    sent,
    state: () => ({ draft }),
    openChat: (input) => {
      calls.push({ scope: input.scope, ...(input.prefill === undefined ? {} : { prefill: input.prefill }) });
    },
  };
};

describe('launching the chat', () => {
  it('U-126: a click calls openChat once with the host scope and the prefill, and sends nothing', () => {
    const store = fakeStore();
    launchChat(store, { kind: 'project', project: 'antero' }, 'Bu proje için bir yol haritası taslağı hazırla.');
    expect(store.calls).toStrictEqual([{ scope: { kind: 'project', project: 'antero' }, prefill: 'Bu proje için bir yol haritası taslağı hazırla.' }]);
    expect(store.sent).toStrictEqual([]);
  });

  it('U-126: the call carries only scope and prefill — no pin flag, no conversation id, so the panel opens fresh', () => {
    const store = fakeStore();
    launchChat(store, { kind: 'global' }, 'x');
    expect(Object.keys(store.calls[0] ?? {}).sort()).toStrictEqual(['prefill', 'scope']);
  });

  it('U-127: with an unsent draft the launcher keeps it and appends nothing', () => {
    const store = fakeStore('yarım kalan mesaj');
    launchChat(store, { kind: 'global' }, 'Yeni bir proje kurmak istiyorum, birlikte yapalım.');
    expect(store.calls).toStrictEqual([{ scope: { kind: 'global' } }]);
  });

  it('U-127: a blank draft (spaces, newline) counts as no draft and takes the prefill', () => {
    const store = fakeStore('  \n ');
    launchChat(store, { kind: 'global' }, 'merhaba');
    expect(store.calls).toStrictEqual([{ scope: { kind: 'global' }, prefill: 'merhaba' }]);
  });
});

describe('the caret', () => {
  it('U-128: focus waits for the panel\'s open transition, and not at all under reduced motion', () => {
    expect(caretDelayMs(false)).toBeGreaterThan(0);
    expect(caretDelayMs(true)).toBe(0);
  });
});

describe('work-order launchers', () => {
  it('U-131: a waiting or blocked order offers "why" and never "doing"', () => {
    for (const status of ['awaiting_human', 'limit_waiting', 'blocked']) expect(workOrderLaunchOf(status), status).toBe('whyWaiting');
  });

  it('U-131: a running order offers "doing" and never "why"', () => {
    expect(workOrderLaunchOf('running')).toBe('whatDoing');
  });

  it('U-131: every other standing offers neither — the launcher is hidden, not disabled', () => {
    for (const status of ['ready', 'gating', 'done', 'cancelled', '']) expect(workOrderLaunchOf(status), status).toBeNull();
  });
});

describe('settings launchers', () => {
  it('U-132: accounts, roles and limits (concurrency) carry one launcher each; the other sections none', () => {
    expect(settingsLaunchSections('accounts')).toBe(true);
    expect(settingsLaunchSections('roles')).toBe(true);
    expect(settingsLaunchSections('concurrency')).toBe(true);
    for (const section of ['capabilities', 'providers', 'appearance', 'phone', 'update'] as const) expect(settingsLaunchSections(section), section).toBe(false);
  });
});

describe('page launcher', () => {
  it('U-133: the page\'s work order wins, then its project', () => {
    expect(pageLaunchScope({ workOrder: { id: 'wo-1' }, project: { slug: 'antero' } })).toStrictEqual({ kind: 'workOrder', workOrder: 'wo-1' });
    expect(pageLaunchScope({ project: { slug: 'antero' } })).toStrictEqual({ kind: 'project', project: 'antero' });
  });

  it('U-133: a page with neither is global, and a page the library has not told about is unknown (hidden)', () => {
    expect(pageLaunchScope({})).toStrictEqual({ kind: 'global' });
    expect(pageLaunchScope(null)).toBeNull();
  });
});
