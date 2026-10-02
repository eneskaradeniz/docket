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
const advertiseSessionClose = scenario === 'models-opencode' || scenario === 'models-kilo' || scenario === 'models-hermes-close' || scenario === 'models-atomcode' || scenario === 'models-atomcode-configured' || scenario === 'models-vibe' || scenario === 'models-mimo';

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

// The kilo shape: a very long model list whose default is an image model, a thought-level option
// named `effort` whose levels depend on the selected model and are recomputed when the model
// changes (only `thinking` for the default model), and a mode option.
const KILO_DEFAULT_MODEL = 'kilo/google/gemini-3-pro-image';
const KILO_MODELS = [
  KILO_DEFAULT_MODEL,
  'kilo/anthropic/claude-opus-5',
  'kilo/z-ai/glm-5.1',
  'kilo/kilo-auto/free',
];
const KILO_EFFORTS = {
  [KILO_DEFAULT_MODEL]: ['thinking'],
  'kilo/anthropic/claude-opus-5': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'kilo/z-ai/glm-5.1': ['instant', 'thinking'],
  'kilo/kilo-auto/free': ['thinking'],
};
let kiloModel = KILO_DEFAULT_MODEL;
let kiloEffort = 'thinking';
const kiloConfigOptions = () => [
  {
    id: 'model',
    category: 'model',
    type: 'select',
    currentValue: kiloModel,
    options: KILO_MODELS.map((value) => ({ value, name: `Kilo Gateway/${value}` })),
  },
  {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    currentValue: kiloEffort,
    options: KILO_EFFORTS[kiloModel].map((value) => ({ value, name: value })),
  },
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'code', options: [{ value: 'code', name: 'Code' }, { value: 'plan', name: 'Plan' }] },
];

// The atomcode shape: a mode select with four modes and a `reasoning_effort` thought-level select
// (off, high, max), and a `model` select only when a provider is configured. The levels do not
// depend on the model.
const ATOMCODE_MODELS = ['deepseek-chat', 'glm-5.2'];
let atomcodeModel = ATOMCODE_MODELS[0];
let atomcodeEffort = 'off';
const atomcodeConfigOptions = (configured) => [
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: ['build', 'accept_edits', 'bypass', 'plan'].map((value) => ({ value, name: value })) },
  ...(configured
    ? [{ id: 'model', category: 'model', type: 'select', currentValue: atomcodeModel, options: ATOMCODE_MODELS.map((value) => ({ value, name: value })) }]
    : []),
  {
    id: 'reasoning_effort',
    category: 'thought_level',
    type: 'select',
    currentValue: atomcodeEffort,
    options: [
      { value: 'off', name: 'Off (API default)' },
      { value: 'high', name: 'High' },
      { value: 'max', name: 'Max' },
    ],
  },
];

// The vibe shape: a mode select, a `model` select whose values are aliases, and a `thinking`
// select under the category `thinking` (not `thought_level`) with levels off to max.
const VIBE_MODELS = ['mistral-medium-3.5', 'local'];
const VIBE_LEVELS = ['off', 'low', 'medium', 'high', 'max'];
let vibeModel = VIBE_MODELS[0];
let vibeThinking = 'high';
const vibeConfigOptions = () => [
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'default', options: ['default', 'plan', 'accept-edits', 'auto-approve'].map((value) => ({ value, name: value })) },
  {
    id: 'model',
    category: 'model',
    type: 'select',
    currentValue: vibeModel,
    options: [
      { value: 'mistral-medium-3.5', name: 'mistral-vibe-cli-latest', description: 'Mistral Medium 3.5' },
      { value: 'local', name: 'devstral', description: 'Devstral (local)' },
    ],
  },
  { id: 'thinking', category: 'thinking', type: 'select', currentValue: vibeThinking, options: VIBE_LEVELS.map((value) => ({ value, name: value })) },
];

