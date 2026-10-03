#!/usr/bin/env node
// Fake model-list endpoint for the API-key catalog adapter tests: an HTTP server scripted by a
// payload file, in the pattern of the z.ai fake monitor fixture. argv: [payloadPath, logPath,
// expectedKey]. The payload file holds a JSON array of { status, body } or { hang: true }
// responses served in request order — the last one repeats — and is re-read on every request, so
// one server can serve a success and then a failure. Every request is appended to the log as one
// line; the x-api-key header is only compared against the expected key and logged as a verdict,
// never recorded — the key must not appear in any file the tests read back. No real provider
// endpoint is involved.
'use strict';

const fs = require('node:fs');
const http = require('node:http');

const [, , payloadPath, logPath, expectedKey] = process.argv;
if (payloadPath === undefined || logPath === undefined || expectedKey === undefined) process.exit(2);

const log = (entry) => {
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
};

let served = 0;

const server = http.createServer((req, res) => {
  const key = req.headers['x-api-key'];
  // A verdict, never the value: 'match' means exactly the expected key.
  const keyVerdict = key === expectedKey ? 'match' : key === undefined ? 'missing' : 'mismatch';
  const version = typeof req.headers['anthropic-version'] === 'string' ? req.headers['anthropic-version'] : '';
  log({ event: 'request', method: req.method, url: req.url, key: keyVerdict, version });

  let spec;
  try {
    const list = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    spec = Array.isArray(list) ? list[Math.min(served, list.length - 1)] : undefined;
  } catch {
    spec = undefined;
  }
  served += 1;
  if (spec === undefined) {
    res.writeHead(500);
    res.end();
    return;
  }
  if (spec.hang === true) return; // never answer: the timeout path needs a silent endpoint
  res.writeHead(spec.status ?? 200, { 'content-type': 'application/json' });
  res.end(spec.body ?? '');
});

server.listen(0, '127.0.0.1', () => {
  log({ event: 'listening', port: server.address().port });
});
setInterval(() => {}, 1 << 30); // stay alive until the test tears the process down
