#!/usr/bin/env node
// smoke-agent.mjs — the scripted stand-in agent the smoke launch impersonates a provider CLI
// with. It speaks the Agent Client Protocol over stdio (newline-delimited JSON-RPC 2.0) exactly
// as the app's ACP transport expects, so the smoke exercises the real spawn → handshake →
// session → permission round-trip path with no product seam touched.
//
// Script (deterministic, one ask, no timers):
//   --version                       → print one line, exit 0 (discovery's probe)
//   initialize                      → protocolVersion 1, no optional capabilities
//   session/new                     → a fixed session id
//   session/prompt                  → emit ONE session/request_permission request, then wait
//   answer to that request          → answer the prompt turn with stopReason end_turn, exit 0
//
// The permission round-trip is the point: the client's answer arrives on stdin as the JSON-RPC
// response to our request, and only then does the turn end. The run therefore parks with an open
// ask for as long as the operator (the harness) takes to answer — no timeout races anywhere.
const PERMISSION_RPC_ID = 1001;

if (process.argv.includes('--version')) {
  process.stdout.write('docket-smoke-agent 1.0.0\n');
  process.exit(0);
}

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

import { createInterface } from 'node:readline';

let promptRpcId = null;

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (text === '') return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return; // not JSON-RPC; ignored like any agent would
  }

  if (typeof message.id === 'number' && typeof message.method === 'string') {
    // A client → agent request: the handshake and the session calls we scripted for.
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
      return;
    }
    if (message.method === 'session/new') {
      send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'duman-session-1' } });
      return;
    }
    if (message.method === 'session/prompt') {
      promptRpcId = message.id;
      send({
        jsonrpc: '2.0',
        id: PERMISSION_RPC_ID,
        method: 'session/request_permission',
        params: {
          toolCall: {
            name: 'duman-araci',
            title: 'Duman aracı çağrısı',
            toolCallId: 'call-duman-1',
            locations: [{ path: 'duman.txt' }],
          },
          options: [
            { optionId: 'allow-once', kind: 'allow_once' },
            { optionId: 'reject-once', kind: 'reject_once' },
          ],
        },
      });
      return;
    }
    // Anything else the client may call does not exist for this agent.
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } });
    return;
  }

  if (message.id === PERMISSION_RPC_ID && message.result !== undefined && promptRpcId !== null) {
    // The human's decision arrived through the client; the turn ends successfully either way
    // (the outcome the client selected rides in message.result, which the smoke does not need
    // to branch on — a denied tool also completes the scripted turn).
    send({ jsonrpc: '2.0', id: promptRpcId, result: { stopReason: 'end_turn' } });
    process.exit(0);
  }
});
