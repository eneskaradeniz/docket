// Test harness for the fake monitor endpoint (fake-monitor-server.cjs): spawns the fixture on an
// ephemeral local port, hands tests the endpoint URL, the request log and a per-request payload
// they can rewrite between polls. The token handed to the fixture is a sentinel the tests scan
// for — it must never surface in a log, a note or a probe result.
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_MONITOR_TOKEN = 'fixture-token-never-logged';

export interface FakeMonitorPayload {
  readonly status: number;
  readonly body: string;
}

export interface FakeMonitorRequest {
  readonly method: string;
  readonly url: string;
  readonly auth: string;
}

export interface FakeMonitor {
  /** The account-style endpoint URL the probe builds its monitor URL from. */
  readonly endpoint: string;
  /** Raw log file — readable text so tests can scan it for leaked secrets. */
  readonly logPath: string;
  setPayload(payload: FakeMonitorPayload): void;
  requests(): readonly FakeMonitorRequest[];
  kill(): void;
}

export interface FakeMonitorPool {
  start(payload: FakeMonitorPayload): Promise<FakeMonitor>;
  dispose(): void;
}

interface LogEntry {
  readonly event: string;
  readonly port?: number;
  readonly method?: string;
  readonly url?: string;
  readonly auth?: string;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fake-monitor-server.cjs');

export function createFakeMonitorPool(): FakeMonitorPool {
  const root = mkdtempSync(join(tmpdir(), 'docket-zai-monitor-'));
  const children: ChildProcess[] = [];
  let sequence = 0;

  const readLog = (logPath: string): readonly LogEntry[] =>
    readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as LogEntry);

  return {
    start: async (payload) => {
      sequence += 1;
      const dir = join(root, `server-${sequence}`);
      mkdirSync(dir, { recursive: true });
      const payloadPath = join(dir, 'payload.json');
      const logPath = join(dir, 'monitor.log');
      writeFileSync(payloadPath, JSON.stringify(payload));

      const child = nodeSpawn(process.execPath, [FIXTURE, payloadPath, logPath, FAKE_MONITOR_TOKEN], {
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
      if (port === undefined) throw new Error('the fake monitor server never became ready');

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
              auth: String(entry.auth),
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
