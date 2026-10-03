// e2e/operator-run.test.mjs — the pure parts of `npm run operator-run`: arguments, consent,
// the permission prompt, canary search, redaction and the summary. No CLI, no network, no keychain.
// Run: node --test e2e/operator-run.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  PROMPT,
  buildSummary,
  capRequirement,
  consentText,
  isYes,
  loginState,
  parseArgs,
  parsePermissionAnswer,
  permissionPrompt,
  redact,
  requiresCap,
  searchCanary,
  summaryFileName,
  summaryLines,
} from './operator-run.mjs';

test('the provider is the one positional; every option takes a value', () => {
  const parsed = parseArgs(['codex', '--model', 'gpt-x', '--effort', 'high', '--cap-usd', '2.5', '--canary', 'blue fox', '--account', 'codex-api']);
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.model, 'gpt-x');
  assert.equal(parsed.effort, 'high');
  assert.equal(parsed.capUsd, 2.5);
  assert.equal(parsed.canary, 'blue fox');
  assert.equal(parsed.account, 'codex-api');
});

test('a missing provider, unknown flag, extra word, bad effort or bad cap is an error', () => {
  assert.throws(() => parseArgs([]), /provider definition id is required/);
  assert.throws(() => parseArgs(['codex', '--yes']), /unknown argument: --yes/);
  assert.throws(() => parseArgs(['codex', 'p-x']), /unexpected extra argument: p-x/);
  assert.throws(() => parseArgs(['codex', '--model']), /--model needs a value/);
  assert.throws(() => parseArgs(['codex', '--model', '--effort']), /--model needs a value/);
  assert.throws(() => parseArgs(['codex', '--effort', 'turbo']), /--effort must be one of/);
  assert.throws(() => parseArgs(['codex', '--cap-usd', '0']), /positive number/);
  assert.throws(() => parseArgs(['codex', '--cap-usd', 'abc']), /positive number/);
  assert.throws(() => parseArgs(['codex', '--canary', '  ']), /must not be blank/);
});

test('--help needs no provider', () => {
  assert.equal(parseArgs(['--help']).help, true);
});

test('only a model billed `included` runs without a cap', () => {
  assert.equal(requiresCap('included'), false);
  assert.equal(requiresCap('metered'), true);
  assert.equal(requiresCap('unknown'), true);
  assert.equal(capRequirement('included', undefined), undefined);
  assert.match(capRequirement('metered', undefined), /--cap-usd/);
  assert.match(capRequirement('unknown', undefined), /--cap-usd/);
  assert.equal(capRequirement('metered', 3), undefined);
});

test('the consent text names what runs, the prompt and the cap, and never an env value', () => {
  const text = consentText({ provider: 'p-x', routeKind: 'p-x-sub', authMode: 'subscription', model: undefined, effort: 'low', billing: 'metered', capUsd: 2, canary: 'x', tempRoot: '/tmp/r' });
  assert.match(text, /provider\s+p-x/);
  assert.match(text, /\(the CLI default\)/);
  assert.match(text, /\$2 per day/);
  assert.match(text, /may cost real money/);
  assert.ok(text.includes(JSON.stringify(PROMPT)));
  assert.match(text, /Type `yes`/);
  assert.equal(text.includes('canary check    on'), true);
  const free = consentText({ provider: 'p-x', routeKind: 'k', authMode: 'subscription', model: 'm', billing: 'included', tempRoot: '/tmp/r' });
  assert.match(free, /none \(included model\)/);
  assert.equal(free.includes('real money'), false);
});

test('only the word yes consents', () => {
  assert.equal(isYes('yes'), true);
  assert.equal(isYes('  YES \n'), true);
  for (const no of ['y', 'ok', 'yes please', '', '   ', 'no', null, undefined]) assert.equal(isYes(no), false, String(no));
});

test('a permission ask is shown with its tool and target and answered allow or deny only', () => {
  const text = permissionPrompt({ tool: 'bash', target: 'rm -rf x', options: ['allow_once', 'reject_once'] });
  assert.match(text, /bash on rm -rf x/);
  assert.match(text, /allow_once, reject_once/);
  assert.match(text, /`allow` or `deny`/);
  assert.equal(parsePermissionAnswer('allow'), 'allow');
  assert.equal(parsePermissionAnswer(' Deny '), 'deny');
  assert.equal(parsePermissionAnswer('a'), undefined);
  assert.equal(parsePermissionAnswer('yes'), undefined);
  assert.equal(parsePermissionAnswer(''), undefined);
  assert.equal(parsePermissionAnswer(null), 'deny');
});

const at = 1000;
const text = (delta) => ({ type: 'text', at, delta });

test('the canary is found across stream chunks and reported by event kind only', () => {
  const found = searchCanary([text('The blue '), text('fox  jumps'), { type: 'usage', at, inputTokens: 1, outputTokens: 1 }], 'blue fox jumps');
  assert.deepEqual(found, { checked: true, verdict: 'leaked', seenIn: ['text'] });
  assert.equal(JSON.stringify(found).includes('blue fox'), false);
});

