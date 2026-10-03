// e2e/layout-rules.test.mjs — the size plan's pure logic, proven without Electron. Run:
// npm run test:e2e-sizes (node:test; not part of vitest, which covers src/ and electron/ only).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  comboPlan,
  L12_MARK_SETS,
  l12BadgeFailures,
  L13_KNOWN_STANDINGS,
  matchProblemText,
  problemLabelEntries,
  RULE_IDS,
  SKELETON_HEIGHT_TOLERANCE_PX,
  SIZE_PLAN,
  skeletonVerdict,
  resolveSizes,
  sizeFromPlan,
  sizesForWorkArea,
} from './layout-rules.mjs';

test('the plan holds three named sizes, full screen being the display itself', () => {
  assert.deepEqual(
    SIZE_PLAN.map(({ name }) => name),
    ['minimum', 'default', 'fullscreen'],
  );
  assert.deepEqual(SIZE_PLAN[0].size, [1024, 640]);
  assert.deepEqual(SIZE_PLAN[1].size, [1152, 720]);
  assert.equal(SIZE_PLAN[2].size, 'display');
});

test('a number size passes through unchanged on a display that can hold it', () => {
  assert.deepEqual(sizeFromPlan([1024, 640], { width: 1512, height: 920 }), [1024, 640]);
  assert.deepEqual(sizeFromPlan([1152, 720], { width: 2560, height: 1440 }), [1152, 720]);
});

test("'display' resolves to the work area itself", () => {
  assert.deepEqual(sizeFromPlan('display', { width: 1512, height: 920 }), [1512, 920]);
});

test('every size is clamped down to a work area smaller than it', () => {
  const tiny = { width: 1000, height: 600 };
  assert.deepEqual(sizeFromPlan([1024, 640], tiny), [1000, 600]);
  assert.deepEqual(sizeFromPlan([1152, 720], tiny), [1000, 600]);
  assert.deepEqual(sizeFromPlan('display', tiny), [1000, 600]);
});

test('sizesForWorkArea pairs each plan name with its concrete size', () => {
  assert.deepEqual(sizesForWorkArea({ width: 1920, height: 1080 }), [
    { name: 'minimum', size: [1024, 640] },
    { name: 'default', size: [1152, 720] },
    { name: 'fullscreen', size: [1920, 1080] },
  ]);
});

test('resolveSizes reads the primary display through the app and resolves the plan', async () => {
  // A stand-in for the Playwright electron handle: `evaluate` hands the main-process electron
  // module to the callback, exactly as the real one does.
  const fakeApp = {
    evaluate: (fn) => fn({ screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1512, height: 920 } }) } }),
  };
  assert.deepEqual(await resolveSizes(fakeApp), [
    { name: 'minimum', size: [1024, 640] },
    { name: 'default', size: [1152, 720] },
    { name: 'fullscreen', size: [1512, 920] },
  ]);
});

test('the default combination plan is exactly the four, in the fixed order', () => {
  assert.deepEqual(comboPlan(sizesForWorkArea({ width: 1512, height: 920 })), [
    { size: { name: 'minimum', size: [1024, 640] }, theme: 'dark' },
    { size: { name: 'default', size: [1152, 720] }, theme: 'dark' },
    { size: { name: 'default', size: [1152, 720] }, theme: 'light' },
    { size: { name: 'fullscreen', size: [1512, 920] }, theme: 'dark' },
  ]);
});

test('the full combination plan restores all six, dark sizes first then light', () => {
  const plan = comboPlan(sizesForWorkArea({ width: 1920, height: 1080 }), { full: true });
  assert.deepEqual(
    plan.map(({ size, theme }) => [size.name, theme]),
    [
      ['minimum', 'dark'],
      ['default', 'dark'],
      ['fullscreen', 'dark'],
      ['minimum', 'light'],
      ['default', 'light'],
      ['fullscreen', 'light'],
    ],
  );
});

test('the combination plan carries the concrete resolved sizes through', () => {
  for (const { size } of comboPlan(sizesForWorkArea({ width: 1280, height: 800 }))) {
    assert.equal(size.size[0] <= 1280, true);
    assert.equal(size.size[1] <= 800, true);
  }
});

// --- L-13's problem-text matching ---------------------------------------------------------------------

test('L-13 is the walk’s thirteenth rule and its known standings name only real screens', () => {
  assert.equal(RULE_IDS.at(-1), 'L-13');
  for (const screen of Object.keys(L13_KNOWN_STANDINGS)) {
    assert.equal(['kokpit', 'pano', 'liste', 'detay', 'yol-haritasi', 'hesap'].includes(screen), true);
  }
});

test('problemLabelEntries keys the texts off the bundles’ error.* keys alone', () => {
  const tr = { 'error.not_found': 'Kayıt bulunamadı.', 'cockpit.error.stale': 'eski', 'nav.cockpit': 'Kokpit' };
  const en = { 'error.not_found': 'The record was not found.', 'nav.cockpit': 'Cockpit' };
  assert.deepEqual(problemLabelEntries(tr, en), [
    { key: 'error.not_found', tr: 'Kayıt bulunamadı.', en: 'The record was not found.' },
  ]);
});

test('a key the en bundle misses falls back to its tr copy', () => {
  const entries = problemLabelEntries({ 'error.stale': 'eski' }, {});
  assert.deepEqual(entries, [{ key: 'error.stale', tr: 'eski', en: 'eski' }]);
});

