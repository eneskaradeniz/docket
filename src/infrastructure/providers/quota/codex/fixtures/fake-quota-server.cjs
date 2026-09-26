#!/usr/bin/env node
// Fake app-server for the quota probe tests: newline-delimited JSON-RPC 2.0 over stdio, scripted
// by scenario (argv[2]); every message in both directions is appended to the log file (argv[3])
// so tests can assert exactly what the client sent. Any further argv is ignored. No real agent
// CLI is involved.
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.argv[2] ?? 'happy';
const logPath = process.argv[3];
if (logPath === undefined) process.exit(2);

const log = (dir, msg) => {
  fs.appendFileSync(logPath, `${JSON.stringify({ dir, msg })}\n`);
};

const send = (msg) => {
  log('out', msg);
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

// The documented account/rateLimits/read payload shape: one ~5h primary and one ~weekly
// secondary window, durations and resets stated by the server itself.
const RATE_LIMITS = {
  limitId: 'codex-main',
  limitName: 'Codex',
  primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1759000000 },
  secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1759600000 },
};

// A snapshot whose window carries none of the optional values: the client must keep the reading
// without inventing a duration, a reset time or a pool label.
const SPARSE_RATE_LIMITS = { primary: { usedPercent: 80 } };

const handleRequest = (msg) => {
  if (scenario === 'exit-early') {
    // Only initialize is answered; the process dies before anything else can complete.
    if (msg.method === 'initialize') {
      reply(msg.id, { platformOs: 'macos' });
      setTimeout(() => process.exit(3), 20);
    }
    return;
  }
  if (msg.method === 'account/rateLimits/read') {
    if (scenario === 'rpc-error') replyError(msg.id, -32000, 'not signed in');
    else if (scenario === 'sparse') reply(msg.id, { rateLimits: SPARSE_RATE_LIMITS });
    else reply(msg.id, { ordinaryUsageAllowed: true, rateLimits: RATE_LIMITS, rateLimitsByLimitId: null, accountId: 'acc_1' });
    return;
  }
  if (msg.method === 'initialize') {
    reply(msg.id, { platformOs: 'macos' });
    return;
  }
  // A quota probe sends nothing else; anything else stays unanswered.
};

const handleLine = (line) => {
  if (line.trim() === '') return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method !== undefined && msg.id !== undefined) {
    log('in', msg);
    handleRequest(msg);
  }
};

if (scenario === 'hang') {
  setInterval(() => {}, 1 << 30); // stay alive, answer nothing
} else {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', handleLine);
  setInterval(() => {}, 1 << 30); // stay alive until the probe tears the process down
}
