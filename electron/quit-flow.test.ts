// quit-flow tests — the managed quit's decisions (U-260, U-261): what the confirmation lists and
// when, the auto-answer gate for the e2e switch, and the stop → cancel → quit order with its
// 8-second bound. Everything Electron is injected; the module itself imports none of it.
import { describe, expect, it } from 'vitest';

import type { ConversationId, RunId, WorkOrderId } from '../src/domain/index';
import type { ActiveChatEntry, ActiveRunEntry, ActiveWork, ProcessRegistry, StopAllReport } from '../src/application/index';

import {
  QUIT_MAX_DETAIL_LINES,
  QUIT_SEQUENCE_BOUND_MS,
  formatQuitDialog,
  managedQuit,
  quitConfirmAutoAnswer,
  quitDetailLines,
} from './quit-flow';

const runEntry = (id: string, title: string): ActiveRunEntry => ({
  runId: id as RunId,
  workOrderId: `wo-${id}` as WorkOrderId,
  title,
});

const chatEntry = (id: string, title: string): ActiveChatEntry => ({
  conversationId: id as ConversationId,
  title,
});

const workOf = (runTitles: readonly string[], chatTitles: readonly string[] = []): ActiveWork => ({
  runs: runTitles.map((title, index) => runEntry(`run-${index}`, title)),
  chats: chatTitles.map((title, index) => chatEntry(`chat-${index}`, title)),
});

describe('quitConfirmAutoAnswer', () => {
  const gate = (overrides: Partial<Parameters<typeof quitConfirmAutoAnswer>[0]> = {}) => ({
    value: 'accept',
    isPackaged: false,
    dataDir: '/tmp/docket-test/e2e-data',
    docketHome: '/Users/tester/.docket',
    ...overrides,
  });

  it('U-260: the harness switch answers only for an unpackaged app on a data dir outside the operator’s real one', () => {
    expect(quitConfirmAutoAnswer(gate())).toBe('accept');
    expect(quitConfirmAutoAnswer(gate({ value: 'cancel' }))).toBe('cancel');
    // Every other condition loses the auto-answer: packaged, real data dir, unset dir, bad value.
    expect(quitConfirmAutoAnswer(gate({ isPackaged: true }))).toBeUndefined();
    expect(quitConfirmAutoAnswer(gate({ dataDir: '/Users/tester/.docket' }))).toBeUndefined();
    expect(quitConfirmAutoAnswer(gate({ dataDir: '/Users/tester/.docket/projects/x' }))).toBeUndefined();
    expect(quitConfirmAutoAnswer(gate({ dataDir: undefined }))).toBeUndefined();
    expect(quitConfirmAutoAnswer(gate({ dataDir: '' }))).toBeUndefined();
    expect(quitConfirmAutoAnswer(gate({ value: 'yes' }))).toBeUndefined();
    expect(quitConfirmAutoAnswer(gate({ value: undefined }))).toBeUndefined();
  });
});

describe('quitDetailLines', () => {
  it('U-260: lists runs then chats by title, at most five lines, then “+N more”', () => {
    const more = (hidden: number): string => `+${hidden} more`;
    expect(quitDetailLines(workOf([]), more)).toStrictEqual([]);
    expect(quitDetailLines(workOf(['Kayıt katmanı'], ['Sohbet']), more)).toStrictEqual(['Kayıt katmanı', 'Sohbet']);
    const crowded = quitDetailLines(workOf(['a', 'b', 'c', 'd'], ['e', 'f', 'g']), more);
    expect(crowded).toStrictEqual(['a', 'b', 'c', 'd', 'e', '+2 more']);
    expect(crowded.length).toBe(QUIT_MAX_DETAIL_LINES + 1);
  });
});

