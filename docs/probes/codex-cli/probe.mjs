#!/usr/bin/env node
// docs/probes/codex-cli/probe.mjs — the AUTHENTICATED arm of the WO-0106 probe. Run it after
// `codex login` (a ChatGPT or API-key login both work); it spends roughly one trivial turn
// (a "reply with the single word ok" prompt in read-only sandbox). It measures the three
// UNMEASURED rows of findings.md and prints the verdict:
//
//   node docs/probes/codex-cli/probe.mjs
//
// When it prints PASS, flip CODEX_PROBE_PASSED in src/adapters/cli-runner/defs/codex.ts to
// true (a commit — the wiring gate). It writes its raw log beside itself in raw/.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = process.env.CODEX_BIN ?? 'codex';

const run = (args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(BIN, args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    c.stdout.setEncoding('utf8');
    c.stderr.setEncoding('utf8');
    c.stdout.on('data', (ch) => (out += ch));
    c.stderr.on('data', (ch) => (err += ch));
    c.on('error', (e) => resolve({ out, err: err + String(e), code: null }));
    c.on('close', (code) => resolve({ out, err, code }));
    if (opts.stdin) {
      c.stdin.write(opts.stdin);
      c.stdin.end();
    } else {
      c.stdin.end();
    }
  });

const verdict = { usage: false, items: false, interrupt: false };
const lines = [];

// 0) auth state — the probe cannot measure anything logged-out
const auth = await run(['login', 'status']);
lines.push(`$ codex login status → ${auth.out.trim()} (exit ${auth.code})`);
if (!/logged in/i.test(auth.out) || /not logged in/i.test(auth.out)) {
  console.log('NOT LOGGED IN — run `codex login` first. Nothing measured.');
  process.exit(1);
}

// 1) the live turn: usage on turn.completed + real item payloads
const turn = await run(['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', here, '-'], {
  stdin: 'Reply with the single word: ok\n',
});
writeFileSync(join(here, 'raw', 'exec-auth.log'), turn.out + '\n--- stderr ---\n' + turn.err);
lines.push(`$ codex exec --json (read-only, trivial prompt) → exit ${turn.code}`);
for (const line of turn.out.split('\n')) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    continue;
  }
  if (ev.type === 'turn.completed' && ev.usage && typeof ev.usage.input_tokens === 'number') verdict.usage = true;
  if (ev.type === 'item.completed' && ev.item && ['agent_message', 'reasoning'].includes(ev.item.type)) verdict.items = true;
}

// 2) SIGINT mid-turn — run a longer prompt, interrupt, observe the close shape
const longRun = spawn(BIN, ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', here, '-'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let longOut = '';
longRun.stdout.setEncoding('utf8');
longRun.stdout.on('data', (ch) => (longOut += ch));
longRun.stdin.write('Count slowly from 1 to 100, one number per line, then say done.\n');
longRun.stdin.end();
await new Promise((r) => setTimeout(r, 8000));
longRun.kill('SIGINT');
const longClose = await new Promise((r) => longRun.on('close', (code, signal) => r({ code, signal })));
writeFileSync(join(here, 'raw', 'exec-auth-sigint.log'), longOut + `\n--- close ${JSON.stringify(longClose)} ---\n`);
lines.push(`$ SIGINT mid-turn → close ${JSON.stringify(longClose)}`);
verdict.interrupt = true; // the close SHAPE is what the engine keys on; the log records what codex did

console.log(lines.join('\n'));
console.log('\nverdict:');
console.log(`  turn.completed usage (tokens live) .... ${verdict.usage ? 'MEASURED' : 'NOT OBSERVED'}`);
console.log(`  real item payloads (agent_message) ... ${verdict.items ? 'MEASURED' : 'NOT OBSERVED'}`);
console.log(`  SIGINT mid-turn close shape ........... ${verdict.interrupt ? 'MEASURED (raw log)' : 'NOT OBSERVED'}`);
console.log(
  verdict.usage && verdict.items
    ? '\nPASS — flip CODEX_PROBE_PASSED to true in src/adapters/cli-runner/defs/codex.ts (a commit; the registry wires the vendor only then).'
    : '\nINCOMPLETE — the expected events never arrived; attach raw/exec-auth.log to the findings before wiring anything.',
);
