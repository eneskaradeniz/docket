// quit-prompt tests — the in-app confirmation's main-process flow with fakes (U-294, U-297): a
// window is created when none is open, an acknowledging renderer gets the modal path and the answer
// is unbounded, no acknowledgement within 2 s falls back to the native dialog, and a second request
// only refocuses.
import { describe, expect, it } from 'vitest';

import type { ConversationId, RunId, WorkOrderId } from '../src/domain/index';
import type { ActiveWork } from '../src/application/index';

import { QUIT_ACK_TIMEOUT_MS, createQuitPrompt } from './quit-prompt';

const work: ActiveWork = {
  runs: [{ runId: 'r1' as RunId, workOrderId: 'w1' as WorkOrderId, title: 'Fatura raporu' }],
  chats: [{ conversationId: 'c1' as ConversationId, title: 'Önbellek' }],
};

/** A fake clock: `delay` registers a timer, `advance` fires every timer due. */
const makeClock = () => {
  let now = 0;
  const timers: { at: number; fire: () => void }[] = [];
  return {
    delay: (ms: number) => new Promise<void>((resolve) => timers.push({ at: now + ms, fire: resolve })),
    advance: async (ms: number) => {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) timer.fire();
      await flush();
    },
  };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const harness = (options: { windowOpen?: boolean; native?: boolean } = {}) => {
  const clock = makeClock();
  const log: string[] = [];
  let windowOpen = options.windowOpen ?? true;
  const prompt = createQuitPrompt({
    ensureWindow: async () => {
      if (!windowOpen) {
        windowOpen = true;
        log.push('window:created');
      }
      log.push('window:shown');
    },
    request: (runs, chats) => log.push(`request:${runs.join('|')}:${chats.join('|')}`),
    nativeAsk: async () => {
      log.push('native');
      return options.native ?? false;
    },
    delay: clock.delay,
  });
  return { prompt, clock, log };
};

describe('quit prompt (U-294)', () => {
  it('U-294: creates a window when none is open, shows it, then sends the titles', async () => {
    const { prompt, log } = harness({ windowOpen: false });
    void prompt.ask(work);
    await flush();
    expect(log).toEqual(['window:created', 'window:shown', 'request:Fatura raporu:Önbellek']);
  });

  it('U-294: an acknowledging renderer gets the modal path; no native dialog, and the answer is unbounded', async () => {
    const { prompt, clock, log } = harness();
    const answer = prompt.ask(work);
    await flush();
    prompt.ack();
    await clock.advance(QUIT_ACK_TIMEOUT_MS * 100); // the operator takes as long as they like
    expect(log).not.toContain('native');
    expect(prompt.open()).toBe(true);
    prompt.answer(true);
    await expect(answer).resolves.toBe(true);
    expect(prompt.open()).toBe(false);
  });

  it('U-294: Vazgeç answers false and leaves nothing pending', async () => {
    const { prompt } = harness();
    const answer = prompt.ask(work);
    await flush();
    prompt.ack();
    prompt.answer(false);
    await expect(answer).resolves.toBe(false);
    expect(prompt.open()).toBe(false);
  });

  it('U-294: a second request refocuses the open prompt and shares its answer', async () => {
    const { prompt, log } = harness();
    const first = prompt.ask(work);
    await flush();
    prompt.ack();
    const second = prompt.ask(work);
    await flush();
    expect(log.filter((line) => line === 'window:shown')).toHaveLength(2);
    prompt.ack();
    prompt.answer(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('U-294: a second request inside the ack window keeps the modal path — no native dialog beside it', async () => {
    const { prompt, clock, log } = harness();
    const first = prompt.ask(work);
    await flush();
    await clock.advance(QUIT_ACK_TIMEOUT_MS - 100); // still waiting for the renderer
    const second = prompt.ask(work); // an impatient second Cmd+Q
    await flush();
    prompt.ack(); // one ack answers every presentation of this prompt
    await clock.advance(QUIT_ACK_TIMEOUT_MS * 2);
    expect(log).not.toContain('native');
    expect(prompt.open()).toBe(true);
    prompt.answer(false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });

  it('U-294: a second request after the ack resolves at once, never through the native dialog', async () => {
    const { prompt, clock, log } = harness();
    void prompt.ask(work);
    await flush();
    prompt.ack();
    await clock.advance(QUIT_ACK_TIMEOUT_MS * 2);
    const second = prompt.ask(work); // the modal has been up for a while already
    await clock.advance(QUIT_ACK_TIMEOUT_MS * 2);
    expect(log).not.toContain('native');
    prompt.answer(true);
    await expect(second).resolves.toBe(true);
  });
});

describe('quit prompt fallback (U-297)', () => {
  it('U-297: no acknowledgement within 2 s uses the native dialog, and its answer settles the quit', async () => {
    const { prompt, clock, log } = harness({ native: true });
    const answer = prompt.ask(work);
    await flush();
    await clock.advance(QUIT_ACK_TIMEOUT_MS - 1);
    expect(log).not.toContain('native');
    await clock.advance(1);
    expect(log).toContain('native');
    await expect(answer).resolves.toBe(true);
  });

  it('U-297: after the fallback a late acknowledgement or modal answer changes nothing', async () => {
    const { prompt, clock } = harness({ native: false });
    const answer = prompt.ask(work);
    await flush();
    await clock.advance(QUIT_ACK_TIMEOUT_MS);
    prompt.ack();
    prompt.answer(true);
    await expect(answer).resolves.toBe(false);
  });

  it('U-297: a failing window setup also ends in the native dialog', async () => {
    const prompt = createQuitPrompt({
      ensureWindow: async () => {
        throw new Error('no window');
      },
      request: () => undefined,
      nativeAsk: async () => true,
      delay: () => new Promise<void>(() => undefined),
    });
    await expect(prompt.ask(work)).resolves.toBe(true);
  });
});
