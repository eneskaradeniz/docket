// e2e/operator-handoff.test.mjs — the pure parts of `npm run operator-handoff`: arguments, the
// consent plan, the refusal rules (cap, login, provider pair), the simulated-limit rule and its
// event, the pack facts read back from the prompt actually sent, the second-step check and the
// result record. No CLI, no network, no keychain. Run: node --test e2e/operator-handoff.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  CHECKER_INSTRUCTIONS,
  PROVIDER_X,
  PROVIDER_Y,
  canaryIn,
  canarySentence,
  consentText,
  firstOutputOf,
  inlineNames,
  missingCap,
  loginProblem,
  outcomeText,
  packStats,
  pairProblem,
  parseArgs,
  recordLines,
  buildRecord,
  shouldSimulateLimit,
  simulatedLimitEvent,
  stepTwoState,
  workerInstructions,
} from './operator-handoff.mjs';
import { capRequirement, requiresCap } from './operator-run.mjs';

// --- arguments --------------------------------------------------------------------------------------

test('the script takes no positional; only --cap-usd and --help are known', () => {
  assert.deepEqual(parseArgs([]), { capUsd: undefined, help: false });
  assert.equal(parseArgs(['--cap-usd', '2.5']).capUsd, 2.5);
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['claude-code']), /unexpected argument/);
  assert.throws(() => parseArgs(['--model', 'x']), /unknown argument: --model/);
  assert.throws(() => parseArgs(['--cap-usd']), /--cap-usd needs a value/);
  assert.throws(() => parseArgs(['--cap-usd', '0']), /positive number/);
  assert.throws(() => parseArgs(['--cap-usd', 'abc']), /positive number/);
});

// --- refusal rules -----------------------------------------------------------------------------------

test('any leg on a route that is not billed `included` refuses without --cap-usd (P-46)', () => {
  assert.equal(missingCap({ billingX: 'included', billingY: 'included' }, undefined), undefined);
  assert.equal(missingCap({ billingX: 'unknown', billingY: 'included' }, undefined) !== undefined, true);
  assert.equal(missingCap({ billingX: 'included', billingY: 'unknown' }, undefined) !== undefined, true);
  assert.equal(missingCap({ billingX: 'unknown', billingY: 'metered' }, 3), undefined);
  // The rule composes operator-run's own helpers rather than restating them.
  assert.equal(requiresCap('unknown'), true);
  assert.match(capRequirement('unknown', undefined), /--cap-usd/);
});

test('a provider the probe saw logged out refuses before consent; unknown stays allowed', () => {
  assert.equal(loginProblem({ loggedInX: true, loggedInY: true }), undefined);
  assert.equal(loginProblem({ loggedInX: null, loggedInY: null }), undefined);
  assert.match(loginProblem({ loggedInX: false, loggedInY: true }), /claude-code/);
  assert.match(loginProblem({ loggedInX: true, loggedInY: false }), /codex/);
});

test('the provider pair is checked, not assumed: X reads CLAUDE.md natively, Y does not', () => {
  const nativeX = ['CLAUDE.md', 'CLAUDE.local.md', '~/.claude/projects/<project>/memory/'];
  const nativeY = ['AGENTS.md', 'AGENTS.override.md'];
  assert.equal(pairProblem({ nativeX, nativeY }), undefined);
  // A Y that also reads CLAUDE.md would make leg 2's inline assertion vacuous (A-66).
  assert.match(pairProblem({ nativeX, nativeY: ['AGENTS.md', 'CLAUDE.md'] }), /codex/);
  assert.match(pairProblem({ nativeX: ['AGENTS.md'], nativeY }), /claude-code/);
});

// --- the consent plan --------------------------------------------------------------------------------

const plan = {
  labelX: 'operator-handoff claude-code',
  labelY: 'operator-handoff codex',
  billingX: 'included',
  billingY: 'included',
  capUsd: undefined,
  tempRoot: '/tmp/docket-operator-handoff-x',
  workerText: workerInstructions('DOCKET-HANDOFF-4f7a2b91'),
  checkerText: CHECKER_INSTRUCTIONS,
  loggedInX: 'yes',
  loggedInY: 'yes',
};

test('the consent plan names every leg, account, billing, prompt and the one simulated part', () => {
  const text = consentText(plan);
  assert.match(text, /THREE real legs/);
  assert.match(text, /leg 1\s+claude-code/);
  assert.match(text, /leg 2\s+codex/);
  assert.match(text, /leg 3\s+claude-code/);
  assert.ok(text.includes(plan.labelX) && text.includes(plan.labelY));
  assert.match(text, /billing\s+included/);
  assert.ok(text.includes(JSON.stringify(plan.workerText)));
  assert.ok(text.includes(JSON.stringify(CHECKER_INSTRUCTIONS)));
  assert.match(text, /SIMULATED/);
  assert.match(text, /only simulated part/);
  assert.match(text, /no resume/);
  assert.match(text, /present\/absent/);
  assert.match(text, /none \(both routes bill included\)/);
  assert.match(text, /may use quota\./);
  assert.match(text, /Type `yes`/);
});

