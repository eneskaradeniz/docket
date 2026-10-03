#!/usr/bin/env node
// Fake monitor endpoint for the z.ai quota probe tests: an HTTP server scripted by a payload
// file, in the pattern of the codex fake app-server fixture (fixtures/fake-quota-server.cjs).
// argv: [payloadPath, logPath, expectedToken]. The payload file holds { status, body } and is
// re-read on every request, so one server can serve a success and then a failure. Every request
// is appended to the log as one line; the Authorization header is only compared against the
// expected token and logged as a verdict, never recorded — the token must not appear in any file
// the tests read back. No real provider endpoint is involved.
'use strict';

const fs = require('node:fs');
const http = require('node:http');

const [, , payloadPath, logPath, expectedToken] = process.argv;
if (payloadPath === undefined || logPath === undefined || expectedToken === undefined) process.exit(2);

const log = (entry) => {
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
};

const server = http.createServer((req, res) => {
  const authorization = req.headers.authorization;
  // A verdict, never the value: 'raw-match' means exactly the token, with no scheme prefix.
  const auth =
    authorization === expectedToken ? 'raw-match' : authorization === undefined ? 'missing' : 'mismatch';
  log({ event: 'request', method: req.method, url: req.url, auth });
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  } catch {
    res.writeHead(500);
    res.end();
    return;
  }
  res.writeHead(spec.status, { 'content-type': 'application/json' });
  res.end(spec.body);
});

server.listen(0, '127.0.0.1', () => {
  log({ event: 'listening', port: server.address().port });
});
setInterval(() => {}, 1 << 30); // stay alive until the test tears the process down
