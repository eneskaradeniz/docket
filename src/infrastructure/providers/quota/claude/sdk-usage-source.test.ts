// Production get_usage source tests — rules P-48 (a probe reads the account it is given, never the
// machine's ambient one, and never starts a turn) and I-37 (the child environment follows I-34).
// The SDK's query is replaced by a recorder; no CLI starts.
import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { createSdkGetUsage, type SdkQueryFn } from './sdk-usage-source';

interface Recorded {
  readonly options: Options;
  readonly prompt: AsyncIterable<SDKUserMessage> | string;
  aborted: boolean;
}

const BASE_ENV: Readonly<Record<string, string>> = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  ANTHROPIC_API_KEY: 'ambient-key',
  ANTHROPIC_AUTH_TOKEN: 'ambient-token',
  ANTHROPIC_BASE_URL: 'https://ambient.example.test',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'ambient-opus',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'ambient-sonnet',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ambient-haiku',
};

/** A query that records how it was started and answers get_usage with a marker. */
const recordingQuery = (): { readonly query: SdkQueryFn; readonly runs: Recorded[] } => {
  const runs: Recorded[] = [];
  const query: SdkQueryFn = ({ prompt, options }) => {
    const run: Recorded = { options: options ?? {}, prompt, aborted: false };
    options?.abortController?.signal.addEventListener('abort', () => {
      run.aborted = true;
    });
    runs.push(run);
    const fake = { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ marker: runs.length }) };
    return fake as unknown as Query;
  };
  return { query, runs };
};

describe('createSdkGetUsage', () => {
  it('P-48: two identityDirs give two different environments, one per account', async () => {
    const { query, runs } = recordingQuery();
    const getUsage = createSdkGetUsage({ query, baseEnv: BASE_ENV });

    await getUsage(null, { accountId: null, identityDir: '/home/u/.claude-a' });
    await getUsage(null, { accountId: null, identityDir: '/home/u/.claude-b' });

    expect(runs.map((run) => run.options.env?.CLAUDE_CONFIG_DIR)).toEqual(['/home/u/.claude-a', '/home/u/.claude-b']);
  });

  it('P-48: a usage read never sends a prompt — the prompt stream yields nothing and the session ends with the read', async () => {
    const { query, runs } = recordingQuery();
    const getUsage = createSdkGetUsage({ query, baseEnv: BASE_ENV });

    const payload = await getUsage(null, { accountId: null, identityDir: null });

    expect(payload).toEqual({ marker: 1 });
    const run = runs[0];
    if (run === undefined || typeof run.prompt === 'string') throw new Error('the prompt must be a stream');
    const first = await Promise.race([run.prompt[Symbol.asyncIterator]().next(), Promise.resolve('no turn')]);
    expect(first).toBe('no turn');
    expect(run.aborted).toBe(true);
  });

  it('I-37: the ambient ANTHROPIC_* keys of I-34 are dropped, other variables stay', async () => {
    const { query, runs } = recordingQuery();
    const getUsage = createSdkGetUsage({ query, baseEnv: BASE_ENV });

    await getUsage('/fake/claude', { accountId: null, identityDir: null });

    expect(runs[0]?.options.env).toEqual({ PATH: '/usr/bin', HOME: '/home/u' });
  });

  it('I-37: the machine login names no config directory; cwd is the temp dir and settingSources stay empty', async () => {
    const { query, runs } = recordingQuery();
    const getUsage = createSdkGetUsage({ query, baseEnv: { ...BASE_ENV, CLAUDE_CONFIG_DIR: '/ambient/dir' } });

    await getUsage(null, { accountId: null, identityDir: null });

    const options = runs[0]?.options;
    // The CLI's own documented override passes through untouched, as for a run (I-34).
    expect(options?.env?.CLAUDE_CONFIG_DIR).toBe('/ambient/dir');
    expect(options?.settingSources).toEqual([]);
    expect(options?.cwd).toBe((await import('node:os')).tmpdir());
  });

  it("I-37: an account's identityDir wins over an ambient config directory", async () => {
    const { query, runs } = recordingQuery();
    const getUsage = createSdkGetUsage({ query, baseEnv: { ...BASE_ENV, CLAUDE_CONFIG_DIR: '/ambient/dir' } });

    await getUsage(null, { accountId: null, identityDir: '/home/u/.claude-a' });

    expect(runs[0]?.options.env?.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude-a');
  });
});