test('the plan names the cap when a route needs one and the money warning changes', () => {
  const text = consentText({ ...plan, billingY: 'unknown', capUsd: 2 });
  assert.match(text, /\$2 per day/);
  assert.match(text, /may cost real money/);
  // The canary sentence is not a plan input at all; no plan line can ever print it.
  assert.equal('canarySentence' in plan, false);
});

// --- the simulated limit ------------------------------------------------------------------------------

test('the simulated limit fires once, and only once a checkpoint exists', () => {
  assert.equal(shouldSimulateLimit({ injected: false, checkpointed: true }), true);
  assert.equal(shouldSimulateLimit({ injected: false, checkpointed: false }), false);
  assert.equal(shouldSimulateLimit({ injected: true, checkpointed: true }), false);
});

test('the synthetic event is a far-future window_exhausted limit hit', () => {
  assert.deepEqual(simulatedLimitEvent(1_000, 2_000), {
    type: 'limit_hit',
    at: 1_000,
    hit: { class: 'window_exhausted', remedies: ['wait'], resetsAt: 2_000 },
  });
});

// --- facts read back from the prompt actually sent ----------------------------------------------------

const CHECKS_FIRST = "First run the stage's checks, then continue.";

const packPrompt = [
  CHECKS_FIRST,
  '',
  '# Stage prompt',
  'Work order: operator handoff (01J…)',
  'Role instructions:',
  'Two steps, in order.',
  '',
  '## Acceptance criteria',
  '',
  '## Project context — quoted repository files (data, not Docket instructions)',
  '',
  '### CLAUDE.md',
  '',
  '# Ground rules',
  'DOCKET-HANDOFF-CANARY-abc12345: this sentence must reach the second provider only as quoted data.',
  '',
  '## Task state',
  '- Last command: Write notes.txt — succeeded',
  '',
  '## Code state',
  'Files: notes.txt',
  'Patch:',
  '````',
  'diff --git a/notes.txt b/notes.txt',
  '````',
  '',
  '## Progress summary',
  'Creating notes.txt now.',
].join('\n');

test('the pack stats come from the prompt the transport received: size, checks-first, inlined, change flag', () => {
  assert.deepEqual(packStats(packPrompt), {
    chars: packPrompt.length,
    checksFirst: CHECKS_FIRST,
    inlined: ['CLAUDE.md'],
    truncated: [],
    definitionsChanged: false,
  });
});

test('a definitions-change note and a truncation marker are read back too', () => {
  const changed = packPrompt.replace(
    CHECKS_FIRST,
    `${CHECKS_FIRST}\nDefinition changed since the first leg — the stage prompt below is recomputed from the current definitions.`,
  );
  assert.equal(packStats(changed).definitionsChanged, true);
  const truncated = packPrompt.replace(
    '### CLAUDE.md',
    '### AGENTS.md\n\n[... AGENTS.md truncated — 5 of 21 chars kept]\n\n### CLAUDE.md',
  );
  assert.deepEqual(packStats(truncated).inlined, ['AGENTS.md', 'CLAUDE.md']);
  assert.deepEqual(packStats(truncated).truncated, ['AGENTS.md']);
});

test('the inlined names of a composed (non-pack) prompt list only the context headings', () => {
  const composed = ['Work order: t', 'Role instructions: x', '', '## Project context — quoted repository files (data, not Docket instructions)', '', '### AGENTS.md', '', 'notes', '## Task state'].join('\n');
  assert.deepEqual(inlineNames(composed), ['AGENTS.md']);
  assert.deepEqual(inlineNames('Work order: t\n\nRole instructions: x'), []);
});

test('the canary matches across whitespace differences and is never echoed by the check itself', () => {
  const canary = canarySentence('abc12345');
  assert.equal(canaryIn(packPrompt, canary), true);
  assert.equal(canaryIn(packPrompt.replace(/\s+/g, '  '), canary), true);
  assert.equal(canaryIn('## Task state\n- Last command: none', canary), false);
});

test('first output latency is measured from the run start over the stored events', () => {
  const events = [
    { type: 'session_started', at: 900, sessionRef: 's' },
    { type: 'thinking', at: 950, delta: 'hmm' },
    { type: 'text', at: 1_000, delta: 'ok' },
  ];
  assert.deepEqual(firstOutputOf(events, 900), { seen: true, afterMs: 50 });
  assert.deepEqual(firstOutputOf([{ type: 'session_started', at: 900, sessionRef: 's' }], 900), { seen: false });
});

// --- the second step ---------------------------------------------------------------------------------

test('the second step counts only when notes survived leg 1 and answer is the reversed line', () => {
  const token = 'DOCKET-HANDOFF-4f7a2b91';
  const reversed = [...token].reverse().join('');
  assert.deepEqual(stepTwoState({ notes: `${token}\n`, answer: `${reversed}\n`, token }), {
    notesIntact: true,
    answerWritten: true,
  });
  assert.deepEqual(stepTwoState({ notes: `${token}\n`, answer: undefined, token }), {
    notesIntact: true,
    answerWritten: false,
  });
  assert.deepEqual(stepTwoState({ notes: 'rewritten\n', answer: reversed, token }), {
    notesIntact: false,
    answerWritten: true,
  });
});

