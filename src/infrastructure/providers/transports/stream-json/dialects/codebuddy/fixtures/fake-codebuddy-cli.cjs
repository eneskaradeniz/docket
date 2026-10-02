#!/usr/bin/env node
// Scripted stand-in for a stream-json CLI speaking the codebuddy dialect: one bare text prompt
// line on stdin, Claude-Code-style NDJSON events on stdout. The scenario (argv[2]) and a log
// path (argv[3]) are how a test scripts it; the log receives the stdin line so a test can see
// how the prompt arrived. No real agent CLI is involved. Later arguments are the definition's
// own launch arguments and are ignored.
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.argv[2] ?? 'happy';
const logPath = process.argv[3];
if (logPath === undefined) process.exit(2);

const SESSION = 'cbf_fake_1';
const MODEL = 'default-model';
const VERSION = '2.161.1-fake';

const emit = (object) => process.stdout.write(`${JSON.stringify(object)}\n`);
const assistant = (content, inputTokens, outputTokens) =>
  emit({
    type: 'assistant',
    message: { id: `msg_${Math.random().toString(36).slice(2, 8)}`, type: 'message', role: 'assistant', model: MODEL, content, stop_reason: 'end_turn', usage: { input_tokens: inputTokens, output_tokens: outputTokens } },
    parent_tool_use_id: null,
    session_id: SESSION,
  });

const result = () =>
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 2,
    result: 'All done: the theme is dark.',
    total_cost_usd: 0.0031,
    usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 150 },
    session_id: SESSION,
  });

const run = () => {
  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: SESSION, model: MODEL, tools: ['read_file', 'write_file'], mcp_servers: [], permissionMode: 'default', codebuddy_code_version: VERSION });
  if (scenario === 'hang') {
    // One chunk, then silence with the run open: the stop path is under test.
    assistant([{ type: 'text', text: 'working' }], 100, 10);
    return;
  }
  if (scenario === 'steady') {
    // Six chunks a quarter second apart: the run outlasts a one-second watchdog while no single
    // gap comes near it.
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      assistant([{ type: 'text', text: `chunk ${sent}` }], 100 + sent, 10);
      if (sent < 6) return;
      clearInterval(timer);
      result();
    }, 250);
    return;
  }
  assistant([{ type: 'text', text: 'Reading the config first.' }], 500, 40);
  assistant(
    [
      { type: 'tool_use', id: 'toolu_fake01', name: 'read_file', input: { file_path: '/tmp/fake/config.json' } },
    ],
    600,
    60,
  );
  emit({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake01', content: '{"theme":"dark"}', is_error: false }] },
    parent_tool_use_id: 'toolu_fake01',
    session_id: SESSION,
  });
  assistant([{ type: 'text', text: 'All done: the theme is dark.' }], 900, 80);
  result();
};

let started = false;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (line.trim() === '') return;
  fs.appendFileSync(logPath, `${line}\n`);
  if (started) return;
  started = true;
  run();
});
// The transport closes stdin right after the prompt; the process stays alive until it is
// signalled or its scripted run ends.
setInterval(() => {}, 1 << 30);
rl.on('close', () => {});
