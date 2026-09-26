// Fake-bin tests for the stream-json transport (docs/v2/providers.md → "stream-json transport
// (P-9, P-10)"). Every binary is a real executable node script in a throwaway tree emitting
// fixture lines on stdout; no real agent CLI is ever spawned. The inherited port rules
// (answerPermission, steer) are re-verified here for this transport kind.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { Result, RoleDef, RunId } from '../../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type AgentEvent } from '../../../../domain/index';
import type { ProviderDef } from '../../defs/index';
import { createStreamJsonTransport, type StreamDialect } from './stream-json';

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
});
