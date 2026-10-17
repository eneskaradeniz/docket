// The context implementation, exercised through the shared law contract plus the one behaviour
// the contract cannot see from inside: a refused command answers a normal CommandResult shaped
// like a failed command, so an adapter's existing error classification stays the listener.
import { describe, expect, it } from 'vitest';

import { ok, parseSlug, type ConnectorManifest } from '../../domain/index';
import { createFakeClock, createFakeCommandRunner, createFakeIdGen, createFakeSecretVault } from '../../application/ports/fakes/index';
import { connectorContextContract, type ConnectorContextKit } from '../../application/ports/connector-context-contract.test';

import { createConnectorContext } from './context';

const slug = (raw: string): ConnectorManifest['id'] => {
  const parsed = parseSlug<'connector'>(raw);
  if (!parsed.ok) throw new Error('fixture connector slug');
  return parsed.value;
};

const manifestOf = (rawId: string, requiresCli?: string): ConnectorManifest => ({
  id: slug(rawId),
  name: 'Impl Fixture',
  version: '1.0.0',
  apiVersion: 1,
  provides: ['forge'],
  hostMatch: ['forge.example'],
  network: ['api.forge.example', '*.mirror.example'],
  settings: [],
  ...(requiresCli === undefined ? {} : { requiresCli }),
});

const kitFor = (manifest: ConnectorManifest): ConnectorContextKit => {
  const runner = createFakeCommandRunner();
  const vault = createFakeSecretVault();
  const lines: string[] = [];
  let transportCalls = 0;
  const ownSecretRef = `connectors/${manifest.id}/token`;
  const foreignSecretRef = 'connectors/someone-else/token';
  const secretValue = 'FIXTURE-CONTEXT-SECRET';
  void vault.put(ownSecretRef, secretValue);
  void vault.put(foreignSecretRef, secretValue);
  const context = createConnectorContext(manifest, {
    secrets: vault,
    commands: runner,
    clock: createFakeClock(0),
    ids: createFakeIdGen(),
    secretRefs: [ownSecretRef],
    send: async () => {
      transportCalls += 1;
      return ok({ status: 200, body: '' });
    },
    logSink: (message) => {
      lines.push(message);
    },
  });
  return {
    context,
    manifest,
    ownSecretRef,
    foreignSecretRef,
    secretValue,
    transportCalls: () => transportCalls,
    logLines: () => [...lines],
    commandRuns: () => runner.calls().length,
  };
};

connectorContextContract((manifest) => kitFor(manifest));

describe('createConnectorContext', () => {
  it('a refused command answers a normal CommandResult — no throw, a tail that names the refusal', async () => {
    const kit = kitFor(manifestOf('impl-cli', 'demo'));
    const refused = await kit.context.commands.run('/repo', 'curl https://evil.example', 1000);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.outputTail).toContain('refused');
    expect(kit.commandRuns()).toBe(0);
  });

  it('an unparsable request url is denied like a foreign host — it never reaches the transport', async () => {
    const kit = kitFor(manifestOf('impl-cli', 'demo'));
    const outcome = await kit.context.http.request({ url: 'not-a-url' });
    expect(outcome).toEqual({ ok: false, error: 'egress_denied' });
    expect(kit.transportCalls()).toBe(0);
  });
});