test('matchProblemText answers the entry whose tr or en copy the text equals', () => {
  const entries = problemLabelEntries(
    { 'error.not_found': 'Kayıt bulunamadı.', 'error.stale': 'eski' },
    { 'error.not_found': 'The record was not found.' },
  );
  assert.equal(matchProblemText('Kayıt bulunamadı.', entries)?.key, 'error.not_found');
  assert.equal(matchProblemText('The record was not found.', entries)?.key, 'error.not_found');
  assert.equal(matchProblemText('eski', entries)?.key, 'error.stale');
});

test('matchProblemText takes exact equality only — a wrapped or decorated copy is not a hit', () => {
  const entries = problemLabelEntries({ 'error.not_found': 'Kayıt bulunamadı.' }, {});
  assert.equal(matchProblemText('Kayıt bulunamadı', entries), null);
  assert.equal(matchProblemText('— Kayıt bulunamadı.', entries), null);
  assert.equal(matchProblemText('Kayıt bulunamadı. ', entries)?.key, 'error.not_found');
  assert.equal(matchProblemText('', entries), null);
});

test('the real bundles carry error.* copy in both locales for the walk to key off', async () => {
  const { TR } = await import('../src/presentation/labels/tr.ts');
  const { EN } = await import('../src/presentation/labels/en.ts');
  const entries = problemLabelEntries(TR, EN);
  assert.equal(entries.length > 0, true);
  for (const entry of entries) {
    assert.equal(typeof entry.tr, 'string');
    assert.equal(typeof entry.en, 'string');
  }
  assert.equal(matchProblemText('Kayıt bulunamadı.', entries)?.key, 'error.not_found');
  assert.equal(matchProblemText('The record was not found.', entries)?.key, 'error.not_found');
});

test('the skeleton verdict wants at least one composition, all contained, holders still', () => {
  const measured = [{ blocks: 7, holderHeight: 480, insideHolder: true, contained: true }];
  assert.equal(skeletonVerdict([], [480]).ok, false);
  assert.equal(skeletonVerdict(measured, []).ok, false);
  const stray = [{ blocks: 2, holderHeight: 100, insideHolder: false, contained: true }];
  assert.equal(skeletonVerdict(stray, [100]).ok, false);
});

test('the skeleton verdict holds the holder still within the tolerance', () => {
  const before = [{ blocks: 7, holderHeight: 480, insideHolder: true, contained: true }];
  const ok = skeletonVerdict(before, [480 + SKELETON_HEIGHT_TOLERANCE_PX]);
  assert.equal(ok.ok, true);
  assert.match(ok.detail, /holder Δ 8\.0px/);
  const moved = skeletonVerdict(before, [480 + SKELETON_HEIGHT_TOLERANCE_PX + 0.5]);
  assert.equal(moved.ok, false);
  assert.match(moved.detail, /moved 8\.5px/);
});

// --- L-12's badge verdict -----------------------------------------------------------------------------

test("L-12: a marked provider's badge drawing its path passes", () => {
  const verdict = l12BadgeFailures(
    { provider: 'codex', path: 'M8.086.457', neutral: false, outsideRow: false },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, []);
});

test("L-12: a marked provider's badge drawing the neutral glyph fails", () => {
  const verdict = l12BadgeFailures(
    { provider: 'codex', path: '', neutral: true, outsideRow: false },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, ['marked provider codex drew the neutral glyph']);
});

test("L-12: a marked provider's badge drawing no path at all fails", () => {
  const verdict = l12BadgeFailures(
    { provider: 'claude-code', path: '   ', neutral: false, outsideRow: false },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, ['marked provider claude-code drew no mark path']);
});

test("L-12: a markless provider's badge drawing the neutral glyph passes", () => {
  const verdict = l12BadgeFailures(
    { provider: 'kimi', path: '', neutral: true, outsideRow: false },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, []);
});

test("L-12: a markless provider's badge drawing a path fails", () => {
  const verdict = l12BadgeFailures(
    { provider: 'amp', path: 'M0 0', neutral: true, outsideRow: false },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, ['markless provider amp drew a path it does not own']);
});

test('L-12: a badge outside its row fails', () => {
  const verdict = l12BadgeFailures(
    { provider: 'codex', path: 'M8.086.457', neutral: false, outsideRow: true },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, ['badge outside its row']);
});

test("L-12: a badge whose id is in neither mark set fails as an unknown provider id in the audit seed", () => {
  const verdict = l12BadgeFailures(
    { provider: 'gemini', path: 'M0 0', neutral: false, outsideRow: false },
    L12_MARK_SETS,
  );
  assert.deepEqual(verdict, ['unknown provider id in the audit seed: gemini']);
  // A badge carrying no id at all is the same defect, named for what it carries.
  const bare = l12BadgeFailures({ provider: '', path: '', neutral: true, outsideRow: false }, L12_MARK_SETS);
  assert.deepEqual(bare, ['unknown provider id in the audit seed: (no id)']);
});

test("L-12: the rule's sets are the shared module's — marked and markless, disjoint", async () => {
  const { MARKED_PROVIDER_IDS, MARKLESS_PROVIDER_IDS } = await import(
    '../src/infrastructure/providers/defs/provider-mark-sets.ts'
  );
  assert.equal(L12_MARK_SETS.marked.size, MARKED_PROVIDER_IDS.length);
  assert.equal(L12_MARK_SETS.nullMark.size, MARKLESS_PROVIDER_IDS.length);
  for (const id of MARKED_PROVIDER_IDS) assert.equal(L12_MARK_SETS.marked.has(id), true);
  for (const id of MARKLESS_PROVIDER_IDS) {
    assert.equal(L12_MARK_SETS.nullMark.has(id), true);
    assert.equal(L12_MARK_SETS.marked.has(id), false);
  }
});
