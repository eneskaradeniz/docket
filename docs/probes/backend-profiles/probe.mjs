// docs/probes/backend-profiles/probe.mjs — WO-0098's probe-first measurement.
//
// Question: does an env map injected into the SDK spawn (Options.env) actually steer WHICH backend
// a drive reaches? Evidence is the session's own report — system/init `model`, the result's
// `modelUsage` keys, and the zero-token initialize response's `account` — never trust.
//
// Run from the repo root:  node docs/probes/backend-profiles/probe.mjs [case…]
// Writes one raw log per case under docs/probes/backend-profiles/raw/.
//
// Secrets: nothing from the environment is logged except the INJECTED keys (non-secret by
// construction); account email/organization are redacted to their presence.
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, 'raw');
mkdirSync(RAW, { recursive: true });

// A plain operator terminal: strip the probing session's own harness variables so the child
// behaves as it would under an Electron app launched from a shell.
const base = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !(k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_CONFIG_DIR' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT')),
);
const HOME = homedir();
const EMPTY = mkdtempSync(join(tmpdir(), 'wo0098-empty-'));

const CASES = {
  // zero-token handshakes: initialize only, no prompt ever sent
  'h1-passthrough': { kind: 'handshake', inject: {} },
  'h2-config-max': { kind: 'handshake', inject: { CLAUDE_CONFIG_DIR: join(HOME, '.claude-anthropic') } },
  'h3-config-empty': { kind: 'handshake', inject: { CLAUDE_CONFIG_DIR: EMPTY } },
  // one-turn drives (a handful of tokens): the model the session REPORTS
  'd1-passthrough': { kind: 'drive', inject: {}, model: 'haiku' },
  'd2-config-max': { kind: 'drive', inject: { CLAUDE_CONFIG_DIR: join(HOME, '.claude-anthropic') }, model: 'haiku' },
  // precedence: does an injected var beat the config dir's settings.json `env` block?
  'd3-precedence': { kind: 'drive', inject: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air' }, model: 'haiku' },
  'd4-config-empty': { kind: 'drive', inject: { CLAUDE_CONFIG_DIR: EMPTY }, model: 'haiku' },
};

const redactAccount = (a) => (a ? { ...a, ...(a.email ? { email: '<present>' } : {}), ...(a.organization ? { organization: '<present>' } : {}) } : a);

function channel() {
  let resolve;
  const waiters = [];
  const items = [];
  let closed = false;
  return {
    push(v) { const w = waiters.shift(); if (w) w({ value: v, done: false }); else items.push(v); },
    close() { closed = true; for (const w of waiters.splice(0)) w({ value: undefined, done: true }); },
    [Symbol.asyncIterator]() {
      return { next: () => (items.length ? Promise.resolve({ value: items.shift(), done: false }) : closed ? Promise.resolve({ value: undefined, done: true }) : new Promise((r) => waiters.push(r))) };
    },
  };
}

async function run(name, c) {
  const lines = [];
  const log = (o) => lines.push(JSON.stringify({ t: new Date().toISOString(), ...o }));
  log({ case: name, kind: c.kind, injected: c.inject, model: c.model ?? null, configDir: c.inject.CLAUDE_CONFIG_DIR ?? '(unset → ~/.claude)' });
  const input = channel();
  const q = query({
    prompt: input,
    options: { cwd: HERE, env: { ...base, ...c.inject }, ...(c.model ? { model: c.model } : {}), tools: [], maxTurns: 1, permissionMode: 'default' },
  });
  try {
    if (c.kind === 'handshake') {
      const init = await Promise.race([q.initializationResult(), new Promise((_, rej) => setTimeout(() => rej(new Error('initialize timed out (30s)')), 30_000))]);
      log({ initialize: { account: redactAccount(init.account), models: (init.models ?? []).map((m) => ({ value: m.value, displayName: m.displayName, description: m.description })) } });
      input.close();
      q.close?.();
    } else {
      input.push({ type: 'user', message: { role: 'user', content: 'Reply with exactly the word OK and nothing else.' }, parent_tool_use_id: null });
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') log({ init: { model: m.model, apiKeySource: m.apiKeySource, claude_code_version: m.claude_code_version } });
        else if (m.type === 'assistant') log({ assistant: { model: m.message?.model, text: (m.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('') , error: m.error } });
        else if (m.type === 'result') {
          log({ result: { subtype: m.subtype, is_error: m.is_error, result: m.result, errors: m.errors, total_cost_usd: m.total_cost_usd, modelUsage: m.modelUsage } });
          input.close();
        }
      }
    }
  } catch (e) {
    log({ threw: { name: e?.name, message: String(e?.message ?? e).slice(0, 600) } });
    input.close();
  }
  writeFileSync(join(RAW, `${name}.log`), lines.join('\n') + '\n');
  console.log(`--- ${name}`);
  console.log(lines.join('\n'));
}

const pick = process.argv.slice(2);
for (const [name, c] of Object.entries(CASES)) {
  if (pick.length && !pick.includes(name)) continue;
  await run(name, c);
}
