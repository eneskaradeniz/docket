#!/usr/bin/env node
// Scripted Agent Client Protocol agent for transport tests. It speaks JSON-RPC 2.0 over stdio
// exactly as the public ACP specification prescribes (newline-delimited UTF-8 messages) and
// appends every exchanged message to a log file, so tests can assert on precisely what the
// client sent and in which order. The scenario name and log path arrive as launch arguments.
//
// SIGTERM is handled gracefully instead of terminating: stop() denies a pending permission
// request and cancels the turn right before signalling the process group, and the messages
// already in the pipe must still be drained for that deny to be observable. The process exits
// through its own scripted flow (or the post-signal deadline), never mid-message.
const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.argv[2] ?? 'happy';
const logPath = process.argv[3];
if (typeof logPath !== 'string' || logPath === '') process.exit(2);

const log = (dir, line) => {
  fs.appendFileSync(logPath, `${JSON.stringify({ dir, line })}\n`);
};

let nextId = 100;
let sessionId = null;
let promptId = null;
let pendingPermissionId = null;

const send = (message) => {
  const line = JSON.stringify(message);
  log('out', line);
  process.stdout.write(`${line}\n`);
};
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const respondError = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
const update = (updateBody) =>
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: updateBody } });

const advertiseLoadSession = scenario !== 'load-unsupported';
const freshSessionId = scenario === 'load-fail' || scenario === 'load-unsupported' ? 'sess_fake_fresh' : 'sess_fake_1';

// The models-* scenarios answer session/new the way the live CLIs do (observed 2026-10: one
// answers with a models object plus a model config option; the other with config options only,
// among them a thought_level select). The thought-level shape advertises sessionCapabilities.close
// exactly as its live counterpart does; the available-models shape does not advertise it.
const advertiseSessionClose = scenario === 'models-opencode';

const cursorModelsSession = () => ({
  sessionId: freshSessionId,
  modes: {},
  models: {
    currentModelId: 'default[]',
    availableModels: [
      { modelId: 'default[]', name: 'Auto' },
      { modelId: 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', name: 'grok-4.7' },
      { modelId: 'claude-opus-5-5[context=300k,effort=medium,fast=false]', name: 'claude-opus-5-5' },
    ],
  },
  configOptions: [
    { id: 'mode', category: 'mode', type: 'select', currentValue: 'agent', options: [{ value: 'agent', name: 'Agent' }, { value: 'plan', name: 'Plan' }] },
    {
      id: 'model',
      category: 'model',
      type: 'select',
      currentValue: 'default[]',
      options: [
        { value: 'default[]', name: 'Auto' },
        { value: 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', name: 'grok-4.7' },
        { value: 'claude-opus-5-5[context=300k,effort=medium,fast=false]', name: 'claude-opus-5-5' },
      ],
    },
  ],
});

const opencodeModelsSession = () => ({
  sessionId: freshSessionId,
  configOptions: [
    {
      id: 'model',
      category: 'model',
      type: 'select',
      currentValue: 'opencode/fledge-alpha-free',
      options: [
        { value: 'opencode/big-pickle', name: 'opencode/Big Pickle' },
        { value: 'opencode/fledge-alpha-free', name: 'opencode/Fledge Alpha Free' },
        { value: 'opencode/space-bunny-free', name: 'opencode/Space Bunny Free' },
      ],
    },
    {
      id: 'effort',
      category: 'thought_level',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
        { value: 'max', name: 'Max' },
        { value: 'default', name: 'Default' },
      ],
    },
    { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }] },
  ],
});

process.on('SIGTERM', () => {
  // Drain what is already in the pipe, then leave; a hard hang would wedge stop(). The grace
  // is generous because the test suite runs many files in parallel on a loaded machine.
  setTimeout(() => process.exit(0), 500);
});

const initializeResult = () => ({
  protocolVersion: 1,
  agentCapabilities: {
    ...(advertiseLoadSession ? { loadSession: true } : {}),
    ...(advertiseSessionClose ? { sessionCapabilities: { close: {} } } : {}),
  },
  agentInfo: { name: 'fake-agent', version: '1.0.0' },
  authMethods: [],
});

const echoPromptText = (promptBlocks) =>
  (Array.isArray(promptBlocks) ? promptBlocks : [])
    .map((block) => (block !== null && typeof block === 'object' && block.type === 'text' ? String(block.text) : ''))
    .join('');