// The mimo shape: no thought-level option at all; the model select lists every model plain and
// once per level as `<model>/<level>` (the model ids themselves contain slashes), plus a mode.
const MIMO_BASE_MODELS = ['mimo/mimo-auto', 'xiaomi/mimo-v2.6-pro'];
const MIMO_MODELS = MIMO_BASE_MODELS.flatMap((base) => [base, `${base}/low`, `${base}/medium`, `${base}/high`]);
let mimoModel = 'xiaomi/mimo-v2.6-pro/high';
const mimoConfigOptions = () => [
  { id: 'model', category: 'model', type: 'select', currentValue: mimoModel, options: MIMO_MODELS.map((value) => ({ value, name: value })) },
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'build' }, { value: 'plan', name: 'plan' }] },
];

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

// The hermes-style session answer: a `models` object whose ids are `provider:model` and no
// configOptions at all (so no thought_level).
const hermesModelsSession = () => ({
  sessionId: freshSessionId,
  models: {
    currentModelId: 'nous:hermes-4-405b',
    availableModels: [
      { modelId: 'nous:hermes-4-405b', name: 'Hermes 4 405B' },
      { modelId: 'openrouter:vendor/some-model:free', name: 'some-model (free)' },
      { modelId: 'custom:local:llama-3', name: 'llama-3' },
    ],
  },
});

// The refusal a machine with no configured inference provider answers session/new with: JSON-RPC
// -32603 whose human-readable detail sits in `data`.
const sendLoginRefusal = (id) =>
  send({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message: 'Internal error',
      data: { details: 'Hermes is not connected to any AI provider yet. Run `hermes model` to choose one.' },
    },
  });

process.on('SIGTERM', () => {
  // Drain what is already in the pipe, then leave; a hard hang would wedge stop(). The grace
  // is generous because the test suite runs many files in parallel on a loaded machine.
  setTimeout(() => process.exit(0), 500);
});

// The grok-style initialize answer: the model list rides `_meta.modelState` (given even when
// logged out), each model with its own reasoning efforts, and the only auth method is a browser
// login. Its session/new is refused with -32000 until a login exists, so a catalog flow that
// opened a session would fail on it.
const grokModelState = () => ({
  currentModelId: 'grok-4.6',
  availableModels: [
    { modelId: 'grok-4.6', name: 'Grok 4.6', _meta: { totalContextTokens: 256000, supportsReasoningEffort: true, reasoningEfforts: [{ value: 'xhigh' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }] } },
    { modelId: 'grok-4.5', name: 'Grok 4.5', _meta: { totalContextTokens: 256000, supportsReasoningEffort: true, reasoningEfforts: [{ value: 'high' }, { value: 'medium' }, { value: 'low' }, { value: 'ludicrous' }] } },
    { modelId: 'grok-code-fast', name: 'Grok Code Fast', _meta: { supportsReasoningEffort: false } },
  ],
});

