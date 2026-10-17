// The connector conformance suite (I-114): the laws every built-in connector holds, run from one
// shared file over every entry of BUILTIN_CONNECTORS. Fixtures are recorded-style JSON beside each
// connector — synthetic bodies, no real data, no tokens, no personal names — scripted onto the
// injected command runner, so nothing here spawns a process or touches the network. The tracker
// leg is the shared trackerAdapterContract (A-333) over the same recordings; the forge leg, the
// transport-fault mapping, the secret fence and the capability laws are asserted here because
// only a connector's own fixtures can script those conditions. Every adapter is built through a
// real connector context, so the egress fence and the secret fence are proven per connector, not
// just on a bench fixture.
import { describe, expect, it } from 'vitest';

import type { ConnectorManifest, RepoRef } from '../../domain/index';
import { ok, validateConnectorManifest } from '../../domain/index';
import type {
  CommandResult,
  ConnectorContext,
  ConnectorModule,
  Forge,
  IssueTracker,
} from '../../application/index';
import {
  createFakeClock,
  createFakeCommandRunner,
  createFakeIdGen,
  createFakeSecretVault,
  type FakeCommandRunner,
} from '../../application/ports/fakes/index';
import {
  connectorContextContract,
  type ConnectorContextKit,
} from '../../application/ports/connector-context-contract.test';
import {
  TRACKER_CONTRACT_SCOPE,
  trackerAdapterContract,
} from '../../application/ports/tracker-adapter-contract.test';

import { BUILTIN_CONNECTORS } from './index';
import { createConnectorContext } from './context';
import probeRows from './github/fixtures/probe.json';
import forgeRows from './github/fixtures/forge-calls.json';
import trackerRows from './github/fixtures/tracker-calls.json';
import faultRows from './github/fixtures/faults.json';

