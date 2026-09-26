import { describe, expect, it } from 'vitest';

import { createFakeNotifier } from './fake-notifier';

describe('createFakeNotifier', () => {
  it('records every notification with its title and body in order', () => {
    const notifier = createFakeNotifier();
    notifier.notify('Run finished', 'The implement run succeeded');
    notifier.notify('Gate waiting', 'Plan approval is pending');

    expect(notifier.notifications()).toEqual([
      { title: 'Run finished', body: 'The implement run succeeded' },
      { title: 'Gate waiting', body: 'Plan approval is pending' },
    ]);
  });

  it('notifications returns a copy, never the internal list', () => {
    const notifier = createFakeNotifier();
    notifier.notify('a', 'b');

    const first = notifier.notifications();
    const second = notifier.notifications();
    expect(first).not.toBe(second);
    (first as { title: string; body: string }[]).push({ title: 'x', body: 'y' });
    expect(notifier.notifications()).toHaveLength(1);
  });
});
