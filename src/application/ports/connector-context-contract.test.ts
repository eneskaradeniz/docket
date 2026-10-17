// The shared context laws (the connector addendum): one contract run against the real context
// implementation wherever it is built — the connector conformance suite invokes this for every
// built-in connector, so the laws hold per connector, not just on a bench fixture. The fixtures
// here are synthetic manifests; the caller supplies the context, so the same laws also run over
// a real connector's own manifest. The bottom self-run exercises the laws against the layer's
// fake context, which is their reference implementation.
import { describe, expect, it } from 'vitest';

import { CONNECTOR_API_VERSION, parseSlug, type ConnectorManifest } from '../../domain/index';

import { createFakeConnectorContext } from './fakes/fake-connector-context';
import type { ConnectorContext } from './connector-context';

/** Everything the laws need to observe one built context: the two secret refs planted in the
 *  vault (only `ownSecretRef` registered to the connector), the transport's call count, the log
 *  lines delivered and the commands that reached the runner. */
export interface ConnectorContextKit {
  readonly context: ConnectorContext;
  readonly manifest: ConnectorManifest;
  readonly ownSecretRef: string;
  readonly foreignSecretRef: string;
  readonly secretValue: string;
  readonly transportCalls: () => number;
  readonly logLines: () => readonly string[];
  readonly commandRuns: () => number;
  /** The rendered command lines that reached the runner, in order (refused ones never do). */
  readonly commandLines: () => readonly string[];
}

/** The shell constructs a first-word fence could never see: each one, planted inside an
 *  argument, must arrive at the runner as one quoted literal — never as live syntax. */
export const SHELL_CONSTRUCTS: readonly string[] = [';', '&&', '||', '|', '`', '$(', '\n', '>', '<', '&'];

/** The characters a shell could read as syntax rather than as a literal word: everything
 *  outside single-quoted spans. Outside quotes a backslash escapes the next character (the
 *  quote itself, in the `'\''` idiom), so the pair is skipped as a literal too. */
export const unquotedShellText = (line: string): string => {
  let out = '';
  let inQuote = false;
  let at = 0;
  while (at < line.length) {
    const char = line[at];
    if (inQuote) {
      if (char === "'") inQuote = false;
      at += 1;
    } else if (char === "'") {
      inQuote = true;
      at += 1;
    } else if (char === '\\') {
      at += 2;
    } else {
      out += char;
      at += 1;
    }
  }
  return out;
};

const slug = (input: string) => {
  const parsed = parseSlug<'connector'>(input);
  if (!parsed.ok) throw new Error('fixture connector slug');
  return parsed.value;
};

/** A CLI connector with one exact host and one wildcard in its allowlist. */
const CLI_MANIFEST: ConnectorManifest = {
  id: slug('ctx-demo'),
  name: 'Context Demo',
  version: '1.0.0',
  apiVersion: CONNECTOR_API_VERSION,
  provides: ['forge'],
  hostMatch: ['forge.example'],
  network: ['api.forge.example', '*.mirror.example'],
  settings: [],
  requiresCli: 'demo',
};

/** The same connector without a declared CLI: no command capability exists at all. */
const NO_CLI_MANIFEST: ConnectorManifest = {
  id: slug('ctx-bare'),
  name: 'Context Demo Bare',
  version: '1.0.0',
  apiVersion: CONNECTOR_API_VERSION,
  provides: ['forge'],
  hostMatch: ['forge.example'],
  network: ['api.forge.example', '*.mirror.example'],
  settings: [],
};

/** Runs the context laws over `makeKit`, which builds one real context per manifest. When
 *  `subject` is given (a real connector's manifest), the allowlist law also runs against that
 *  manifest's own network, so the conformance suite proves the fence per connector. */
