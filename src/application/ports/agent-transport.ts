// Transport port — starts a run with a provider agent and streams its events.
import type {
  AccountId,
  AccountRoute,
  AgentEvent,
  CapabilityDef,
  Result,
  RoleDef,
  RunId,
  EffortLevel,
} from '../../domain/index';

export interface RunRequest {
  readonly runId: RunId;
  readonly cwd: string;
  /** Outside every repo and worktree; holds the run-scoped provider config; removed when the run ends. */
  readonly runDir: string;
  readonly role: RoleDef;
  readonly route: AccountRoute;
  readonly prompt: string;
  readonly resume?: { readonly sessionRef: string };
  readonly capabilities: readonly CapabilityDef[];
  readonly effort?: EffortLevel; // resolved by executeRun; absent → the CLI's own default
  /** The turn's own permission decision for a bridged PreToolUse ask (the amended I-109, A-444):
   *  the stream-json transport's chat-turn waiter is its one caller, and the answer it returns is
   *  the reply the ask child receives. Absent on a run request, and absent means the transport
   *  registers no chat waiter — an ask then meets the fail-closed deny. */
  readonly decideAsk?: (ask: { readonly tool: string; readonly target?: string }) => Promise<'allow' | 'deny'>;
}

export interface RunHandle {
  readonly events: AsyncIterable<AgentEvent>; // ends after a 'finished' event
  answerPermission(askId: string, decision: 'allow' | 'deny'): void;
  steer(note: string): void;
  stop(): Promise<void>;
}

export type TransportError = {
  readonly code: 'not_installed' | 'not_logged_in' | 'spawn_failed' | 'unsupported';
  readonly message: string;
};

export interface AgentTransport {
  start(request: RunRequest): Promise<Result<RunHandle, TransportError>>;
}

export interface TransportResolver {
  forAccount(accountId: AccountId): Promise<AgentTransport | undefined>;
}
