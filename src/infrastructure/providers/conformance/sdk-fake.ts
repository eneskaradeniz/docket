// Scripted SDK session for the conformance suite: a QueryFn that plays one scenario and records
// what the transport handed the SDK, so a scenario can assert on the options and the prompt
// stream without a real agent CLI.
import type { CanUseTool, Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from '../transports/sdk/transport';

export type SdkScenario = 'happy' | 'permission' | 'resume' | 'hang' | 'steady';

export interface SdkFake {
  readonly query: QueryFn;
  /** The options of the last query call. */
  readonly options: () => Options | undefined;
  /** Every user message the transport put on the prompt stream, as JSON text. */
  readonly promptLog: () => string;
}

const SESSION = 'sess_conformance';
const UUID = '00000000-0000-4000-8000-000000000000';

// The transport reads only the fields these builders set; the SDK's own message types carry
// dozens more that no mapping looks at, so the scripted messages are cast once, here.
const message = (body: Record<string, unknown>): SDKMessage =>
  ({ uuid: UUID, session_id: SESSION, ...body }) as unknown as SDKMessage;

const init = (): SDKMessage => message({ type: 'system', subtype: 'init' });

const assistant = (content: readonly Record<string, unknown>[]): SDKMessage =>
  message({ type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content } });

const toolResult = (id: string): SDKMessage =>
  message({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }] },
  });

const success = (): SDKMessage =>
  message({
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.01,
    usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 4 },
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

export function createSdkFake(scenario: SdkScenario): SdkFake {
  let lastOptions: Options | undefined;
  const prompts: string[] = [];

  const play = async function* play(options: Options): AsyncGenerator<SDKMessage, void> {
    const abort = options.abortController ?? new AbortController();
    yield init();
    if (scenario === 'hang') {
      yield assistant([{ type: 'text', text: 'working' }]);
      await untilAborted(abort.signal); // the stop path is under test: nothing else ever arrives
      return;
    }
    if (scenario === 'steady') {
      // Six chunks a quarter second apart: the run outlasts a one-second watchdog while no
      // single gap comes near it.
      for (let sent = 1; sent <= 6; sent += 1) {
        await sleep(250);
        yield assistant([{ type: 'text', text: `chunk ${sent}` }]);
      }
      yield success();
      return;
    }
    if (scenario === 'permission') {
      const canUseTool: CanUseTool | undefined = options.canUseTool;
      if (canUseTool === undefined) throw new Error('the transport must supply a permission callback');
      const verdict = await canUseTool('Bash', { command: 'rm -rf /tmp/fake' }, {
        signal: abort.signal,
        toolUseID: 'tool_perm',
        requestId: 'req_perm',
      });
      yield assistant([{ type: 'text', text: `ANSWER:${verdict?.behavior ?? 'none'}` }]);
      yield success();
      return;
    }
    yield assistant([
      { type: 'text', text: 'all done' },
      { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/tmp/fake/config.json' } },
    ]);
    yield toolResult('tool_1');
    yield success();
  };

  const query: QueryFn = ({ prompt, options }) => {
    lastOptions = options;
    if (typeof prompt === 'string') {
      prompts.push(prompt);
    } else {
      // The transport queues the first user message before the session starts; reading it
      // eagerly records it without ever blocking the scripted run on the stream.
      void (async (): Promise<void> => {
        for await (const next of prompt) prompts.push(JSON.stringify(next));
      })();
    }
    // The transport iterates the session and nothing else; the control surface of the SDK's
    // Query type is never touched, so the generator stands in for it.
    return play(options ?? {}) as unknown as Query;
  };

  return {
    query,
    options: () => lastOptions,
    promptLog: () => prompts.join('\n'),
  };
}
