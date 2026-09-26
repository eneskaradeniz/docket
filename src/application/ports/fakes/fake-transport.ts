// In-memory AgentTransport and TransportResolver — a scripted event stream with pauses.
import type { AccountId, AgentEvent, Result } from '../../../domain/index';

import type {
  AgentTransport,
  RunHandle,
  RunRequest,
  TransportError,
  TransportResolver,
} from '../agent-transport';

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

      const stream = async function* (): AsyncGenerator<AgentEvent, void> {
        for (const event of events) {
          if (stopped) return;
          if (event.type === 'permission_ask') {
            gate = createGate();
            pendingAskId = event.id;
            yield event;
            await gate.wait();
            pendingAskId = undefined;
          } else {
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
