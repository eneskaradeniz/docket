#!/usr/bin/env node
// Scripted stand-in for a stream-json CLI speaking the agy dialect: one NDJSON user envelope on
// stdin, NDJSON events on stdout. The scenario (argv[2]) and a log path (argv[3]) are how a test
// scripts it; the log receives every stdin line so a test can see how the prompt arrived. No real
// agent CLI is involved. Later arguments are the definition's own launch arguments and are ignored.
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.argv[2] ?? 'happy';
const logPath = process.argv[3];
if (logPath === undefined) process.exit(2);

const CONVERSATION = 'conv_fake_1';

const emit = (object) => process.stdout.write(`${JSON.stringify(object)}\n`);
const step = (body) => emit({ event: 'step_update', step_update: { conversation_id: CONVERSATION, ...body } });
const text = (index, delta) => step({ step_index: index, state: 'DONE', step_type: 'agent_response', text_delta: delta });
const result = () =>
  emit({
    event: 'result',
    result: {
      conversation_id: CONVERSATION,
      status: 'SUCCESS',
      response: 'all done',
      num_turns: 1,
      usage: { input_tokens: 600, output_tokens: 300, thinking_tokens: 0, cache_read_tokens: 100, total_tokens: 900 },
    },
  });

const run = () => {
  emit({ event: 'init', conversation_id: CONVERSATION, init: { cwd: process.cwd(), tools: ['read_file'], permission_mode: 'request-review' } });
  if (scenario === 'hang') {
    // One chunk, then silence with the run open: the stop path is under test.
    text(1, 'working');
    return;
  }
  if (scenario === 'steady') {
    // Six chunks a quarter second apart: the run outlasts a one-second watchdog while no single
    // gap comes near it.
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      text(sent, `chunk ${sent}`);
      if (sent < 6) return;
      clearInterval(timer);
      result();
    }, 250);
    return;
  }
  step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { path: '/tmp/fake/config.json' } } });
  step({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'read_file' });
  text(3, 'all done');
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
