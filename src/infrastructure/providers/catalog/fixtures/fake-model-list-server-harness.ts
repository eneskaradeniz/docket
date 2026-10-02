// Test harness for the fake model-list endpoint (fake-model-list-server.cjs): spawns the fixture
// on an ephemeral local port, hands tests the endpoint URL, the request log and the response list
// they can rewrite between calls. The key handed to the fixture is a sentinel the tests scan for
// — it must never surface in a log, a result or an error.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_MODEL_LIST_KEY = 'fixture-key-never-logged';

export interface FakeModelListPayload {
  readonly status?: number;
  readonly body?: string;
  readonly hang?: boolean;
}

export interface FakeModelListRequest {
  readonly method: string;
  readonly url: string;
  readonly key: string; // verdict: 'match' | 'missing' | 'mismatch' — never the value
  readonly version: string;
}

export interface FakeModelListServer {
  /** The endpoint origin the adapter builds its model-list URL from. */
  readonly endpoint: string;
  /** Raw log file — readable text so tests can scan it for leaked secrets. */
  readonly logPath: string;
  setPayload(list: readonly FakeModelListPayload[]): void;
  requests(): readonly FakeModelListRequest[];
  kill(): void;
}

export interface FakeModelListPool {
  start(list: readonly FakeModelListPayload[]): Promise<FakeModelListServer>;
  dispose(): void;
}

interface LogEntry {
  readonly event: string;
  readonly port?: number;
  readonly method?: string;
  readonly url?: string;
  readonly key?: string;
  readonly version?: string;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fake-model-list-server.cjs');

export function createFakeModelListPool(): FakeModelListPool {
  const root = mkdtempSync(join(tmpdir(), 'docket-model-list-'));
  const children: ChildProcess[] = [];
  let sequence = 0;

  const readLog = (logPath: string): readonly LogEntry[] =>
    readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as LogEntry);

  return {
    start: async (list) => {
      sequence += 1;
      const dir = join(root, `server-${sequence}`);
      mkdirSync(dir, { recursive: true });
      const payloadPath = join(dir, 'payload.json');
      const logPath = join(dir, 'model-list.log');
      writeFileSync(payloadPath, JSON.stringify(list));

      const child = nodeSpawn(process.execPath, [FIXTURE, payloadPath, logPath, FAKE_MODEL_LIST_KEY], {
        stdio: 'ignore',
      });
      children.push(child);

      // The fixture logs its port once it listens; the harness cannot proceed before that.
      let port: number | undefined;
      for (let attempt = 0; attempt < 200 && port === undefined; attempt += 1) {
        try {
          port = readLog(logPath).find((entry) => entry.event === 'listening')?.port;
        } catch {
          // not written yet
        }
        if (port === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (port === undefined) throw new Error('the fake model-list server never became ready');

      return {
        endpoint: `http://127.0.0.1:${port}`,
        logPath,
        setPayload: (next) => writeFileSync(payloadPath, JSON.stringify(next)),
        requests: () =>
          readLog(logPath)
            .filter((entry) => entry.event === 'request')
            .map((entry) => ({
              method: String(entry.method),
              url: String(entry.url),
              key: String(entry.key),
              version: String(entry.version ?? ''),
            })),
        kill: () => child.kill(),
      };
    },
    dispose: () => {
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