describe('formatQuitDialog', () => {
  it('U-260: formats dialog text and buttons from label bundle for Turkish (default)', () => {
    const work = workOf(['İş 1'], ['Sohbet 1']);
    const dialog = formatQuitDialog(work, 'tr');
    expect(dialog.title).toBe('Docket kapatılsın mı?');
    expect(dialog.cancelLabel).toBe('Vazgeç');
    expect(dialog.stopLabel).toBe('Kapat ve durdur');
    expect(dialog.detail).toContain('2 iş çalışıyor. Kapatırsan şunlar durdurulur:');
    expect(dialog.detail).toContain('İş 1\nSohbet 1');
    expect(dialog.detail).toContain('Durdurulan koşular iptal edilir, sonra devam ettirilebilir.');
  });

  it('U-260: formats dialog text and buttons from label bundle for English', () => {
    const work = workOf(['Job 1']);
    const dialog = formatQuitDialog(work, 'en');
    expect(dialog.title).toBe('Quit Docket?');
    expect(dialog.cancelLabel).toBe('Cancel');
    expect(dialog.stopLabel).toBe('Quit and stop');
    expect(dialog.detail).toContain('1 jobs are running. Quitting stops:');
    expect(dialog.detail).toContain('Job 1');
    expect(dialog.detail).toContain('Stopped runs are cancelled and can be continued later.');
  });
});

describe('managedQuit', () => {
  interface Recording {
    readonly calls: string[];
    readonly registry: Pick<ProcessRegistry, 'stopAll' | 'killAllSync'>;
    work: () => Promise<ActiveWork>;
    askAnswer: boolean;
    stopAllHangs: boolean;
    workValue: ActiveWork;
    ask(work: ActiveWork): Promise<boolean>;
    cancelRuns(): Promise<void>;
    quit(): void;
  }

  const makePorts = (workValue: ActiveWork): Recording => {
    const calls: string[] = [];
    const recording: Recording = {
      calls,
      workValue,
      askAnswer: true,
      stopAllHangs: false,
      registry: {
        stopAll: async (): Promise<StopAllReport> => {
          calls.push('stopAll');
          if (recording.stopAllHangs) await new Promise<void>(() => undefined);
          return { total: 1, killed: 0, timedOut: false };
        },
        killAllSync: () => calls.push('killAllSync'),
      },
      work: async () => {
        calls.push('work');
        return recording.workValue;
      },
      ask: async (asked) => {
        calls.push('ask');
        expect(asked).toBe(recording.workValue);
        return recording.askAnswer;
      },
      cancelRuns: async () => {
        calls.push('cancelRuns');
      },
      quit: () => calls.push('quit'),
    };
    return recording;
  };

  const portsOf = (recording: Recording) => ({
    work: recording.work,
    ask: recording.ask,
    registry: recording.registry,
    cancelRuns: recording.cancelRuns,
    quit: recording.quit,
    now: () => 0,
    delay: (ms: number) => {
      if (recording.stopAllHangs) {
        // The bound fires on schedule even while stopAll hangs forever.
        return new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 20)));
      }
      return new Promise<void>(() => undefined); // a real bound never fires in the happy path
    },
    log: () => undefined,
  });

  it('U-261: no user-visible work → no dialog; the children are still stopped, the sweep runs, the app quits', async () => {
    const recording = makePorts(workOf([]));
    await managedQuit(portsOf(recording));
    expect(recording.calls).toStrictEqual(['work', 'stopAll', 'cancelRuns', 'quit']);
  });

  it('U-261: work in flight → ask first; Cancel changes nothing — no stop, no cancel, no quit', async () => {
    const recording = makePorts(workOf(['Kayıt katmanı']));
    recording.askAnswer = false;
    await managedQuit(portsOf(recording));
    expect(recording.calls).toStrictEqual(['work', 'ask']);
  });

  it('U-261: confirm → stop every child, then cancel what stayed active, then quit — in that order', async () => {
    const recording = makePorts(workOf(['Kayıt katmanı'], ['Sohbet']));
    await managedQuit(portsOf(recording));
    expect(recording.calls).toStrictEqual(['work', 'ask', 'stopAll', 'cancelRuns', 'quit']);
  });

  it(`U-261: a shutdown that never ends is cut off at the ${QUIT_SEQUENCE_BOUND_MS} ms bound — last resort kill, sweep, quit anyway`, async () => {
    const recording = makePorts(workOf(['Kayıt katmanı']));
    recording.stopAllHangs = true;
    await managedQuit(portsOf(recording));
    expect(recording.calls).toContain('killAllSync');
    expect(recording.calls.indexOf('killAllSync')).toBeLessThan(recording.calls.indexOf('cancelRuns'));
    expect(recording.calls[recording.calls.length - 1]).toBe('quit');
  }, 2_000);
});
