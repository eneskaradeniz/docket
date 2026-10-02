// The login probe for a CLI whose only machine-readable login signal is its ACP session: open
// one session in a scratch directory, never send a prompt, and read the answer. A session that
// opens is a login; the one documented refusal is a logout; everything else is unknown, because
// guessing "logged out" would hide a working CLI behind a login screen.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACP_INITIALIZE_PARAMS,
  ACP_PROTOCOL_VERSION,
  isRecord,
  openAcpConnection,
  type AcpConnection,
  type AcpConnectionError,
  type AcpSpawn,
} from './connection';

/** The answer that means "no login": a JSON-RPC code and a fragment of the agent's text. */
export interface NotLoggedInRule {
  readonly rpcCode: number;
  readonly textContains: string;
}

/** `false` when the error is exactly the refusal the rule names; `null` for any other error. */
export const loginStateOfSessionError = (error: AcpConnectionError, rule: NotLoggedInRule): false | null =>
  error.code === 'protocol' &&
  error.rpc !== undefined &&
  error.rpc.code === rule.rpcCode &&
  error.rpc.text.toLowerCase().includes(rule.textContains.toLowerCase())
    ? false
    : null;

/** Asks the agent to close a session it opened, when it advertises that capability; the process
 * dies right after either way, so a refusal is not an error. */
export const closeAcpSession = async (
  connection: AcpConnection,
  initializeResult: unknown,
  sessionResult: unknown,
): Promise<void> => {
  const agent = isRecord(initializeResult) ? initializeResult : undefined;
  const capabilities = agent !== undefined && isRecord(agent['agentCapabilities']) ? agent['agentCapabilities'] : undefined;
  const sessionCapabilities =
    capabilities !== undefined && isRecord(capabilities['sessionCapabilities']) ? capabilities['sessionCapabilities'] : undefined;
  const sessionId = isRecord(sessionResult) && typeof sessionResult['sessionId'] === 'string' ? sessionResult['sessionId'] : undefined;
  if (sessionCapabilities !== undefined && 'close' in sessionCapabilities && sessionId !== undefined) {
    await connection.request('session/close', { sessionId });
  }
};

export interface AcpLoginProbeConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly rule: NotLoggedInRule;
  readonly timeoutMs?: number;
  readonly spawn?: AcpSpawn;
}

export async function probeAcpLogin(config: AcpLoginProbeConfig): Promise<boolean | null> {
  const scratch = mkdtempSync(join(tmpdir(), 'docket-acp-login-'));
  const opened = openAcpConnection({
    command: config.command,
    args: config.args,
    env: config.env,
    ...(config.spawn === undefined ? {} : { spawn: config.spawn }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
  if (!opened.ok) {
    rmSync(scratch, { recursive: true, force: true });
    return null;
  }
  const connection = opened.value;
  try {
    const initialized = await connection.request('initialize', ACP_INITIALIZE_PARAMS);
    if (!initialized.ok) return null;
    if (!isRecord(initialized.value) || initialized.value['protocolVersion'] !== ACP_PROTOCOL_VERSION) return null;
    const created = await connection.request('session/new', { cwd: scratch, mcpServers: [] });
    if (!created.ok) return loginStateOfSessionError(created.error, config.rule);
    if (!isRecord(created.value)) return null;
    await closeAcpSession(connection, initialized.value, created.value);
    return true;
  } finally {
    connection.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
