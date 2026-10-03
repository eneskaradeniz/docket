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
const advertiseSessionClose = scenario === 'models-opencode' || scenario === 'models-levels' || scenario === 'models-by-id' || scenario === 'models-optional' || scenario === 'models-optional-configured' || scenario === 'models-thinking' || scenario === 'models-suffix' || scenario === 'models-session-models';

// The cursor shape: parameterized ids whose bracketed group carries the vendor's own parameters,
// the window among them (`context=256k`; the help text's own example uses the `1m` magnitude).
// The two trailing rows exercise the magnitudes the reader maps and a value that names none.
const cursorModelsSession = () => ({
  sessionId: freshSessionId,
  modes: {},
  models: {
    currentModelId: 'default[]',
    availableModels: [
      { modelId: 'default[]', name: 'Auto' },
      { modelId: 'grok-4.7[context=256k,reasoning_effort=high,fast=true]', name: 'grok-4.7' },
      { modelId: 'claude-opus-5-5[context=300k,effort=medium,fast=false]', name: 'claude-opus-5-5' },
      { modelId: 'claude-opus-4-8[context=1m,effort=high,fast=false]', name: 'claude-opus-4-8' },
      { modelId: 'grok-4.6[context=vast,reasoning_effort=high,fast=false]', name: 'grok-4.6' },
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
        { value: 'claude-opus-4-8[context=1m,effort=high,fast=false]', name: 'claude-opus-4-8' },
        { value: 'grok-4.6[context=vast,reasoning_effort=high,fast=false]', name: 'grok-4.6' },
      ],
    },
  ],
});

// The per-model-levels shape: a very long model list whose default is an image model, a
// thought-level option named `effort` whose levels depend on the selected model and are
// recomputed when the model changes (only `thinking` for the default model), and a mode option.
const LEVELS_DEFAULT_MODEL = 'p-x/google/gemini-3-pro-image';
const LEVELS_MODELS = [
  LEVELS_DEFAULT_MODEL,
  'p-x/anthropic/claude-opus-5',
  'p-x/z-ai/glm-5.1',
  'p-x/gateway-auto/free',
];
const LEVELS_EFFORTS = {
  [LEVELS_DEFAULT_MODEL]: ['thinking'],
  'p-x/anthropic/claude-opus-5': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'p-x/z-ai/glm-5.1': ['instant', 'thinking'],
  'p-x/gateway-auto/free': ['thinking'],
};
let levelsModel = LEVELS_DEFAULT_MODEL;
let levelsEffort = 'thinking';
const levelsConfigOptions = () => [
  {
    id: 'model',
    category: 'model',
    type: 'select',
    currentValue: levelsModel,
    options: LEVELS_MODELS.map((value) => ({ value, name: `Gateway/${value}` })),
  },
  {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    currentValue: levelsEffort,
    options: LEVELS_EFFORTS[levelsModel].map((value) => ({ value, name: value })),
  },
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'code', options: [{ value: 'code', name: 'Code' }, { value: 'plan', name: 'Plan' }] },
];

// The id-named shape: select options named by id only (model, effort, tool_approval), model values
// as `provider/model`, effort levels that depend on the selected model and include `auto`, which
// names no level, and a rebuild on a model change that resets the effort.
const BY_ID_MODELS = ['deepseek-flash/deepseek-flash', 'deepseek-pro/deepseek-v4-pro'];
const BY_ID_EFFORTS = {
  'deepseek-flash/deepseek-flash': ['auto'],
  'deepseek-pro/deepseek-v4-pro': ['auto', 'high', 'max'],
};
let byIdModel = BY_ID_MODELS[0];
let byIdEffort = 'auto';
let byIdApproval = 'workspace-write';
const byIdConfigOptions = () => [
  { id: 'model', type: 'select', currentValue: byIdModel, options: BY_ID_MODELS.map((value) => ({ value, name: value })) },
  { id: 'effort', type: 'select', currentValue: byIdEffort, options: BY_ID_EFFORTS[byIdModel].map((value) => ({ value, name: value })) },
  {
    id: 'tool_approval',
    type: 'select',
    currentValue: byIdApproval,
    options: ['read-only', 'workspace-write', 'danger-full-access'].map((value) => ({ value, name: value })),
  },
];

// The optional-model shape: a mode select with four modes and an `effort` thought-level select
// (off, high, max), and a `model` select only when a provider is configured. The levels do not
// depend on the model.
const OPTIONAL_MODELS = ['deepseek-chat', 'glm-5.2'];
let optionalModel = OPTIONAL_MODELS[0];
let optionalEffort = 'off';
const optionalConfigOptions = (configured) => [
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: ['build', 'accept_edits', 'bypass', 'plan'].map((value) => ({ value, name: value })) },
  ...(configured
    ? [{ id: 'model', category: 'model', type: 'select', currentValue: optionalModel, options: OPTIONAL_MODELS.map((value) => ({ value, name: value })) }]
    : []),
  {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    currentValue: optionalEffort,
    options: [
      { value: 'off', name: 'Off (API default)' },
      { value: 'high', name: 'High' },
      { value: 'max', name: 'Max' },
    ],
  },
];

