// Pure translation of SDK stream messages into domain AgentEvents; keeps the fold logic vendor-free.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, CostKind, EpochMs } from '../../../../domain/index';

export interface MapContext {
  readonly costKind: CostKind;
}

/** Pure: one SDK message -> zero or more AgentEvents, all stamped `at`. */
export function mapSdkMessage(message: SDKMessage, at: EpochMs, context: MapContext): readonly AgentEvent[] {
  void [message, at, context];
  throw new Error('not implemented');
}

export function toolTarget(input: Readonly<Record<string, unknown>>): string | undefined {
  void input;
  throw new Error('not implemented');
}
