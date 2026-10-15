// Fake-bin tests for the stream-json transport (docs/v2/providers.md → "stream-json transport
// (P-9, P-10)"). Every binary is a real executable node script in a throwaway tree emitting
// fixture lines on stdout; no real agent CLI is ever spawned. The inherited port rules
// (answerPermission, steer) are re-verified here for this transport kind.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { EffortLevel, Result, RoleDef, RunId } from '../../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type AgentEvent } from '../../../../domain/index';
import { BUILTIN_PROVIDER_DEFS, effortFlagArgs, type EffortArg, type ProviderDef } from '../../defs/index';
import { createStreamJsonTransport, type AgyAskBridge, type AgyAskRequest, type StreamDialect } from './stream-json';

let root: string;
let runCount = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-stream-json-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// The dialect owns its event timestamps; the transport must pass them through untouched.
const DIALECT_AT = 424242;

/** Recognises {say} → text, {end} → finished, {quiet} → recognised but silent; null otherwise. */
const fakeDialect: StreamDialect = {
  id: 'fake',
  parse: (line) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null;
    const record = line as Record<string, unknown>;
    if (record['quiet'] === true) return [];
    if (typeof record['say'] === 'string') return [{ type: 'text', at: DIALECT_AT, delta: record['say'] }];
    if (record['end'] === 'completed' || record['end'] === 'failed') {
      return [{ type: 'finished', at: DIALECT_AT, reason: record['end'] }];
    }
    return null;
  },
};

/** A buggy dialect: throws on {boom}; everything else behaves like the fake dialect. */
const throwingDialect: StreamDialect = {
  id: 'throwing',
  parse: (line) => {
    if (typeof line === 'object' && line !== null && (line as Record<string, unknown>)['boom'] === true) {
      throw new Error('dialect bug');
    }
    return fakeDialect.parse(line);
  },
};

const defOf = (binPath: string): ProviderDef => ({
  id: 'fake-cli',
  displayName: 'Fake CLI',
  bins: [binPath],
  versionArgs: ['--version'],
  transport: 'stream-json',
  streamDialect: 'fake',
  config: { mechanism: 'env-var', name: 'FAKE_CLI_HOME' },
  buildLaunch: (input) => ({ args: [], env: { FAKE_CLI_HOME: input.configDir }, stdin: 'prompt' }),
  resume: 'none',
  capabilities: {
    structuredStream: true,
    permissionAsk: false,
    resume: false,
    mcp: false,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'none',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/fake-cli' },
  mark: null,
});

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const RUN_ID: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'Follow the work order exactly.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const request = (cwd: string): RunRequest => ({
  runId: RUN_ID,
  cwd,
  runDir: cwd,
  role: ROLE,
  route: { accountId: ACCOUNT },
  prompt: 'do the work',
  capabilities: [],
});

const unwrap = (started: Result<RunHandle, TransportError>): RunHandle => {
  if (!started.ok) throw new Error(`expected a started run, got ${started.error.code}`);
  return started.value;
};