const initializeResult = () => ({
  protocolVersion: 1,
  agentCapabilities: {
    ...(advertiseLoadSession ? { loadSession: true } : {}),
    ...(advertiseSessionClose ? { sessionCapabilities: { close: {} } } : {}),
  },
  agentInfo: { name: 'fake-agent', version: '1.0.0' },
  authMethods: scenario === 'models-grok' ? [{ id: 'grok.com' }] : [],
  ...(scenario === 'models-grok' ? { _meta: { modelState: grokModelState() } } : {}),
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
  if (scenario === 'hang') {
    // One chunk, then silence with the turn open: the stop path is under test.
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'msg_hang', content: { type: 'text', text: 'working' } });
    return;
  }
  if (scenario === 'steady') {
    // A long turn that never goes silent for long: six chunks a quarter second apart, so the
    // whole turn outlasts a one-second watchdog while no single gap comes near it.
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      update({ sessionUpdate: 'agent_message_chunk', messageId: `msg_${sent}`, content: { type: 'text', text: `chunk ${sent}` } });
      if (sent < 6) return;
      clearInterval(timer);
      update({ sessionUpdate: 'usage_update', used: 100, size: 200000 });
      respond(promptId, { stopReason: 'end_turn' });
    }, 250);
    return;
  }
  if (scenario === 'permission' || scenario === 'permission-hermes' || scenario === 'permission-hermes-standing') {
    const permissionOptions =
      scenario === 'permission'
        ? [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ]
        : scenario === 'permission-hermes'
          ? [
              { optionId: 'allow_session', name: 'Allow for this session', kind: 'allow_always' },
              { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
              { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
            ]
          : [
              { optionId: 'allow_session', name: 'Allow for this session', kind: 'allow_always' },
              { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
            ];
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
        options: permissionOptions,
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
    if (scenario === 'models-grok') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required', data: 'no auth method id provided' } });
      return;
    }
    if (scenario === 'models-cursor') {
      respond(message.id, cursorModelsSession());
      return;
    }
    if (scenario === 'models-opencode') {
      respond(message.id, opencodeModelsSession());
      return;
    }
    if (scenario === 'models-hermes' || scenario === 'models-hermes-close') {
      respond(message.id, hermesModelsSession());
      return;
    }
    if (scenario === 'session-login-refused') {
      sendLoginRefusal(message.id);
      return;
    }
    if (scenario === 'session-internal-error') {
      // Same code as the login refusal, different text: not a login answer.
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error', data: { details: 'disk full' } } });
      return;
    }
    if (scenario === 'session-garbled') {
      send({ jsonrpc: '2.0', id: message.id, error: 'not an object' });
      return;
    }
    if (scenario === 'models-kilo') {
      respond(message.id, { sessionId: freshSessionId, configOptions: kiloConfigOptions() });
      return;
    }
    if (scenario === 'models-atomcode' || scenario === 'models-atomcode-configured') {
      respond(message.id, {
        sessionId: freshSessionId,
        modes: { currentModeId: 'build', availableModes: [{ id: 'build' }, { id: 'accept_edits' }, { id: 'bypass' }, { id: 'plan' }] },
        configOptions: atomcodeConfigOptions(scenario === 'models-atomcode-configured'),
      });
      return;
    }
    if (scenario === 'models-vibe') {
      respond(message.id, { sessionId: freshSessionId, configOptions: vibeConfigOptions() });
      return;
    }
    if (scenario === 'models-mimo') {
      respond(message.id, { sessionId: freshSessionId, configOptions: mimoConfigOptions() });
      return;
    }
    if (scenario === 'models-vibe-nokey') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Missing API key for mistral provider.' } });
      return;
    }
    if (scenario === 'models-silent') return; // never answers: the client's timeout is under test
    if (scenario === 'models-die') process.exit(1);
    respond(message.id, { sessionId });
    return;
  }
  if (message.method === 'session/set_config_option') {
    if (scenario === 'models-atomcode' || scenario === 'models-atomcode-configured') {
      const { configId, value } = message.params;
      if (configId === 'model' && ATOMCODE_MODELS.includes(value)) atomcodeModel = value;
      if (configId === 'reasoning_effort' && ['off', 'high', 'max'].includes(value)) atomcodeEffort = value;
      respond(message.id, { configOptions: atomcodeConfigOptions(scenario === 'models-atomcode-configured') });
      return;
    }
    if (scenario === 'models-vibe') {
      const { configId, value } = message.params;
      if (configId === 'model' && VIBE_MODELS.includes(value)) vibeModel = value;
      if (configId === 'thinking' && VIBE_LEVELS.includes(value)) vibeThinking = value;
      respond(message.id, { configOptions: vibeConfigOptions() });
      return;
    }
    if (scenario === 'models-mimo') {
      const { configId, value } = message.params;
      if (configId === 'model' && MIMO_MODELS.includes(value)) mimoModel = value;
      respond(message.id, { configOptions: mimoConfigOptions() });
      return;
    }
    if (scenario === 'models-kilo') {
      const { configId, value } = message.params;
      if (configId === 'model' && KILO_MODELS.includes(value)) {
        kiloModel = value;
        kiloEffort = KILO_EFFORTS[value][0];
      } else if (configId === 'effort' && KILO_EFFORTS[kiloModel].includes(value)) {
        kiloEffort = value;
      }
      respond(message.id, { configOptions: kiloConfigOptions() });
      return;
    }
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