export function connectorContextContract(
  makeKit: (manifest: ConnectorManifest) => ConnectorContextKit,
  subject?: ConnectorManifest,
): void {
  describe('connector context', () => {
    it('A-416: a request to a host outside the manifest network answers the typed egress_denied and never reaches the transport', async () => {
      const kit = makeKit(CLI_MANIFEST);
      const outcome = await kit.context.http.request({ url: 'https://evil.example/api' });
      expect(outcome).toEqual({ ok: false, error: 'egress_denied' });
      expect(kit.transportCalls()).toBe(0);
    });

    it('A-416: the network allowlist is host-exact and label-bounded — a wildcard covers subdomains only', async () => {
      const kit = makeKit(CLI_MANIFEST);
      // The two allowlisted shapes pass through to the transport.
      expect(await kit.context.http.request({ url: 'https://api.forge.example/x' })).toEqual({
        ok: true,
        value: { status: 200, body: '' },
      });
      expect(await kit.context.http.request({ url: 'https://pkg.mirror.example/x' })).toEqual({
        ok: true,
        value: { status: 200, body: '' },
      });
      // Everything else is denied before the transport: the bare wildcard host, a subdomain of
      // an exact entry, a suffix look-alike and the exact host of a hostMatch pattern (which is
      // not a network grant).
      for (const url of [
        'https://mirror.example/x',
        'https://evil.api.forge.example/x',
        'https://api.forge.example.evil.io/x',
        'https://forge.example/x',
      ]) {
        expect(await kit.context.http.request({ url }), url).toEqual({ ok: false, error: 'egress_denied' });
      }
      expect(kit.transportCalls()).toBe(2);
    });

    it('A-416: egress is https-only — a cleartext or non-web scheme never reaches the transport, an explicit port still matches by host', async () => {
      const kit = makeKit(CLI_MANIFEST);
      for (const url of [
        'http://api.forge.example/x',
        'ws://api.forge.example/x',
        'file://api.forge.example/etc',
        'http://pkg.mirror.example/x',
      ]) {
        expect(await kit.context.http.request({ url }), url).toEqual({ ok: false, error: 'egress_denied' });
      }
      expect(kit.transportCalls()).toBe(0);
      // The port is not part of the host match, so an https request on a non-default port passes
      // exactly like the default one.
      expect(await kit.context.http.request({ url: 'https://api.forge.example:8443/x' })).toEqual({
        ok: true,
        value: { status: 200, body: '' },
      });
      expect(kit.transportCalls()).toBe(1);
    });

    it("A-416: secrets resolve only refs of the connector's own accounts — a foreign ref answers undefined", async () => {
      const kit = makeKit(CLI_MANIFEST);
      expect(await kit.context.secrets.resolve(kit.ownSecretRef)).toBe(kit.secretValue);
      expect(await kit.context.secrets.resolve(kit.foreignSecretRef)).toBeUndefined();
    });

    it('A-416: a resolved secret value never crosses the log', async () => {
      const kit = makeKit(CLI_MANIFEST);
      await kit.context.secrets.resolve(kit.ownSecretRef);
      kit.context.log.line(`token=${kit.secretValue} refresh failed`);
      const lines = kit.logLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('refresh failed');
      expect(lines[0]).not.toContain(kit.secretValue);
    });

    it('A-416: commands run only the declared binary, and only one shape of git — nothing at all without one', async () => {
      const cli = makeKit(CLI_MANIFEST);
      const passed = await cli.context.commands.run('/repo', { bin: 'demo', args: ['status'] }, 1000);
      expect(passed.exitCode).toBe(0);
      expect(cli.commandRuns()).toBe(1);
      // A foreign binary is refused before the runner, as a failed command — never executed.
      const refused = await cli.context.commands.run('/repo', { bin: 'curl', args: ['https://evil.example'] }, 1000);
      expect(refused.exitCode).not.toBe(0);
      expect(cli.commandRuns()).toBe(1);
      // The push carve-out is exactly `git push remote branch` — no other shape of git passes.
      const pushed = await cli.context.commands.run('/repo', { bin: 'git', args: ['push', 'origin', 'main'] }, 1000);
      expect(pushed.exitCode).toBe(0);
      expect(cli.commandRuns()).toBe(2);
      for (const command of [
        { bin: 'git', args: ['clone', 'https://evil.example/x', 'y'] },
        { bin: 'git', args: ['push'] },
        { bin: 'git', args: ['push', 'origin'] },
        { bin: 'git', args: ['push', 'origin', 'main', 'extra'] },
      ]) {
        const outcome = await cli.context.commands.run('/repo', command, 1000);
        expect(outcome.exitCode, JSON.stringify(command)).not.toBe(0);
      }
      expect(cli.commandRuns()).toBe(2);

      const bare = makeKit(NO_CLI_MANIFEST);
      const none = await bare.context.commands.run('/repo', { bin: 'demo', args: ['status'] }, 1000);
      expect(none.exitCode).not.toBe(0);
      const noPush = await bare.context.commands.run('/repo', { bin: 'git', args: ['push', 'origin', 'main'] }, 1000);
      expect(noPush.exitCode).not.toBe(0);
      expect(bare.commandRuns()).toBe(0);
    });

    it('A-416: a construct-bearing argument stays one quoted literal — nothing outside single quotes ever reaches the runner', async () => {
      const kit = makeKit(CLI_MANIFEST);
      for (const construct of SHELL_CONSTRUCTS) {
        const outcome = await kit.context.commands.run('/repo', { bin: 'demo', args: ['probe', `x${construct}y`] }, 1000);
        expect(outcome.exitCode, JSON.stringify(construct)).toBe(0);
      }
      // An apostrophe exercises the one character a single-quoted word must escape.
      const quoted = await kit.context.commands.run('/repo', { bin: 'demo', args: ["it's", 'a b'] }, 1000);
      expect(quoted.exitCode).toBe(0);
      expect(kit.commandRuns()).toBe(SHELL_CONSTRUCTS.length + 1);
      // A foreign binary is refused in every construct form — it never reaches the runner at all.
      for (const construct of SHELL_CONSTRUCTS) {
        const refused = await kit.context.commands.run('/repo', { bin: 'curl', args: [`x${construct}y`] }, 1000);
        expect(refused.exitCode, JSON.stringify(construct)).not.toBe(0);
      }
      expect(kit.commandRuns()).toBe(SHELL_CONSTRUCTS.length + 1);
      // The whole surface the shell ever sees: quoted words joined by spaces, nothing else.
      for (const line of kit.commandLines()) {
        expect(unquotedShellText(line).trim(), line).toBe('');
      }
    });

    if (subject !== undefined) {
      it("A-416: no request leaves the connector's own network — a manifest host passes, a foreign host answers egress_denied", async () => {
        const kit = makeKit(subject);
        expect(await kit.context.http.request({ url: 'https://outside-every-manifest.example/x' })).toEqual({
          ok: false,
          error: 'egress_denied',
        });
        expect(kit.transportCalls()).toBe(0);
        // A wildcard entry is not itself a host, so the pass-through proof uses the first exact one.
        const host = subject.network.find((entry) => !entry.includes('*'));
        if (host !== undefined) {
          expect(await kit.context.http.request({ url: `https://${host}/x` })).toEqual({
            ok: true,
            value: { status: 200, body: '' },
          });
          expect(kit.transportCalls()).toBe(1);
        }
      });
    }
  });
}

// A compliant closure over the fake context: the layer's reference implementation of the fences.
const fakeKitOf = (manifest: ConnectorManifest): ConnectorContextKit => {
  const ownSecretRef = `connectors/${manifest.id}/token`;
  const foreignSecretRef = 'connectors/someone-else/token';
  const secretValue = 'FIXTURE-FAKE-CONTEXT-SECRET';
  const context = createFakeConnectorContext(manifest, { ownRefs: [ownSecretRef] });
  context.plantSecret(ownSecretRef, secretValue);
  context.plantSecret(foreignSecretRef, secretValue);
  return {
    context,
    manifest,
    ownSecretRef,
    foreignSecretRef,
    secretValue,
    transportCalls: () => context.sentRequests().length,
    logLines: () => context.logLines(),
    commandRuns: () => context.commandRuns(),
    commandLines: () => context.commandLines(),
  };
};

connectorContextContract(fakeKitOf);
