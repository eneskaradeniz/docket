// docket-agy-ask.ts — the permission-ask child an agy run's PreToolUse launcher execs (built to
// dist-electron/docket-agy-ask.cjs and started as plain Node through ELECTRON_RUN_AS_NODE). It
// reads the CLI's tool call on stdin, runs the user's before_tool hooks and asks the app over the
// local socket; stdout carries the one decision line and nothing else. Everything with behaviour
// lives in src/infrastructure/mcp/agy-ask.ts, which imports no Electron; the hook children go
// through the shared registry so a stopped run does not leave them behind (I-103).
import { runAgyAsk } from '../src/infrastructure/mcp/index';
import { registeredSpawn } from '../src/infrastructure/system/index';

const configDir = process.argv[2];

const write = (line: string): void => {
  process.stdout.write(line);
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
};

const spawnHook = (command: string, args: readonly string[], options: { readonly env?: Readonly<Record<string, string>> }) =>
  registeredSpawn(command, args, { env: options.env }, { kind: 'agent', label: 'agy before_tool hook' });

if (configDir === undefined) {
  write(`${JSON.stringify({ decision: 'deny', reason: 'docket ask launcher misconfigured' })}\n`);
} else {
  void readStdin().then((stdinText) => runAgyAsk({ configDir, stdinText, write, spawnHook }));
}