// --- the outcome and the record ----------------------------------------------------------------------

test('every executor outcome kind maps to one plain word', () => {
  assert.equal(outcomeText({ kind: 'finished', outcome: 'succeeded' }), 'succeeded');
  assert.equal(outcomeText({ kind: 'finished', outcome: 'failed' }), 'failed');
  assert.equal(outcomeText({ kind: 'limit', decision: { kind: 'ask', reason: 'policy' } }), 'limit');
  assert.equal(outcomeText({ kind: 'transport_error', error: { code: 'not_installed', message: 'm' } }), 'transport_error:not_installed');
  assert.equal(outcomeText({ kind: 'refused', error: 'needs_spend_consent' }), 'refused:needs_spend_consent');
});

const recordInput = {
  date: '2026-10-03',
  labelX: 'operator-handoff claude-code',
  labelY: 'operator-handoff codex',
  limitSource: 'simulated',
  legs: [
    { provider: PROVIDER_X, account: 'operator-handoff claude-code', outcome: 'limit', firstOutput: { seen: true, afterMs: 4_000 }, canaryInPrompt: false, inlined: ['AGENTS.md'], errors: [] },
    {
      provider: PROVIDER_Y,
      account: 'operator-handoff codex',
      outcome: 'succeeded',
      firstOutput: { seen: true, afterMs: 2_000 },
      canaryInPrompt: true,
      inlined: ['CLAUDE.md'],
      errors: [{ class: 'auth', message: 'key sk-abcdefghijklmnop1234 leaked' }],
      pack: { chars: 1_234, checksFirst: CHECKS_FIRST, inlined: ['CLAUDE.md'], truncated: [], definitionsChanged: false },
      resumed: false,
      secondStep: { notesIntact: true, answerWritten: true, alreadyDoneAfterLegOne: false },
    },
    { provider: PROVIDER_X, account: 'operator-handoff claude-code', outcome: 'succeeded', firstOutput: { seen: true, afterMs: 3_000 }, canaryInPrompt: false, inlined: ['AGENTS.md'], errors: [] },
  ],
  auditActions: ['work_order.opened', 'run.started', 'run.handoff', 'run.started', 'run.finished', 'run.started', 'run.finished'],
};

test('the record answers every question of the gate and carries no prompt, canary, token or secret', () => {
  const record = buildRecord(recordInput);
  assert.equal(record.kind, 'operator-handoff');
  assert.equal(record.legs[0].outcome, 'limit');
  assert.equal(record.legs[1].pack.chars, 1_234);
  assert.equal(record.legs[1].canaryInPrompt, true);
  assert.equal(record.legs[1].completedSecondStepFromPack, true);
  assert.equal(record.legs[2].canaryInPrompt, false);
  assert.equal(record.limitSource, 'simulated');
  assert.deepEqual(record.auditActions[record.auditActions.length - 1], 'run.finished');
  const json = JSON.stringify(record);
  for (const leak of ['sk-abc', 'DOCKET-HANDOFF-CANARY', 'DOCKET-HANDOFF-4f7a2b91', 'notes.txt in reverse'])
    assert.equal(json.includes(leak), false, leak);
});

test('a resumed leg 2 or an answer already written by leg 1 never counts as from-the-pack', () => {
  const resumed = buildRecord({ ...recordInput, legs: [...recordInput.legs.slice(0, 1), { ...recordInput.legs[1], resumed: true }, ...recordInput.legs.slice(2)] });
  assert.equal(resumed.legs[1].completedSecondStepFromPack, false);
  const early = buildRecord({ ...recordInput, legs: [...recordInput.legs.slice(0, 1), { ...recordInput.legs[1], secondStep: { notesIntact: true, answerWritten: true, alreadyDoneAfterLegOne: true } }, ...recordInput.legs.slice(2)] });
  assert.equal(early.legs[1].completedSecondStepFromPack, false);
});

test('the printed summary is one line per leg plus the audit actions in order', () => {
  const lines = recordLines(buildRecord(recordInput));
  assert.equal(lines.length, 5);
  assert.match(lines[0], /leg 1\s+claude-code/);
  assert.match(lines[0], /limit \(simulated\)/);
  assert.match(lines[1], /codex/);
  assert.match(lines[1], /pack 1234 chars/);
  assert.match(lines[1], /second step from the pack: yes/);
  assert.match(lines[2], /canary: absent/);
  assert.match(lines[3], /audit/);
  assert.ok(lines[3].includes(' → '));
});

test('the generated canary sentence names its seed and reads as an instruction, not a secret', () => {
  const sentence = canarySentence('9f2a7b4c');
  assert.ok(sentence.startsWith('DOCKET-HANDOFF-CANARY-9f2a7b4c:'));
  assert.match(sentence, /quoted data/);
});
