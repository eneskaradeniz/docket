// In-memory AgentTransport and TransportResolver — a scripted event stream with pauses.
import type { AccountId, AgentEvent, EpochMs, Result } from '../../../domain/index';

import type {
  AgentTransport,
  RunHandle,
  RunRequest,
  TransportError,
  TransportResolver,
} from '../agent-transport';

import type { FakeEventLog } from './fake-event-log';

export interface FakeTransport extends AgentTransport {
  /** The RunRequests handed to start, in call order. */
  requests(): readonly RunRequest[];
  /** Permission answers delivered through a handle, in call order (wrong ids included). */
  answers(): readonly { readonly askId: string; readonly decision: 'allow' | 'deny' }[];
  /** Steer notes delivered through a handle, in call order. */
  steers(): readonly string[];
  /** How many times stop() was called on any handle of this transport. */
  stopCount(): number;
  /** Makes every later start fail with this error, for start-error paths. */
  failStart(error: TransportError): void;
}

export interface FakeTransportResolver extends TransportResolver {
  /** Registers the transport an account resolves to; the last registration wins. */
  register(accountId: AccountId, transport: AgentTransport): void;
}

const cancelledFinished = (at: EpochMs): AgentEvent => ({ type: 'finished', at, reason: 'cancelled' });

/** A one-shot gate: waiters park until open() lets them all through. */
const createGate = (): { readonly wait: () => Promise<void>; readonly open: () => void } => {
  let opened = false;
  const waiters: (() => void)[] = [];
  return {
    wait: () => (opened ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve))),
    open: () => {
      opened = true;
      for (const waiter of waiters.splice(0)) waiter();
    },
  };
};

/**
 * `script` is replayed verbatim. A `permission_ask` is emitted and then the stream rests until
 * `answerPermission` is called with that ask id (or `stop`); the stream ends right after the
 * `finished` event, so anything scripted beyond it never arrives.
 */
export const createFakeTransport = (script: readonly AgentEvent[]): FakeTransport => {
  const events: readonly AgentEvent[] = [...script];
  const requests: RunRequest[] = [];
  const answers: { readonly askId: string; readonly decision: 'allow' | 'deny' }[] = [];
  const steers: string[] = [];
  let stopCount = 0;
  let failure: TransportError | undefined;

  return {
    start: async (request: RunRequest): Promise<Result<RunHandle, TransportError>> => {
      requests.push(request);
      if (failure !== undefined) return { ok: false, error: failure };

      let pendingAskId: string | undefined;
      let gate = createGate();
      let stopped = false;
      let lastAt: EpochMs = 0;

      const stream = async function* (): AsyncGenerator<AgentEvent, void> {
        for (const event of events) {
          if (stopped) {
            yield cancelledFinished(lastAt + 1);
            return;
          }
          if (event.type === 'permission_ask') {
            gate = createGate();
            pendingAskId = event.id;
            lastAt = event.at;
            yield event;
            await gate.wait();
            if (stopped) {
              yield cancelledFinished(lastAt + 1);
              return;
            }
            pendingAskId = undefined;
          } else {
            lastAt = event.at;
            yield event;
          }
          if (event.type === 'finished') return;
        }
      };

      return {
        ok: true,
        value: {
          events: stream(),
          // An answer for another ask id is recorded but never releases the pause.
          answerPermission: (askId: string, decision: 'allow' | 'deny'): void => {
            answers.push({ askId, decision });
            if (askId === pendingAskId) gate.open();
          },
          steer: (note: string): void => {
            steers.push(note);
          },
          stop: async (): Promise<void> => {
            stopCount += 1;
            stopped = true;
            gate.open();
          },
        },
      };
    },

    requests: (): readonly RunRequest[] => [...requests],
    answers: (): readonly { readonly askId: string; readonly decision: 'allow' | 'deny' }[] => [...answers],
    steers: (): readonly string[] => [...steers],
    stopCount: (): number => stopCount,
    failStart: (error: TransportError): void => {
      failure = error;
    },
  };
};

export const createFakeTransportResolver = (): FakeTransportResolver => {
  const byAccount = new Map<AccountId, AgentTransport>();
  return {
    forAccount: async (accountId: AccountId): Promise<AgentTransport | undefined> => byAccount.get(accountId),
    register: (accountId: AccountId, transport: AgentTransport): void => {
      byAccount.set(accountId, transport);
    },
  };
};

/** Parks after `session_started` until `stop()` releases the stream with `finished { reason: 'cancelled' }`
 *  (I-30), matching a live run the operator can stop mid-flight. */
export const createParkedFakeTransport = (options?: {
  readonly stopHolds?: boolean;
  readonly log?: FakeEventLog;
}): {
  readonly transport: FakeTransport;
  readonly steers: () => readonly string[];
  readonly stopCount: () => number;
  readonly auditsAtStop: () => readonly number[];
} => {
  const steers: string[] = [];
  let stopCount = 0;
  const auditsAtStop: number[] = [];
  const requests: RunRequest[] = [];

  const transport: FakeTransport = {
    start: async (request: RunRequest): Promise<Result<RunHandle, TransportError>> => {
      requests.push(request);
      let released: (() => void) | undefined;
      const stopped = new Promise<void>((resolve) => {
        released = resolve;
      });
      const stream = async function* (): AsyncGenerator<AgentEvent, void> {
        yield { type: 'session_started', at: 1_600, sessionRef: 'sess-parked' };
        await stopped;
        yield cancelledFinished(2_000);
      };
      return {
        ok: true,
        value: {
          events: stream(),
          answerPermission: () => {},
          steer: (note: string) => {
            steers.push(note);
          },
          stop: async () => {
            stopCount += 1;
            if (options?.log !== undefined) {
              auditsAtStop.push(
                options.log.entries().filter((entry) => entry.action === 'run.stopped').length,
              );
            }
            if (options?.stopHolds !== true) released?.();
          },
        },
      };
    },
    requests: (): readonly RunRequest[] => [...requests],
    answers: (): readonly { readonly askId: string; readonly decision: 'allow' | 'deny' }[] => [],
    steers: (): readonly string[] => [...steers],
    stopCount: (): number => stopCount,
    failStart: (_error: TransportError): void => {},
  };

  return {
    transport,
    steers: (): readonly string[] => [...steers],
    stopCount: (): number => stopCount,
    auditsAtStop: (): readonly number[] => [...auditsAtStop],
  };
};