test('a canary in a raw line or a tool target counts; no sentence reads as not seen', () => {
  assert.equal(searchCanary([{ type: 'raw', at, line: 'ctx: blue fox jumps' }], 'blue fox jumps').seenIn[0], 'raw');
  assert.equal(searchCanary([{ type: 'tool_call', at, id: '1', name: 'read', target: 'blue fox jumps' }], 'blue fox jumps').verdict, 'leaked');
  assert.equal(searchCanary([text('ok')], 'blue fox jumps').verdict, 'not seen');
  assert.deepEqual(searchCanary([text('blue fox jumps')], undefined), { checked: false, verdict: 'not checked', seenIn: [] });
});

test('redaction masks tokens, secret-named assignments and long opaque runs, and cuts long text', () => {
  assert.equal(redact('key sk-abcdefghijklmnop1234 here').includes('sk-abc'), false);
  assert.equal(redact('OPENAI_API_KEY=hunter2 next').includes('hunter2'), false);
  assert.equal(redact('Authorization: Bearer abc.def').includes('abc.def'), false);
  assert.equal(redact('blob ' + 'A'.repeat(40)).includes('AAAA'), false);
  assert.equal(redact('plain words stay').includes('plain words stay'), true);
  assert.ok(redact('x '.repeat(500)).length <= 200);
});

test('the login state: the probe is the answer; an auth error or a started session only speaks when the probe had none', () => {
  assert.equal(loginState(true, [{ type: 'error', at, class: 'auth', message: 'm' }]), 'yes');
  assert.equal(loginState(true, []), 'yes');
  assert.equal(loginState(false, []), 'no');
  assert.equal(loginState(null, [{ type: 'error', at, class: 'auth', message: 'm' }]), 'no');
  assert.equal(loginState(null, [{ type: 'session_started', at, sessionRef: 's' }]), 'yes');
  assert.equal(loginState(null, []), 'unknown');
});

const base = { date: '2026-10-02', provider: 'p-x', routeKind: 'p-x-sub', version: '1.2.3', discoveredLoggedIn: true, startedAt: 900, permissions: [], outcome: 'succeeded' };

test('the summary answers each question and carries no event text beyond the answer and redacted errors', () => {
  const events = [
    { type: 'session_started', at: 950, sessionRef: 'sess-secret-ref' },
    { type: 'raw', at: 960, line: 'HOME=/Users/x TOKEN=abc' },
    text('ok'),
    { type: 'usage', at: 1100, inputTokens: 10, outputTokens: 2, costUsd: 0.01 },
    { type: 'finished', at: 1200, reason: 'completed' },
  ];
  const summary = buildSummary({ ...base, events, canary: 'nothing', permissions: [{ tool: 'bash', decision: 'allow', waitedMs: 40 }] });
  assert.equal(summary.loggedIn, 'yes');
  assert.deepEqual(summary.firstOutput, { seen: true, afterMs: 100 });
  assert.deepEqual(summary.permission, { asked: 1, waitedMs: 40, answers: [{ tool: 'bash', decision: 'allow', waitedMs: 40 }] });
  assert.deepEqual(summary.usage, { seen: true, inputTokens: 10, outputTokens: 2, costUsd: 0.01 });
  assert.equal(summary.canary.verdict, 'not seen');
  assert.equal(summary.answer, 'ok');
  assert.equal(summary.outcome, 'succeeded');
  const json = JSON.stringify(summary);
  for (const leak of ['sess-secret-ref', 'HOME=', 'TOKEN=abc', '/Users/x']) assert.equal(json.includes(leak), false, leak);
});

test('a run with no output, usage or ask says so', () => {
  // The probe had already answered logged-out, so the auth error agrees with it rather than
  // overwriting a yes — the failing run itself stays in errors and the outcome.
  const summary = buildSummary({ ...base, discoveredLoggedIn: false, events: [{ type: 'error', at: 1000, class: 'auth', message: 'not logged in, token sk-abcdefghijklmnop1234' }], outcome: 'failed' });
  assert.deepEqual(summary.firstOutput, { seen: false });
  assert.deepEqual(summary.usage, { seen: false });
  assert.equal(summary.permission.asked, 0);
  assert.equal(summary.loggedIn, 'no');
  assert.equal(summary.canary.verdict, 'not checked');
  assert.equal(JSON.stringify(summary).includes('sk-abc'), false);
  assert.equal(summaryLines(summary).length, 6);
});

test('the output name is <date>-<provider>.json and never overwrites', () => {
  assert.equal(summaryFileName('2026-10-02', 'p-x', () => false), '2026-10-02-p-x.json');
  const taken = new Set(['2026-10-02-p-x.json', '2026-10-02-p-x-2.json']);
  assert.equal(summaryFileName('2026-10-02', 'p-x', (name) => taken.has(name)), '2026-10-02-p-x-3.json');
});