const collect = async (events: AsyncIterable<AgentEvent>): Promise<readonly AgentEvent[]> => {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

const run = async (
  binPath: string,
  dialect: StreamDialect = fakeDialect,
): Promise<readonly AgentEvent[]> => {
  const cwd = runDir();
  const handle = unwrap(await createStreamJsonTransport(defOf(binPath), dialect).start(request(cwd)));
  return collect(handle.events);
};

const runDir = (): string => {
  runCount += 1;
  const dir = join(root, `run-${runCount}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Writes an executable node script; the body must be plain statements, no shebang needed. */
const writeBin = (name: string, body: string): string => {
  const path = join(root, `${name}.cjs`);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

const waitFor = async (probe: () => boolean, timeoutMs = 4000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error('condition not reached before the timeout');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** True when the promise is still pending `ms` later — the probe an unanswered ask must pass. */
const pendingAfter = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  const settled = await Promise.race([
    promise.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), ms);
    }),
  ]);
  return settled;
};

const finishedOf = (events: readonly AgentEvent[]) => events.filter((event) => event.type === 'finished');

describe('createStreamJsonTransport', () => {
  describe('framing and dialect dispatch (P-9)', () => {
    it('P-9: framing splits stdout into lines, also across write and chunk boundaries, and hands each parsed object to the dialect', async () => {
      const bin = writeBin(
        'framing',
        [
          'const out = process.stdout;',
          "out.write('{\"say\":\"one\"}\\n{\"say\":\"two\"}\\n{\"say\":\"thr');",
          'setTimeout(() => {',
          '  out.write(\'ee"}\\n{"end":"completed"}\\n\');',
          '}, 60);',
        ].join('\n'),
      );

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['text', 'text', 'text', 'finished']);
      expect(events[0]).toStrictEqual({ type: 'text', at: DIALECT_AT, delta: 'one' });
      expect(events[1]).toStrictEqual({ type: 'text', at: DIALECT_AT, delta: 'two' });
      expect(events[2]).toStrictEqual({ type: 'text', at: DIALECT_AT, delta: 'three' });
      expect(finishedOf(events)).toHaveLength(1);
    });

    it('P-9: the final line without a trailing newline is still framed', async () => {
      const bin = writeBin('no-trailing-newline', [
        'process.stdout.write(\'{"say":"tail"}\\n{"end":"completed"}\');',
      ].join('\n'));

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['text', 'finished']);
      expect(events[0]).toStrictEqual({ type: 'text', at: DIALECT_AT, delta: 'tail' });
    });

    it('P-9: a line that fails to parse becomes a raw event carrying the original line', async () => {
      const bin = writeBin('unparseable', [
        'process.stdout.write(\'this is not json\\n{"say":"ok"}\\n{"end":"completed"}\\n\');',
      ].join('\n'));

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['raw', 'text', 'finished']);
      expect(events[0]).toStrictEqual({ type: 'raw', at: expect.any(Number), line: 'this is not json' });
    });

    it('P-9: a parsed object the dialect does not recognise becomes a raw event with the original line text', async () => {
      const bin = writeBin('unrecognised', [
        'process.stdout.write(\'{ "mystery" : true }\\n42\\n{"say":"after"}\\n{"end":"completed"}\\n\');',
      ].join('\n'));

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['raw', 'raw', 'text', 'finished']);
      // The original spacing proves the raw event carries the line as read, not a re-serialisation.
      expect(events[0]).toMatchObject({ line: '{ "mystery" : true }' });
      expect(events[1]).toMatchObject({ line: '42' });
    });

    it('P-9: a dialect returning an empty array is recognised-but-silent — no event, no raw', async () => {
      const bin = writeBin('silent', [
        'process.stdout.write(\'{"quiet":true}\\n{"say":"after"}\\n{"end":"completed"}\\n\');',
      ].join('\n'));

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['text', 'finished']);
    });

    it('P-9: a dialect that throws on a line degrades it to raw; parsing never throws into the stream', async () => {
      const bin = writeBin('dialect-throws', [
        'process.stdout.write(\'{"boom":true}\\n{"say":"still alive"}\\n{"end":"completed"}\\n\');',
      ].join('\n'));

      const events = await run(bin, throwingDialect);

      expect(events.map((event) => event.type)).toEqual(['raw', 'text', 'finished']);
      expect(events[0]).toMatchObject({ line: '{"boom":true}' });
    });
  });

  describe('the finished invariant (P-10)', () => {
    it('P-10: a dialect finished ends the run with exactly one finished and the stream ends there', async () => {
      const bin = writeBin('duplicate-finished', [
        'process.stdout.write(\'{"end":"completed"}\\n{"end":"completed"}\\n{"say":"late"}\\n\');',
      ].join('\n'));

      const events = await run(bin);

      expect(finishedOf(events)).toHaveLength(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toStrictEqual({ type: 'finished', at: DIALECT_AT, reason: 'completed' });
    });

    it('P-10: an exit without a dialect finished synthesises a failed finished, whatever the code', async () => {
      const bin = writeBin('exit-7', [
        'process.stdout.write(\'{"say":"working"}\\n\');',
        'process.exit(7);',
      ].join('\n'));

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['text', 'finished']);
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: 'finished', reason: 'failed' });
      expect(typeof last?.at).toBe('number');
    });

    it('P-10: an exit without a dialect finished and with exit code 0 still synthesises a failed finished', async () => {
      const bin = writeBin('exit-0-quiet', ['process.exit(0);'].join('\n'));

      const events = await run(bin);

      expect(finishedOf(events)).toHaveLength(1);
      expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'failed' });
    });

    it('P-10: a signal exit synthesises a failed finished', async () => {
      const bin = writeBin('signal-exit', [
        'process.stdout.write(\'{"say":"going down"}\\n\');',
        'process.kill(process.pid, "SIGKILL");',
      ].join('\n'));

      const events = await run(bin);

      expect(events.map((event) => event.type)).toEqual(['text', 'finished']);
      expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'failed' });
    });

    it('P-10: the stream closing while the child still lives synthesises a failed finished', async () => {
      const bin = writeBin('stream-closes', [
        'const fs = require("node:fs");',
        'process.stdout.write(\'{"say":"closing"}\\n\');',
        'process.stdout.end();',
        'fs.writeFileSync(process.cwd() + "/past-close.marker", "alive");',
        'setInterval(() => {}, 1000);',
      ].join('\n'));
      const cwd = runDir();

      const handle = unwrap(await createStreamJsonTransport(defOf(bin), fakeDialect).start(request(cwd)));
      const events = await collect(handle.events);

      // The marker proves the child was still alive when stdout closed: only the stream ended.
      expect(existsSync(join(cwd, 'past-close.marker'))).toBe(true);
      expect(finishedOf(events)).toHaveLength(1);
      expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'failed' });
    });

    it('P-10: stop kills the whole process group and ends the run with finished cancelled', async () => {
      const bin = writeBin('group-kill', [
        'const { spawn } = require("node:child_process");',
        'const fs = require("node:fs");',
        'const dir = process.cwd();',
        'const ready = dir + "/grandchild-ready.marker";',
        'const killed = JSON.stringify(dir + "/grandchild-killed.marker");',
        'spawn(process.execPath, ["-e",',
        '  "const fs = require(\'node:fs\'); " +',
        '  "process.on(\'SIGTERM\', () => { fs.writeFileSync(" + killed + ", \'killed\'); process.exit(0); }); " +',
        '  "fs.writeFileSync(" + JSON.stringify(ready) + ", \'ready\'); " +',
        '  \'setInterval(() => {}, 1000);\'],',
        '  { stdio: "ignore" });',
        '// Only announce the run once the grandchild has installed its signal handler, so the',
        '// group kill below is observed by a prepared process, not a starting one.',
        'const deadline = Date.now() + 5000;',
        'while (!fs.existsSync(ready)) { if (Date.now() > deadline) process.exit(1); }',
        'process.stdout.write(\'{"say":"started"}\\n\');',
        'setInterval(() => {}, 1000);',
      ].join('\n'));
      const cwd = runDir();

      const handle = unwrap(await createStreamJsonTransport(defOf(bin), fakeDialect).start(request(cwd)));
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'text') await handle.stop();
      }

      expect(finishedOf(collected)).toHaveLength(1);
      expect(collected[collected.length - 1]).toMatchObject({ type: 'finished', reason: 'cancelled' });
      // Only a group-wide signal reaches the detached grandchild; a bare child kill would not.
      await waitFor(() => existsSync(join(cwd, 'grandchild-killed.marker')));
    });

    it('P-10: stop after the dialect already finished leaves the single finished in place', async () => {
      const bin = writeBin('already-finished', [
        'process.stdout.write(\'{"end":"completed"}\\n\');',
      ].join('\n'));
      const cwd = runDir();

      const handle = unwrap(await createStreamJsonTransport(defOf(bin), fakeDialect).start(request(cwd)));
      const events = await collect(handle.events);
      await handle.stop();

      expect(finishedOf(events)).toHaveLength(1);
      expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'completed' });
    });
  });

  describe('inherited port rules', () => {
    it('answerPermission is a no-op for stream-json unless the dialect emits permission asks', async () => {
      const bin = writeBin('slow-finish', [
        'setTimeout(() => {',
        '  process.stdout.write(\'{"say":"first"}\\n{"end":"completed"}\\n\');',
        '}, 80);',
      ].join('\n'));
      const cwd = runDir();

      const handle = unwrap(await createStreamJsonTransport(defOf(bin), fakeDialect).start(request(cwd)));
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'text') {
          handle.answerPermission('ask-1', 'allow'); // unknown ask id, no ask channel: ignored
          handle.steer('a later note'); // the one-shot prompt already closed stdin: dropped
        }
      }

      expect(collected.map((event) => event.type)).toEqual(['text', 'finished']);
      expect(collected.some((event) => event.type === 'error' || event.type === 'raw')).toBe(false);
      expect(finishedOf(collected)).toHaveLength(1);
    });
  });

  describe('start errors', () => {
    it('reports not_installed when no resolved binary remains for the definition', async () => {
      const cwd = runDir();
      const noBinDef = { ...defOf(join(root, 'unused')), bins: [] as const };
      const started = await createStreamJsonTransport(noBinDef, fakeDialect).start(request(cwd));
      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('not_installed');
    });

    it('reports not_installed when the resolved binary does not exist', async () => {
      const cwd = runDir();
      const missing = join(root, 'never-written-bin');
      const started = await createStreamJsonTransport(defOf(missing), fakeDialect).start(request(cwd));
      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('not_installed');
    });
  });

  describe('launch composition', () => {
    it('the child receives the run-scoped config dir through the def mechanism and the isolated config files exist', async () => {
      const bin = writeBin('echo-config-env', [
        'process.stdout.write(JSON.stringify({ say: process.env.FAKE_CLI_HOME }) + \'\\n{"end":"completed"}\\n\');',
      ].join('\n'));
      const cwd = runDir();

      const handle = unwrap(await createStreamJsonTransport(defOf(bin), fakeDialect).start(request(cwd)));
      const events = await collect(handle.events);

      const text = events.find((event) => event.type === 'text');
      expect(text).toMatchObject({ delta: join(cwd, 'config') });
      expect(existsSync(join(cwd, 'config', 'mcp.json'))).toBe(true);
      expect(existsSync(join(cwd, 'config', 'skills.json'))).toBe(true);
      expect(existsSync(join(cwd, 'config', 'hooks.json'))).toBe(true);
    });
  });

  describe('run directory (I-62)', () => {
    it('I-62: the config files are written under the request runDir and nothing is written into the working directory', async () => {
      const bin = writeBin('echo-config-env-2', [
        'process.stdout.write(JSON.stringify({ say: process.env.FAKE_CLI_HOME }) + \'\\n{"end":"completed"}\\n\');',
      ].join('\n'));
      const cwd = runDir();
      const separate = runDir();

      const handle = unwrap(await createStreamJsonTransport(defOf(bin), fakeDialect).start({ ...request(cwd), runDir: separate }));
      const events = await collect(handle.events);

      expect(events.find((event) => event.type === 'text')).toMatchObject({ delta: join(separate, 'config') });
      expect(existsSync(join(separate, 'config', 'mcp.json'))).toBe(true);
      expect(existsSync(join(cwd, 'config'))).toBe(false);
    });
  });

  describe('agy delivery (P-62)', () => {
    // The real built-in agy definition with the binary swapped for a scripted fake, so the def's
    // own buildLaunch and the transport's agy branch are both the production ones.
    const agyDefOf = (binPath: string): ProviderDef => {
      const def = BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === 'agy');
      if (def === undefined) throw new Error('agy built-in def missing');
      return { ...def, bins: [binPath] };
    };

    it('P-62: fake agy cli receives --add-dir in argv', async () => {
      const bin = writeBin(
        'agy-add-dir-argv',
        'process.stdout.write(JSON.stringify({ say: process.argv.slice(2).join(" ") }) + \'\\n{"end":"completed"}\\n\');',
      );
      const cwd = runDir();
      writeFileSync(join(cwd, 'ctx.md'), 'argv context body\n');
      const context = {
        kind: 'context' as const,
        id: slugOf<'capability'>('ctx-argv'),
        name: 'Argv context',
        path: join(cwd, 'ctx.md'),
      };

      const handle = unwrap(
        await createStreamJsonTransport(agyDefOf(bin), fakeDialect).start({
          ...request(cwd),
          capabilities: [context],
          resume: { sessionRef: 'conv-argv-1' },
        }),
      );
      const events = await collect(handle.events);

      const text = events.find((event) => event.type === 'text');
      const argv = text?.type === 'text' ? text.delta.split(' ') : [];
      const at = argv.indexOf('--add-dir');
      expect(at).toBeGreaterThan(-1);
      // A relative path does not load hooks, so the flag must carry the absolute config dir.
      expect(argv[at + 1]).toBe(join(cwd, 'config'));
      // The flag is added before the resume flag handling (P-62 acceptance).
      expect(at).toBeLessThan(argv.indexOf('--conversation'));
      // The tree the flag points at carries the run's delivery: context is no longer dropped,
      // it lands as an always_on rule file.
      expect(existsSync(join(cwd, 'config', '.agents', 'rules', 'ctx-argv.md'))).toBe(true);
    });

    it('P-62: secretRef MCP server refuses the run', async () => {
      const bin = writeBin('agy-secret-ref', ['process.exit(0);'].join('\n'));
      const cwd = runDir();

      const started = await createStreamJsonTransport(agyDefOf(bin), fakeDialect).start({
        ...request(cwd),
        capabilities: [
          {
            kind: 'mcp',
            id: slugOf<'capability'>('mcp-secret'),
            name: 'Secret MCP',
            command: 'node',
            args: [],
            env: { TOKEN: { secretRef: 'probe/token' } },
          },
        ],
      });

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('not_logged_in');
    });
  });

  describe('agy permission bridge (P-63)', () => {
    // The real built-in agy definition with the binary swapped for a scripted fake, so the def's
    // own buildLaunch and the transport's agy branch are both the production ones.
    const agyDefOf = (binPath: string): ProviderDef => {
      const def = BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === 'agy');
      if (def === undefined) throw new Error('agy built-in def missing');
      return { ...def, bins: [binPath] };
    };

    /** The bridge as the transport sees it: the registered waiters, invoked the way the listener
     * invokes them. The mcp module owns the real one (the module map allows this test no import of
     * it); its listener-side suite carries the other half of the channel. */
    interface StubBridge extends AgyAskBridge {
      readonly registered: readonly RunId[];
      readonly unregistered: readonly RunId[];
      waiterOf(runId: RunId): ((ask: AgyAskRequest) => Promise<'allow' | 'deny'>) | undefined;
    }
    const stubBridge = (): StubBridge => {
      const waiters = new Map<RunId, (ask: AgyAskRequest) => Promise<'allow' | 'deny'>>();
      const registered: RunId[] = [];
      const unregistered: RunId[] = [];
      return {
        registered,
        unregistered,
        waiterOf: (runId) => waiters.get(runId),
        register: (runId, waiter) => {
          registered.push(runId);
          waiters.set(runId, waiter);
        },
        unregister: (runId) => {
          unregistered.push(runId);
          waiters.delete(runId);
        },
      };
    };

    /** The docket-pages capability as mcp-attach appends it to a run: the env literals are the
     * run's only in-band token; the values are opaque here — the listener resolves the token. */
    const docketPages = (kind: string) => ({
      kind: 'mcp' as const,
      id: slugOf<'capability'>('docket-pages'),
      name: 'Docket pages',
      command: process.execPath,
      args: [],
      env: {
        DOCKET_MCP_SOCKET: { literal: join(root, 'unused.sock') },
        DOCKET_MCP_TOKEN: { literal: 'test-run-token' },
        DOCKET_MCP_KIND: { literal: kind },
      },
    });

    /** A fake CLI that stays alive — an open ask must not end the run on its own. */
    const idleBin = (name: string): string =>
      writeBin(name, [
        "process.stdout.write('{\"say\":\"started\"}\\n');",
        'setInterval(() => {}, 1000);',
      ].join('\n'));

    const startAgy = async (
      bin: string,
      bridge: AgyAskBridge,
      capabilities: readonly RunRequest['capabilities'][number][],
    ) => {
      const cwd = runDir();
      const handle = unwrap(
        await createStreamJsonTransport(agyDefOf(bin), fakeDialect, bridge).start({
          ...request(cwd),
          ...(capabilities.length === 0 ? {} : { capabilities }),
        }),
      );
      return { cwd, handle };
    };

    const collectInto = async (events: AsyncIterable<AgentEvent>, into: AgentEvent[]): Promise<void> => {
      for await (const event of events) into.push(event);
    };

    const askEvents = (
      collected: readonly AgentEvent[],
    ): readonly Extract<AgentEvent, { readonly type: 'permission_ask' }>[] =>
      collected.filter((event): event is Extract<AgentEvent, { readonly type: 'permission_ask' }> => event.type === 'permission_ask');

    /** The registered waiter of this run, once the channel exists. */
    const waitForWaiter = async (
      bridge: StubBridge,
    ): Promise<(ask: AgyAskRequest) => Promise<'allow' | 'deny'>> => {
      await waitFor(() => bridge.waiterOf(RUN_ID) !== undefined);
      const waiter = bridge.waiterOf(RUN_ID);
      if (waiter === undefined) throw new Error('waiter vanished');
      return waiter;
    };

    it('P-63: a PreToolUse ask becomes a permission_ask and waits for the answer', async () => {
      const bridge = stubBridge();
      const { handle } = await startAgy(idleBin('agy-ask-waits'), bridge, [docketPages('run')]);
      const collected: AgentEvent[] = [];
      void collectInto(handle.events, collected);
      await waitFor(() => bridge.waiterOf(RUN_ID) !== undefined);
      expect(bridge.registered).toEqual([RUN_ID]);

      const answer = bridge.waiterOf(RUN_ID)?.({ tool: 'Bash', target: 'npm test', conversationId: 'conv-1' });
      await waitFor(() => askEvents(collected).length === 1);
      const ask = askEvents(collected)[0];
      expect(ask).toMatchObject({ id: 'ask-1', tool: 'Bash', target: 'npm test', options: ['allow', 'deny'] });

      // The ask stays open until the handle is answered — the executor's decision path, not the
      // transport, produces the settle.
      handle.answerPermission('ask-1', 'allow');
      expect(await answer).toBe('allow');
      await handle.stop();
      await waitFor(() => bridge.unregistered.includes(RUN_ID));
      expect(collected[collected.length - 1]).toMatchObject({ type: 'finished', reason: 'cancelled' });
    });

    it('P-63: stop() answers every open ask deny', async () => {
      const bridge = stubBridge();
      const { handle } = await startAgy(idleBin('agy-ask-stop'), bridge, [docketPages('run')]);
      const collected: AgentEvent[] = [];
      void collectInto(handle.events, collected);
      const waiter = await waitForWaiter(bridge);

      const first = waiter({ tool: 'Bash', target: 'rm -rf build' });
      const second = waiter({ tool: 'Write', target: '/w/new.txt' });
      await waitFor(() => askEvents(collected).length === 2);

      await handle.stop();
      expect(await first).toBe('deny');
      expect(await second).toBe('deny');
      expect(bridge.unregistered).toContain(RUN_ID);
      expect(collected[collected.length - 1]).toMatchObject({ type: 'finished', reason: 'cancelled' });
    });

    it('P-63: nothing is auto-approved without the executor path', async () => {
      const bridge = stubBridge();
      const { handle } = await startAgy(idleBin('agy-ask-pending'), bridge, [docketPages('run')]);
      const collected: AgentEvent[] = [];
      void collectInto(handle.events, collected);
      const waiter = await waitForWaiter(bridge);

      const answer = waiter({ tool: 'Write', target: '/w/proof.txt' });
      await waitFor(() => askEvents(collected).length === 1);
      // With no answer given, the ask stays open: the channel itself invents no decision.
      expect(await pendingAfter(answer, 200)).toBe(true);
      handle.answerPermission(askEvents(collected)[0]?.id ?? '', 'deny');
      expect(await answer).toBe('deny');
      await handle.stop();
    });

    it('a run without a Docket run token registers no channel and the ask file stays bridge false', async () => {
      const bridge = stubBridge();
      // A completed run: no channel means no listener to wait for either.
      const bin = writeBin(
        'agy-no-channel',
        "process.stdout.write('{\"say\":\"done\"}\\n{\"end\":\"completed\"}\\n');",
      );
      const { cwd, handle } = await startAgy(bin, bridge, []);
      const events = await collect(handle.events);
      expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'completed' });

      // A chat-kind token is not a run token: it registers nothing either.
      const chat = await startAgy(idleBin('agy-chat-token'), bridge, [docketPages('chat')]);
      const chatEvents: AgentEvent[] = [];
      void collectInto(chat.handle.events, chatEvents);
      await waitFor(() => chatEvents.some((event) => event.type === 'text'));
      await chat.handle.stop();

      expect(bridge.registered).toEqual([]);
      // The delivery agrees from the child's side: without a channel the ask file says bridge
      // false, so the ask child never writes the socket (the neutral allow, headless auto-deny).
      const askFile = JSON.parse(readFileSync(join(cwd, 'config', '.agents', '.docket-ask.json'), 'utf8')) as Record<string, unknown>;
      expect(askFile['bridge']).toBe(false);
    });
  });

  describe('effort (P-41)', () => {
    const FLAG: EffortArg = { kind: 'flag', flag: '--effort' };
    const argvOf = async (effort?: EffortLevel): Promise<string> => {
      const bin = writeBin(
        `echo-argv-${effort ?? 'none'}`,
        'process.stdout.write(JSON.stringify({ say: process.argv.slice(2).join(" ") }) + \'\\n{"end":"completed"}\\n\');',
      );
      const def: ProviderDef = {
        ...defOf(bin),
        effortArg: FLAG,
        buildLaunch: (input) => ({
          args: ['--json', ...effortFlagArgs(FLAG, input.effort)],
          env: { FAKE_CLI_HOME: input.configDir },
          stdin: 'prompt',
        }),
      };
      const handle = unwrap(
        await createStreamJsonTransport(def, fakeDialect).start({ ...request(runDir()), ...(effort === undefined ? {} : { effort }) }),
      );
      const text = (await collect(handle.events)).find((event) => event.type === 'text');
      return text?.type === 'text' ? text.delta : '';
    };

    it('P-41: the run request effort reaches the launch argv as the declared flag and level', async () => {
      expect(await argvOf('high')).toBe('--json --effort high');
    });

    it('P-41: an absent effort adds nothing to argv', async () => {
      expect(await argvOf()).toBe('--json');
    });
  });
});
