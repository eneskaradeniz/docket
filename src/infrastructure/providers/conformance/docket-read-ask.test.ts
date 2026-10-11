// Measures the sdk transport's permission_ask for Docket's own MCP read tools on the zai-glm
// route (the same transport every route of that provider uses). The callback is invoked with the
// fully-qualified names the SDK documents; the ask the application sees must already be Docket's
// own tool, so the application never learns a provider prefix.
import { describe, expect, it } from 'vitest';

import { createFakeAccountRepo, createFakeClock, createFakeSecretVault } from '../../../application/ports/fakes/index';
import type { AccountRecord, RunRequest } from '../../../application/index';
import { parseSlug, parseUlid, type AgentEvent, type CapabilityDef } from '../../../domain/index';
import { createSdkTransport } from '../transports/sdk/transport';
import { DOCKET_READ_ASK_TOOLS, createSdkFake } from './sdk-fake';

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_ID = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ROLE = slugOf<'role'>('assistant');
const SECRET_REF = 'ref-zai-glm';
const ENDPOINT = 'https://api.z.ai/api/anthropic';

/** Own-tool identity the transport must report. Anything else keeps the name the callback got. */
const REPORTED_TOOL: Readonly<Record<string, string>> = {
  'mcp__docket-pages__docket_get': 'docket_get',
  'mcp__docket-pages__docket_search': 'docket_search',
};

const docketCapability = (): CapabilityDef => ({
  kind: 'mcp',
  id: slugOf<'capability'>('docket-pages'),
  name: 'Docket pages',
  command: 'node',
  args: ['docket-mcp.cjs'],
  env: { DOCKET_MCP_KIND: { literal: 'chat' } },
});

describe('sdk route permission_ask for Docket own read tools', () => {
  it('docket_get and docket_search ask, and the ask tool is the own-tool identity', async () => {
    const accounts = createFakeAccountRepo();
    const secrets = createFakeSecretVault();
    await secrets.put(SECRET_REF, 'fixture-token');
    const account: AccountRecord = {
      id: ACCOUNT,
      provider: 'claude-code',
      label: 'zai',
      authMode: 'api_key',
      routeKind: 'zai-glm',
      endpoint: ENDPOINT,
      secretRef: SECRET_REF,
      limitPolicy: 'wait_resume',
      caps: [],
    };
    await accounts.save(account);

    const fake = createSdkFake('docket-reads');
    const transport = createSdkTransport({
      clock: createFakeClock(1_770_000_000_000),
      accounts,
      secrets,
      baseEnv: {},
      query: fake.query,
    });
    const request: RunRequest = {
      runId: RUN_ID,
      cwd: '/tmp/docket-conformance',
      runDir: '/tmp/docket-conformance',
      role: {
        id: ROLE,
        name: 'Asistan',
        instructions: 'Read with Docket tools.',
        writeScope: { kind: 'repo' },
        capabilities: [],
        active: true,
      },
      route: { accountId: ACCOUNT, model: 'glm-5.3-flash[1m]' },
      prompt: 'Bu projede şu an kaç iş emri var?',
      capabilities: [docketCapability()],
    };

    const started = await transport.start(request);
    if (!started.ok) throw new Error(`route did not start: ${started.error.code}`);

    const asks: Extract<AgentEvent, { type: 'permission_ask' }>[] = [];
    for await (const event of started.value.events) {
      if (event.type !== 'permission_ask') continue;
      asks.push(event);
      started.value.answerPermission(event.id, 'deny');
    }

    expect(asks.map((ask) => ask.tool)).toEqual(
      DOCKET_READ_ASK_TOOLS.map((name) => REPORTED_TOOL[name] ?? name),
    );
    expect(asks.every((ask) => ask.options.includes('allow') && ask.options.includes('deny'))).toBe(true);
  });
});
