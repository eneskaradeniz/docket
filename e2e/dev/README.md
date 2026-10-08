# The dev bridge and the page checks

Stage 1 of the docket-dev bridge (#820): a session that drives the app over CDP sees both sides —
the UI and the API/store — and finds contradictions between them without guessing. The bridge
lives in `electron/dev-bridge.ts`; these are the exact snippets a session runs.

## Launch

```sh
npm run build
node e2e/launch-cdp.mjs                       # fresh temp data dir, removed on exit
DOCKET_CDP_DATA_DIR=/absolute/path node e2e/launch-cdp.mjs   # kept test data dir (0700)
```

The launcher sets `DOCKET_DEV_BRIDGE=1` and points `DOCKET_DATA_DIR` at the isolated directory.
The bridge's gate (`electron/dev-bridge.ts` → `devBridgeEnabled`) registers the `docket:dev`
handler only when **all** of these hold — any one missing and there is no handler at all, so the
invoke below simply rejects:

1. `DOCKET_DEV_BRIDGE=1` (exactly `1`),
2. the app is not packaged,
3. `DOCKET_DATA_DIR` is set,
4. it resolves outside `~/.docket` (equal or inside fails; the same code the launcher itself runs).

No op reads the secrets table or the OS keychain, returns an environment value, or accepts raw
SQL; every op reads through the app's own repositories. Replies are JSON, capped at 512 KB.

## Connecting and calling

```js
import { chromium } from 'playwright'; // or playwright-core
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];

// window.docketDev.call(op, args) → { truncated, payload }
// payload is one JSON document; when truncated is true it is only a byte prefix — narrow the
// ask (the `after` token, a smaller `limit`) instead of parsing the cut.
const describe = JSON.parse((await page.evaluate(
  (args) => window.docketDev.call('describe', args),
  {},
)).payload);
// describe.commands / describe.queries: [{ name, input }]; describe.ops: the four op names.
```

## The ops

**`describe`** — the boundary's names and input shapes from the api layer's own registry
(`src/api/registry.ts`, exhaustive by typecheck).

**`events.since`** — one merged timeline: the ui push channel (`docket-event`, the exact events
the windows receive) plus the stored run events, work-order events and audit entries, ordered by
time then source, numbered `n` gap-free. The continuation token is the wire field `after` (the
issue's own word for it is a banned vendor substring under the shell's boundary check — the
deviation is flagged for the architect in the PR). Poll:

```js
let after = 0;
for (;;) {
  const reply = await page.evaluate((a) => window.docketDev.call('events.since', { after: a, limit: 500 }), after);
  const body = JSON.parse(reply.payload); // { ok, after, events: [{ n, at, source, type, runId?, workOrderId?, summary }] }
  if (body.events.length === 0) break;
  after = body.after; // hand this back on the next call — ns continue without gaps
}
```

Summaries are ≤200 chars and never carry stream payloads (text deltas, raw lines).

**`store.read`** — five whitelisted views; anything else answers `{ ok: false, code: 'unknown_store' }`.

```js
await page.evaluate((name) => window.docketDev.call('store.read', { name }), 'accounts');
// accounts: { id, label, routeKind, endpoint, state } — state is the stored auth mode; no secret
//            reference value ever leaves the vault.
// bindings:  { scope, role, accounts: [{ accountId, model }] }
// work_orders: { id, number, project, repo, flow, title, status } — status is derived the way
//            the app derives it (the domain fold); null when the flow no longer loads.
// runs:      { id, workOrderId, stage, role, outcome, startedAt, endedAt, inputTokens, outputTokens }
// open_asks: { runId, workOrderId, askId, tool, at } — per active run, the asks the store's own
//            fold still sees open (an ask closes on the matching tool_result).
```

**`invariants`** — `[{ id, ok, detail }]` over the store's rows:

- `INV-1` a run that ended `succeeded` has non-zero summed tokens,
- `INV-2` if accounts exist, at least one binding exists,
- `INV-3` every run that ended has no open ask,
- `INV-4` a work order shown running has an active run.

## The page checks

`page-checks.mjs` walks the live page for reachability defects; the L-rules of
`e2e/layout-rules.mjs` keep measuring the shell's layout — these add, not replace:

- `PC-1` interactive controls without an accessible name,
- `PC-2` content hidden from the eye but reachable by Tab (the pilot's collapsed-pane case);
  hiding is legitimate only together with `inert`,
- `PC-3` interactive targets smaller than 24×24 CSS px,
- `PC-4` boxes crossing the viewport (elements inside scroll containers are exempt by design).

```js
import { runPageChecks, uiOpenAsks } from './page-checks.mjs';
const verdicts = await runPageChecks(page); // [{ id: 'PC-1'…'PC-4', ok, detail }]
```

`uiOpenAsks` reads the asks the page currently offers — the exact `permissions.open` answer the
page's own store renders from, plus the ask rows the detail pane shows — so a session can hold
both against `store.read open_asks` and name the layer that disagrees:

```js
const ui = await uiOpenAsks(page); // { query: OpenAskView[] | null, domAskRows: number }
const store = JSON.parse((await page.evaluate(
  () => window.docketDev.call('store.read', { name: 'open_asks' }),
)).payload);
```

The check policies are pure functions over the measured rows; `node --test
e2e/dev/page-checks.test.mjs` proves each with fixtures, the `e2e/layout-rules.test.mjs` pattern.
