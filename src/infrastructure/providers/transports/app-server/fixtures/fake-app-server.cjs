#!/usr/bin/env node
// Fake app-server fixture: newline-delimited JSON-RPC 2.0 over stdio, scripted by scenario
// (argv[2]); every message in both directions is appended to the log file (argv[3]) so tests can
// assert exactly what the client sent and received. No real agent CLI is involved.
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
const note = (method, params) => send({ jsonrpc: '2.0', method, params });

const THREAD_ID = 'th_fake_1';
const TURN_ID = 'turn_fake_1';
const THREAD = { id: THREAD_ID, sessionId: 'sess_1' };
const TURN = { id: TURN_ID, status: 'inProgress' };

// Mirrors the documented account/rateLimits/read payload shape: a single-bucket snapshot with
// one ~5h primary and one ~weekly secondary window, windows stated by the server itself.
const RATE_LIMITS = {
  limitId: 'codex-main',
  limitName: 'Codex',
  primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1759000000 },
  secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1759600000 },
};

// A rolling update with every optional value absent: the client must keep the reading without
// inventing a duration or a reset time.
const SPARSE_RATE_LIMITS = { primary: { usedPercent: 80 } };

// model/list pages (the catalog adapter's scenarios, shapes as recorded from the CLI): each row
// carries id, displayName, isDefault, supportedReasoningEfforts and defaultReasoningEffort, and
// the effort sets differ per model — one lists low…ultra, another has no max, one advertises an
// unknown level, one lists none at all.
const CODEX_MODEL = { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', isDefault: false, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultReasoningEffort: 'high' };
const MINI_MODEL = { id: 'gpt-5.3-mini', displayName: 'GPT-5.3 mini', isDefault: false, supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' };
const NANO_MODEL = { id: 'gpt-5.3-nano', displayName: 'GPT-5.3 nano', isDefault: true, supportedReasoningEfforts: ['low', 'sport', 'high'], defaultReasoningEffort: 'low' };
const PLAIN_MODEL = { id: 'gpt-5.3', displayName: 'GPT-5.3', isDefault: false, defaultReasoningEffort: 'medium' };

const MODEL_LIST_SCENARIOS = new Set(['model-list', 'model-list-two', 'model-list-forever', 'model-list-timeout']);
const MODEL_LIST_ONE_PAGE = [{ data: [CODEX_MODEL, MINI_MODEL, NANO_MODEL, PLAIN_MODEL], nextCursor: null }];
const MODEL_LIST_TWO_PAGES = [
  { data: [CODEX_MODEL], nextCursor: 'page-2' },
  { data: [MINI_MODEL], nextCursor: null },
];

const RESULTS = {
  initialize: { userAgent: 'fake-app-server/1', codexHome: '/tmp/fake-codex-home', platformFamily: 'unix', platformOs: 'macos' },
  'thread/start': { thread: THREAD, model: 'gpt-5', modelProvider: 'openai', cwd: '/tmp' },
  'thread/resume': { thread: { ...THREAD, id: 'th_resumed' }, model: 'gpt-5', modelProvider: 'openai', cwd: '/tmp' },
  'turn/start': { turn: TURN },
  'turn/steer': { turnId: TURN_ID },
  'turn/interrupt': {},
};

const finishTurn = (status) => {
  note('item/agentMessage/delta', { threadId: THREAD_ID, turnId: TURN_ID, itemId: 'item_msg', delta: 'all done' });
  note('thread/tokenUsage/updated', {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    tokenUsage: { total: { totalTokens: 900, inputTokens: 600, cachedInputTokens: 100, cacheWriteInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 50 }, last: { totalTokens: 900, inputTokens: 600, cachedInputTokens: 100, cacheWriteInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 50 }, modelContextWindow: 272000 },
  });
  note('turn/completed', { threadId: THREAD_ID, turn: { ...TURN, status, startedAtMs: 1759000050000, completedAtMs: 1759000090000 } });
};

const afterTurnStart = () => {
  note('turn/started', { threadId: THREAD_ID, turn: TURN });
  if (scenario === 'unknown') {
    // Traffic a client cannot know: must be ignored, and the request must stay unanswered.
    note('some/future/notification', { hello: true });
    send({ jsonrpc: '2.0', id: 999, method: 'some/future/request', params: { ask: 'anything' } });
    finishTurn('completed');
    return;
  }
  if (scenario === 'approval' || scenario === 'approval-stop') {
    send({
      jsonrpc: '2.0',
      id: 41,
      method: 'item/commandExecution/requestApproval',
      params: { kind: 'command', threadId: THREAD_ID, turnId: TURN_ID, itemId: 'item_cmd', startedAtMs: 1759000060000, command: 'rm -rf /tmp/fake', cwd: '/tmp' },
    });
    return; // the turn only completes once the approval answer arrives (approval-stop never completes)
  }
  if (scenario === 'rate-limits') {
    note('account/rateLimits/updated', { rateLimits: SPARSE_RATE_LIMITS });
    finishTurn('completed');
    return;
  }
  if (scenario === 'steer') {
    note('item/agentMessage/delta', { threadId: THREAD_ID, turnId: TURN_ID, itemId: 'item_msg', delta: 'working' });
    return; // the turn completes once the steer request arrives
  }
  finishTurn('completed');
};

const handleRequest = (msg) => {
  if (msg.method === 'account/rateLimits/read') {
    if (scenario === 'rate-limits') reply(msg.id, { ordinaryUsageAllowed: true, rateLimits: RATE_LIMITS, rateLimitsByLimitId: null, rateLimitResetCredits: null, accountId: 'acc_1', rateLimitUpsell: null });
    else replyError(msg.id, -32601, 'method not found'); // a server without quota answers with an error; the run must not care
    return;
  }
  if (msg.method === 'model/list' && MODEL_LIST_SCENARIOS.has(scenario)) {
    if (scenario === 'model-list-timeout') return; // the list is never answered; the caller's timeout fires
    if (scenario === 'model-list-forever') {
      reply(msg.id, { data: [], nextCursor: `more-${msg.id}` }); // every page promises one more
      return;
    }
    const pages = scenario === 'model-list-two' ? MODEL_LIST_TWO_PAGES : MODEL_LIST_ONE_PAGE;
    const cursor = msg.params === undefined || msg.params === null ? undefined : msg.params.cursor;
    reply(msg.id, cursor === 'page-2' ? pages[1] : pages[0]);
    return;
  }
  if (scenario === 'exit-early') {
    // Only initialize is answered; the process dies before anything else can complete.
    if (msg.method === 'initialize') {
      reply(msg.id, RESULTS.initialize);
      setTimeout(() => process.exit(3), 20);
    }
    return;
  }
  if (scenario === 'handshake-error' && msg.method === 'thread/start') {
    replyError(msg.id, -32000, 'the thread could not be started');
    return;
  }
  const result = RESULTS[msg.method];
  if (result === undefined) {
    replyError(msg.id, -32601, `no fixture result for ${msg.method}`);
    return;
  }
  reply(msg.id, result);
  if (msg.method === 'turn/start') afterTurnStart();
  if (msg.method === 'turn/steer' && scenario === 'steer') finishTurn('completed');
};

const handleLine = (line) => {
  if (line.trim() === '') return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method !== undefined) {
    if (msg.id === undefined) return; // client notification: none is scripted
    log('in', msg);
    handleRequest(msg);
    return;
  }
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    log('in', msg); // responses to server requests (approvals) land here
    if (scenario === 'approval' && msg.id === 41) finishTurn('completed');
    return;
  }
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', handleLine);
setInterval(() => {}, 1 << 30); // stay alive until the client tears the process group down
