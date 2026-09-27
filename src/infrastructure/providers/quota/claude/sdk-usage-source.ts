// Production get_usage source: a throwaway SDK session that is asked for its usage and closed
// before any turn runs. Written from the SDK's own surface, like the sdk transport; the probe
// tests inject GetUsage instead of driving a real CLI.
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { tmpdir } from 'node:os';

import type { GetUsage } from './claude-probe';

export type SdkQueryFn = typeof sdkQuery;

export interface SdkUsageSourceConfig {
  /** Injectable SDK query for tests; default: the SDK's own. */
  readonly query?: SdkQueryFn;
}

/** A prompt stream that never yields: the probe session starts with no turn in flight. */
const neverPrompted = (): AsyncIterable<SDKUserMessage> => ({
  [Symbol.asyncIterator]: () => ({
    next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}),
  }),
});

export function createSdkGetUsage(config: SdkUsageSourceConfig = {}): GetUsage {
  const runQuery = config.query ?? sdkQuery;
  return async (binPath) => {
    const abortController = new AbortController();
    const options: Options = {
      // The probe session owns no workspace; a scratch directory keeps it away from real ones.
      cwd: tmpdir(),
      settingSources: [], // the user's own settings files are never read or written
      abortController,
      ...(binPath === null ? {} : { pathToClaudeCodeExecutable: binPath }),
    };
    const session = runQuery({ prompt: neverPrompted(), options });
    try {
      return await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    } finally {
      // The probe session never runs a turn and never outlives the poll.
      abortController.abort();
    }
  };
}