// The thinking-category shape: a mode select, a `model` select whose values are aliases, and a
// `thinking` select under the category `thinking` (not `thought_level`) with levels off to max.
const THINKING_MODELS = ['mistral-medium-3.5', 'local'];
const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'max'];
let thinkingModel = THINKING_MODELS[0];
let thinkingValue = 'high';
const thinkingConfigOptions = () => [
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'default', options: ['default', 'plan', 'accept-edits', 'auto-approve'].map((value) => ({ value, name: value })) },
  {
    id: 'model',
    category: 'model',
    type: 'select',
    currentValue: thinkingModel,
    options: [
      { value: 'mistral-medium-3.5', name: 'mistral-latest', description: 'Mistral Medium 3.5' },
      { value: 'local', name: 'devstral', description: 'Devstral (local)' },
    ],
  },
  { id: 'thinking', category: 'thinking', type: 'select', currentValue: thinkingValue, options: THINKING_LEVELS.map((value) => ({ value, name: value })) },
];

// The model-suffix shape: no thought-level option at all; the model select lists every model
// plain and once per level as `<model>/<level>` (the model ids themselves contain slashes), plus
// a mode.
const SUFFIX_BASE_MODELS = ['p-x/auto', 'p-x/pro-v2.6'];
const SUFFIX_MODELS = SUFFIX_BASE_MODELS.flatMap((base) => [base, `${base}/low`, `${base}/medium`, `${base}/high`]);
let suffixModel = 'p-x/pro-v2.6/high';
const suffixConfigOptions = () => [
  { id: 'model', category: 'model', type: 'select', currentValue: suffixModel, options: SUFFIX_MODELS.map((value) => ({ value, name: value })) },
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'build' }, { value: 'plan', name: 'plan' }] },
];