const runTurn = (promptBlocks) => {
  if (scenario === 'die') process.exit(1);
  if (scenario === 'load-fail' || scenario === 'load-unsupported') {
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_echo', content: { type: 'text', text: echoPromptText(promptBlocks) } });
    respond(promptId, { stopReason: 'end_turn' });
    return;
  }
  if (scenario === 'load-ok') {
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_cont', content: { type: 'text', text: 'CONTINUED' } });
    respond(promptId, { stopReason: 'end_turn' });
    return;
  }
  if (scenario === 'permission') {
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_001',
      name: 'edit_file',
      title: 'Editing config',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: '/tmp/docket-acp-fixture/config.json', line: 1 }],
    });
    pendingPermissionId = nextId;
    nextId += 1;
    send({
      jsonrpc: '2.0',
      id: pendingPermissionId,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 'call_001', name: 'edit_file', title: 'Editing config', kind: 'edit', status: 'pending', locations: [{ path: '/tmp/docket-acp-fixture/config.json', line: 1 }] },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
    return; // the agent waits: nothing else happens until the client answers
  }
  // happy
  update({ sessionUpdate: 'agent_thought_chunk', messageId: 'msg_thought', content: { type: 'text', text: 'planning' } });
  update({
    sessionUpdate: 'tool_call',
    toolCallId: 'call_001',
    name: 'read_file',
    title: 'Reading config',
    kind: 'read',
    status: 'pending',
    locations: [{ path: '/tmp/docket-acp-fixture/config.json', line: 3 }],
  });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_001', status: 'in_progress' });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_001', status: 'completed' });
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_text', content: { type: 'text', text: 'Working.' } });
  update({ sessionUpdate: 'usage_update', used: 53000, size: 200000, cost: { amount: 0.045, currency: 'USD' } });
  update({ sessionUpdate: 'wormhole_transmission', payload: 'unexpected kind' });
  respond(promptId, { stopReason: 'end_turn' });
};

const onLine = (line) => {
  if (line.trim() === '') return;
  log('in', line);
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === 'initialize') {
    respond(message.id, initializeResult());
    return;
  }
  if (message.method === 'session/new') {
    sessionId = freshSessionId;
    if (scenario === 'models-cursor') {
      respond(message.id, cursorModelsSession());
      return;
    }
    if (scenario === 'models-opencode') {
      respond(message.id, opencodeModelsSession());
      return;
    }
    if (scenario === 'models-silent') return; // never answers: the client's timeout is under test
    if (scenario === 'models-die') process.exit(1);
    respond(message.id, { sessionId });
    return;
  }
  if (message.method === 'session/set_config_option') {
    respond(message.id, { configOptions: [] });
    return;
  }
  if (message.method === 'session/close') {
    respond(message.id, {});
    return;
  }
  if (message.method === 'session/load') {
    // The replayed updates belong to the session being loaded, so its id is adopted first.
    sessionId = message.params.sessionId;
    update({ sessionUpdate: 'user_message_chunk', messageId: 'msg_prev_user', content: { type: 'text', text: 'previous work order' } });
    if (scenario === 'load-fail') {
      update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_prev_agent', content: { type: 'text', text: 'A'.repeat(6000) } });
      respondError(message.id, 'the stored session state is gone');
      return;
    }
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_prev_agent', content: { type: 'text', text: 'previous answer' } });
    respond(message.id, {});
    return;
  }
  if (message.method === 'session/prompt') {
    promptId = message.id;
    runTurn(message.params.prompt);
    return;
  }
  if (
    pendingPermissionId !== null &&
    message.id === pendingPermissionId &&
    message.result !== undefined &&
    message.result.outcome !== undefined
  ) {
    pendingPermissionId = null;
    const outcome = message.result.outcome.outcome;
    if (outcome === 'cancelled') {
      respond(promptId, { stopReason: 'cancelled' });
      // stop() sends the deny and the turn cancellation back to back; leave the loop alive so
      // the queued cancellation line is still read and logged before this process leaves.
      setTimeout(() => process.exit(0), 500);
      return;
    }
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_001', status: 'completed' });
    update({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg_answer',
      content: { type: 'text', text: `ANSWER:${message.result.outcome.optionId ?? outcome}` },
    });
    respond(promptId, { stopReason: 'end_turn' });
  }
  // Anything else (session/cancel, responses to requests this agent never made) is logged only.
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', onLine);
rl.on('close', () => process.exit(0));
