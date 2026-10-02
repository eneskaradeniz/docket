#!/usr/bin/env node
// Fake Copilot-style ACP agent for the session-catalog tests: speaks newline-delimited
// JSON-RPC 2.0 over stdio and answers initialize + session/new per the scenario named in
// argv. argv: [scenario, logPath]. Every message in both directions lands in the log, so the
// tests assert the exact wire traffic — above all that no session/prompt is ever sent.
// Scenarios:
//   auto-only        the recorded answer of a plan limited to the automatic choice: the model
//                    option and the non-standard models field both carry three degenerate rows
//                    that all name the automatic choice (mirrors the probe capture)
//   several-models   a higher plan: named models alongside the automatic choice
//   models-field-only the model config option is absent; only the non-standard models field lists
//   no-model-option  neither channel reports models (the shape an older CLI answered with)
//   silent           answers nothing, for the timeout path
'use strict';

const fs = require('node:fs');

const [, , scenario, logPath] = process.argv;
if (scenario === undefined || logPath === undefined) process.exit(2);

const log = (dir, msg) => {
  fs.appendFileSync(logPath, `${JSON.stringify({ dir, msg })}\n`);
};

const AUTOMATIC_ROWS = [
  { value: 'auto', name: 'Auto', description: 'Let Copilot pick the best model' },
  { value: 'auto', name: 'Auto', description: 'Auto' },
  { value: 'auto', name: 'Auto', description: 'Auto' },
];

const namedRows = [
  { value: 'auto', name: 'Auto', description: 'Let Copilot pick the best model' },
  { value: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'OpenAI GPT-5.6 Luna' },
  { value: 'claude-opus-5.5', name: 'Claude Opus 5.5', description: 'Anthropic Claude Opus 5.5' },
];

const modeOption = {
  type: 'select',
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  currentValue: 'agent',
  options: [{ value: 'agent', name: 'Agent' }],
};

const modelOption = (options) => ({
  type: 'select',
  id: 'model',
  name: 'Model',
  category: 'model',
  description: 'The AI model the agent uses to generate responses.',
  currentValue: 'auto',
  options,
});

const toModelEntries = (options) => options.map((option) => ({ modelId: option.value, name: option.name }));

const SESSION_ANSWERS = {
  'auto-only': {
    sessionId: 'sess-auto',
    configOptions: [modeOption, modelOption(AUTOMATIC_ROWS)],
    models: { availableModels: toModelEntries(AUTOMATIC_ROWS), currentModelId: 'auto' },
  },
  'several-models': {
    sessionId: 'sess-several',
    configOptions: [modeOption, modelOption(namedRows)],
    models: { availableModels: toModelEntries(namedRows), currentModelId: 'auto' },
  },
  'models-field-only': {
    sessionId: 'sess-models-field',
    configOptions: [modeOption],
    models: { availableModels: toModelEntries(namedRows), currentModelId: 'auto' },
  },
  'no-model-option': {
    sessionId: 'sess-none',
    configOptions: [modeOption],
  },
};

const INITIALIZE_RESULT = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: 'Fake', version: '1.0.0' },
};

const answer = (msg) => {
  let result;
  if (msg.method === 'initialize') {
    result = INITIALIZE_RESULT;
  } else if (msg.method === 'session/new') {
    result = SESSION_ANSWERS[scenario];
  } else {
    const reply = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method "${msg.method}" is not available` } };
    log('out', reply);
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    return;
  }
  const reply = { jsonrpc: '2.0', id: msg.id, result };
  log('out', reply);
  process.stdout.write(`${JSON.stringify(reply)}\n`);
};

if (scenario === 'silent') {
  // Alive but mute: the timeout path needs an agent that never answers and never exits.
  setInterval(() => {}, 1 << 30);
} else {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim() === '') continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      log('in', msg);
      if (msg.id !== undefined && msg.method !== undefined) answer(msg);
    }
  });
}