// The session-models shape: a configured machine answers session/new with BOTH a models object
// and config options — the model select, an effort thought_level select whose values include
// `default` (which names no level), and a mode select. The rows carry the extension field a
// session answer can give each model (`_meta.contextLimit`); the third row's negative value is
// not a window, so it must be ignored.
const SESSION_MODELS_SCENARIOS = ['models-session-models'];
const SESSION_MODELS = [
  { modelId: 'big-1-plus', name: 'Big 1 Plus', _meta: { contextLimit: 131072 } },
  { modelId: 'coder-plus', name: 'Coder Plus', _meta: { contextLimit: 262144 } },
  { modelId: 'flash-lite', name: 'Flash Lite', _meta: { contextLimit: -1 } },
];
let sessionModel = 'big-1-plus';
const sessionModelsConfigOptions = () => [
  { id: 'model', category: 'model', type: 'select', currentValue: sessionModel, options: SESSION_MODELS.map((model) => ({ value: model.modelId, name: model.name })) },
  {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    currentValue: 'default',
    options: ['none', 'default', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, name: value })),
  },
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'default', options: ['plan', 'default', 'auto-edit', 'auto'].map((value) => ({ value, name: value })) },
];
const sessionModelsSession = () => ({
  sessionId: freshSessionId,
  models: { currentModelId: sessionModel, availableModels: SESSION_MODELS },
  configOptions: sessionModelsConfigOptions(),
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

// The refusal a machine with no configured inference provider answers session/new with: JSON-RPC
// -32603 whose human-readable detail sits in `data`.
const sendLoginRefusal = (id) =>
  send({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message: 'Internal error',
      data: { details: 'The agent is not connected to any inference provider yet. Run its own setup to choose one.' },
    },
  });

process.on('SIGTERM', () => {
  // Drain what is already in the pipe, then leave; a hard hang would wedge stop(). The grace
  // is generous because the test suite runs many files in parallel on a loaded machine.
  setTimeout(() => process.exit(0), 500);
});

// The initialize-state answer: the model list rides `_meta.modelState` (given even when logged
// out), each model with its own reasoning efforts and its own `totalContextTokens`, and the only
// auth method is a browser login. Its session/new is refused with -32000 until a login exists, so
// a catalog flow that opened a session would fail on it. The last row's string value is not a
// window, so it must be ignored.
const initializeModelState = () => ({
  currentModelId: 'grok-4.6',
  availableModels: [
    { modelId: 'grok-4.6', name: 'Grok 4.6', _meta: { totalContextTokens: 256000, supportsReasoningEffort: true, reasoningEfforts: [{ value: 'xhigh' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }] } },
    { modelId: 'grok-4.5', name: 'Grok 4.5', _meta: { totalContextTokens: 256000, supportsReasoningEffort: true, reasoningEfforts: [{ value: 'high' }, { value: 'medium' }, { value: 'low' }, { value: 'ludicrous' }] } },
    { modelId: 'grok-code-fast', name: 'Grok Code Fast', _meta: { totalContextTokens: '500000', supportsReasoningEffort: false } },
  ],
});

const initializeResult = () => ({
  protocolVersion: 1,
  agentCapabilities: {
    ...(advertiseLoadSession ? { loadSession: true } : {}),
    ...(advertiseSessionClose ? { sessionCapabilities: { close: {} } } : {}),
  },
  agentInfo: { name: 'fake-agent', version: '1.0.0' },
  authMethods: scenario === 'models-init-state' ? [{ id: 'browser-login' }] : [],
  ...(scenario === 'models-init-state' ? { _meta: { modelState: initializeModelState() } } : {}),
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
  if (scenario === 'permission' || scenario === 'permission-standing' || scenario === 'permission-standing-only') {
    const permissionOptions =
      scenario === 'permission'
        ? [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ]
        : scenario === 'permission-standing'
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
    if (scenario === 'models-init-state') {
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
    if (scenario === 'models-levels') {
      respond(message.id, { sessionId: freshSessionId, configOptions: levelsConfigOptions() });
      return;
    }
    if (scenario === 'models-by-id') {
      respond(message.id, { sessionId: freshSessionId, configOptions: byIdConfigOptions() });
      return;
    }
    if (scenario === 'models-optional' || scenario === 'models-optional-configured') {
      respond(message.id, {
        sessionId: freshSessionId,
        modes: { currentModeId: 'build', availableModes: [{ id: 'build' }, { id: 'accept_edits' }, { id: 'bypass' }, { id: 'plan' }] },
        configOptions: optionalConfigOptions(scenario === 'models-optional-configured'),
      });
      return;
    }
    if (scenario === 'models-thinking') {
      respond(message.id, { sessionId: freshSessionId, configOptions: thinkingConfigOptions() });
      return;
    }
    if (scenario === 'models-suffix') {
      respond(message.id, { sessionId: freshSessionId, configOptions: suffixConfigOptions() });
      return;
    }
    if (scenario === 'models-session-models') {
      respond(message.id, sessionModelsSession());
      return;
    }
    if (scenario === 'models-silent') return; // never answers: the client's timeout is under test
    if (scenario === 'models-die') process.exit(1);
    respond(message.id, { sessionId });
    return;
  }
  if (message.method === 'session/set_config_option') {
    if (scenario === 'models-optional' || scenario === 'models-optional-configured') {
      const { configId, value } = message.params;
      if (configId === 'model' && OPTIONAL_MODELS.includes(value)) optionalModel = value;
      if (configId === 'effort' && ['off', 'high', 'max'].includes(value)) optionalEffort = value;
      respond(message.id, { configOptions: optionalConfigOptions(scenario === 'models-optional-configured') });
      return;
    }
    if (scenario === 'models-by-id') {
      const { configId, value } = message.params;
      if (configId === 'model' && BY_ID_MODELS.includes(value)) {
        byIdModel = value;
        byIdEffort = 'auto';
      } else if (configId === 'effort' && BY_ID_EFFORTS[byIdModel].includes(value)) {
        byIdEffort = value;
      } else if (configId === 'tool_approval') {
        byIdApproval = value;
      }
      respond(message.id, { configOptions: byIdConfigOptions() });
      return;
    }
    if (scenario === 'models-thinking') {
      const { configId, value } = message.params;
      if (configId === 'model' && THINKING_MODELS.includes(value)) thinkingModel = value;
      if (configId === 'thinking' && THINKING_LEVELS.includes(value)) thinkingValue = value;
      respond(message.id, { configOptions: thinkingConfigOptions() });
      return;
    }
    if (scenario === 'models-suffix') {
      const { configId, value } = message.params;
      if (configId === 'model' && SUFFIX_MODELS.includes(value)) suffixModel = value;
      respond(message.id, { configOptions: suffixConfigOptions() });
      return;
    }
    if (scenario === 'models-session-models') {
      const { configId, value } = message.params;
      if (configId === 'model' && SESSION_MODELS.some((model) => model.modelId === value)) sessionModel = value;
      respond(message.id, sessionModelsSession());
      return;
    }
    if (scenario === 'models-levels') {
      const { configId, value } = message.params;
      if (configId === 'model' && LEVELS_MODELS.includes(value)) {
        levelsModel = value;
        levelsEffort = LEVELS_EFFORTS[value][0];
      } else if (configId === 'effort' && LEVELS_EFFORTS[levelsModel].includes(value)) {
        levelsEffort = value;
      }
      respond(message.id, { configOptions: levelsConfigOptions() });
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