/** One recorded command reply: the exact command, its exit code and its output tail. */
interface RecordedCall {
  readonly method: string;
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

/** One transport fault and the typed error the adapter must map it onto. */
interface RecordedFault {
  readonly kind: string;
  readonly expected: string;
  readonly exitCode: number;
  readonly output: string;
}

/** What a CLI connector brings to the suite: its probe dialogue, one recording per port member,
 *  and the fault corpus the members are fed with. */
interface ConformanceFixtures {
  readonly probe: readonly RecordedCall[];
  readonly forge: readonly RecordedCall[];
  readonly tracker: readonly RecordedCall[];
  readonly faults: readonly RecordedFault[];
}

// Every built-in connector needs a fixture bundle; an id without one fails the suite loudly.
const FIXTURES: Readonly<Record<string, ConformanceFixtures>> = {
  github: { probe: probeRows, forge: forgeRows, tracker: trackerRows, faults: faultRows },
};

const REPO_PATH = '/repo/contract';
const REPO: RepoRef = { id: 'contract', remote: 'https://github.com/octo/contract.git', defaultBranch: 'main' };
const PR_INPUT = { head: 'feature-x', base: 'main', title: 'Fixture pull request', body: 'Fixture body' };
const CREATE_ITEM = { title: 'Fixture created issue', body: 'Fixture body' };

const reply = (row: { readonly exitCode: number; readonly output: string }): CommandResult => ({
  exitCode: row.exitCode,
  durationMs: 1,
  outputTail: row.output,
});

const scriptRows = (runner: FakeCommandRunner, rows: readonly RecordedCall[], rounds = 1): void => {
  // The fake consumes a script on use, so repeated reads (the contract's idempotence law) need
  // the recording handed out once per round.
  for (let round = 0; round < rounds; round += 1) {
    for (const row of rows) runner.script(row.command, reply(row));
  }
};

const forgeOf = async (connector: ConnectorModule, script: (runner: FakeCommandRunner) => void): Promise<Forge> => {
  if (connector.createForge === undefined) throw new Error('manifest provides forge but createForge is missing');
  const runner = createFakeCommandRunner();
  script(runner);
  return connector.createForge(REPO_PATH, contextFor(connector.manifest, runner));
};

const trackerOf = (connector: ConnectorModule, script: (runner: FakeCommandRunner) => void): IssueTracker => {
  if (connector.createTracker === undefined) throw new Error('manifest provides tracker but createTracker is missing');
  const runner = createFakeCommandRunner();
  script(runner);
  return connector.createTracker(REPO_PATH, contextFor(connector.manifest, runner));
};

/** One real context over the scripted runner — the only machine surface the suite hands a
 *  connector, exactly what the registry hands it in production. */
const contextFor = (manifest: ConnectorManifest, runner: FakeCommandRunner): ConnectorContext =>
  createConnectorContext(manifest, {
    secrets: createFakeSecretVault(),
    commands: runner,
    clock: createFakeClock(0),
    ids: createFakeIdGen(),
  });

/** The context law kit of one manifest: the real context, a planted own-account secret beside a
 *  foreign one, and the observers the laws count. */
const kitFor = (manifest: ConnectorManifest): ConnectorContextKit => {
  const runner = createFakeCommandRunner();
  const vault = createFakeSecretVault();
  const lines: string[] = [];
  let transportCalls = 0;
  const ownSecretRef = `connectors/${manifest.id}/token`;
  const foreignSecretRef = 'connectors/someone-else/token';
  const secretValue = 'FIXTURE-CONFORMANCE-SECRET';
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

/** Runs the conformance laws for one connector over its fixtures. */
export function connectorConformance(connector: ConnectorModule, fixtures: ConformanceFixtures): void {
  const id = connector.manifest.id;
  const forgeCallers = (forge: Forge): Readonly<Record<string, () => Promise<unknown>>> => ({
    pushBranch: () => forge.pushBranch(REPO, 'feature-x'),
    openPullRequest: () => forge.openPullRequest(REPO, PR_INPUT),
    pullRequest: () => forge.pullRequest(REPO, 7),
    checks: () => forge.checks(REPO, 'feature-x'),
    defaultBranch: () => forge.defaultBranch(REPO),
    mergePullRequest: () => forge.mergePullRequest(REPO, 7),
  });

  const trackerCallers = (tracker: IssueTracker): Readonly<Record<string, () => Promise<unknown>>> => {
    const createIssue = tracker.createIssue;
    const updateIssue = tracker.updateIssue;
    return {
      listIssues: () => tracker.listIssues(TRACKER_CONTRACT_SCOPE, {}),
      listMilestones: () => tracker.listMilestones(TRACKER_CONTRACT_SCOPE),
      probePermissions: () => tracker.probePermissions(TRACKER_CONTRACT_SCOPE),
      get: () => tracker.get('12'),
      search: () => tracker.search('fixture', 10),
      comment: () => tracker.comment('12', 'Fixture comment'),
      transition: () => tracker.transition('14', 'closed'),
      ...(createIssue === undefined ? {} : { createIssue: () => createIssue(TRACKER_CONTRACT_SCOPE, CREATE_ITEM) }),
      ...(updateIssue === undefined ? {} : { updateIssue: () => updateIssue(TRACKER_CONTRACT_SCOPE, '12', { title: 'Edited title' }) }),
    };
  };

  describe(`connector conformance: ${id}`, () => {
    // The context laws, through the real context, against this connector's own manifest.
    connectorContextContract(kitFor, connector.manifest);

    it('I-113: the manifest is valid under R-182 and every provided family has its factory', () => {
      expect(validateConnectorManifest(connector.manifest).ok).toBe(true);
      expect(connector.manifest.provides.includes('forge')).toBe(connector.createForge !== undefined);
      expect(connector.manifest.provides.includes('tracker')).toBe(connector.createTracker !== undefined);
      // A forge selected by host needs a host pattern and a network to reach; a CLI-shell
      // connector declares the binary instead of assuming it.
      if (connector.manifest.provides.includes('forge')) {
        expect(connector.manifest.hostMatch.length).toBeGreaterThan(0);
        expect(connector.manifest.network.length).toBeGreaterThan(0);
      }
      expect(connector.manifest.requiresCli).toBeDefined();
    });

    it('I-114: recorded successes map onto port values across the forge family', async () => {
      const forge = await forgeOf(connector, (runner) => {
        scriptRows(runner, fixtures.probe);
        scriptRows(runner, fixtures.forge);
      });
      expect(await forge.pushBranch(REPO, 'feature-x')).toEqual({ ok: true, value: undefined });
      expect(await forge.openPullRequest(REPO, PR_INPUT)).toEqual({
        ok: true,
        value: { number: 41, url: 'https://github.com/octo/contract/pull/41' },
      });
      expect(await forge.pullRequest(REPO, 7)).toEqual({ ok: true, value: { state: 'open', mergeable: true } });
      expect(await forge.checks(REPO, 'feature-x')).toEqual({
        ok: true,
        value: [
          { name: 'fixture-ci', status: 'passed', url: 'https://github.com/octo/contract/actions/runs/1' },
          { name: 'fixture-lint', status: 'queued' },
        ],
      });
      expect(await forge.defaultBranch(REPO)).toEqual({ ok: true, value: 'main' });
      expect(await forge.mergePullRequest(REPO, 7)).toEqual({ ok: true, value: undefined });
    });

    // The tracker leg: the shared A-333 contract over the same recordings.
    trackerAdapterContract(() => trackerOf(connector, (runner) => scriptRows(runner, fixtures.tracker, 3)));

    it('I-114: every member maps each transport fault onto the typed error vocabulary', async () => {
      for (const fault of fixtures.faults) {
        // A member with several recordings (pages of one walk) is faulted once, on its first.
        const faulted = new Set<string>();
        for (const row of fixtures.forge) {
          if (faulted.has(row.method)) continue;
          faulted.add(row.method);
          const forge = await forgeOf(connector, (runner) => {
            scriptRows(runner, fixtures.probe);
            runner.script(row.command, reply(fault));
          });
          const outcome = await forgeCallers(forge)[row.method]?.();
          expect(outcome, `${id} forge ${row.method} on ${fault.kind}`).toEqual({ ok: false, error: fault.expected });
        }
        for (const row of fixtures.tracker) {
          if (row.method === 'getAbsent' || faulted.has(row.method)) continue;
          faulted.add(row.method);
          const tracker = trackerOf(connector, (runner) => runner.script(row.command, reply(fault)));
          const outcome = await trackerCallers(tracker)[row.method]?.();
          expect(outcome, `${id} tracker ${row.method} on ${fault.kind}`).toEqual({ ok: false, error: fault.expected });
        }
      }
    });

    it('I-114: a secret planted in a reply never crosses back out of the adapter', async () => {
      const sentinel = 'FIXTURE-SECRET-SENTINEL';
      const unauthorized = fixtures.faults[0];
      const leaky = { ...unauthorized, output: `${unauthorized.output} token=${sentinel}` };
      const getRow = fixtures.tracker.find((row) => row.method === 'get');
      if (getRow !== undefined) {
        const tracker = trackerOf(connector, (runner) => runner.script(getRow.command, reply(leaky)));
        const outcome = await tracker.get('12');
        expect(outcome).toEqual({ ok: false, error: unauthorized.expected });
        expect(JSON.stringify(outcome)).not.toContain(sentinel);
      }
      const checksRow = fixtures.forge.find((row) => row.method === 'checks');
      if (checksRow !== undefined) {
        const forge = await forgeOf(connector, (runner) => {
          scriptRows(runner, fixtures.probe);
          runner.script(checksRow.command, reply(leaky));
        });
        const outcome = await forge.checks(REPO, 'feature-x');
        expect(outcome).toEqual({ ok: false, error: unauthorized.expected });
        expect(JSON.stringify(outcome)).not.toContain(sentinel);
      }
    });

    it('I-114: capabilities report what the probe saw, and a not-ready connector still answers typed errors', async () => {
      const brokenProbe = fixtures.probe.map((row) => ({ ...row, exitCode: 127, output: 'spawn failed: ENOENT' }));
      const server = fixtures.faults.find((fault) => fault.kind === 'server');
      const forge = await forgeOf(connector, (runner) => {
        scriptRows(runner, brokenProbe);
        if (server !== undefined) runner.script(fixtures.forge.find((row) => row.method === 'checks')?.command ?? '', reply(server));
      });
      expect(forge.capabilities).toEqual({ pullRequests: false, checks: false, issues: false });
      expect(await forge.checks(REPO, 'feature-x')).toEqual({ ok: false, error: server?.expected ?? 'unknown' });

      const ready = await forgeOf(connector, (runner) => scriptRows(runner, fixtures.probe));
      // The port carries no issue members, so no issue capability is ever promised.
      expect(ready.capabilities).toEqual({ pullRequests: true, checks: true, issues: false });
    });

    it('I-114: commands reach the outside only through the declared CLI (or git itself for push)', async () => {
      const runner = createFakeCommandRunner();
      scriptRows(runner, fixtures.probe, 2);
      scriptRows(runner, fixtures.forge);
      const forge =
        connector.createForge === undefined
          ? undefined
          : await connector.createForge(REPO_PATH, contextFor(connector.manifest, runner));
      if (forge !== undefined) {
        await forge.pushBranch(REPO, 'feature-x');
        await forge.openPullRequest(REPO, PR_INPUT);
        await forge.checks(REPO, 'feature-x');
      }
      const cli = connector.manifest.requiresCli ?? '';
      for (const call of runner.calls()) {
        expect(
          call.command.startsWith(`${cli} `) || call.command.startsWith('git push '),
          `${id} issued a command outside its declared CLI: ${call.command}`,
        ).toBe(true);
      }
    });
  });
}

for (const connector of BUILTIN_CONNECTORS) {
  const fixtures = FIXTURES[connector.manifest.id];
  if (fixtures === undefined) throw new Error(`no conformance fixtures for connector '${connector.manifest.id}'`);
  connectorConformance(connector, fixtures);
}
