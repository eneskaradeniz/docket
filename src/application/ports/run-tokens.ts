// Per-run tokens for Docket's own MCP server. A token proves that a request comes from the child
// process a specific run started: it is minted when the run starts, bound to that run's work
// order, project and role, and revoked when the run ends. It exists only in memory — never in a
// record, event, audit entry or file — and reaches the child through its process environment.
import type { ConversationId, ProjectSlug, RoleSlug, RunId, WorkOrderId } from '../../domain/index';

/** What a token is bound to. A `run` token belongs to a work-order run; a `chat` token to one
 *  assistant turn of a conversation, where `turn` is a fresh id used as the agent actor's `runId`
 *  (it is not a RunRecord). */
export type RunTokenBinding =
  | {
      readonly kind: 'run';
      readonly runId: RunId;
      readonly workOrderId: WorkOrderId;
      readonly project?: ProjectSlug;
      readonly role: RoleSlug;
    }
  | {
      readonly kind: 'chat';
      readonly turn: RunId;
      readonly conversation: ConversationId;
      readonly role: RoleSlug;
    };

export type RunTokenKind = RunTokenBinding['kind'];

/** The id `revoke` voids a token by: the run for a run token, the turn for a chat token. */
export const runTokenOwner = (binding: RunTokenBinding): RunId => (binding.kind === 'run' ? binding.runId : binding.turn);

export interface RunTokens {
  /** A fresh, unguessable token bound to the run; two mints never answer the same string. */
  mint(binding: RunTokenBinding): string;
  /** The binding of a live token; `undefined` for an unknown or revoked one. */
  resolve(token: string): RunTokenBinding | undefined;
  /** Voids every token of the run; a run without a token is not an error. */
  revoke(runId: RunId): void;
}

/** How the app's own MCP child is launched and where it reaches the app. Absent when the shell
 *  runs no endpoint (tests, headless tools): nothing is attached then. */
export interface McpEndpoint {
  /** The Unix socket path (or named pipe) the app listens on. */
  readonly socketPath: string;
  /** The executable that runs the child script as plain Node. */
  readonly command: string;
  readonly args: readonly string[];
  /** Launch variables the command needs besides the socket and the token. */
  readonly env: Readonly<Record<string, string>>;
}
