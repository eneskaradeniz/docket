// Self-test for duplicate rule-id detection and PENDING/RETIRED handling in check-rule-coverage.mjs. Run via
// that script's entrypoint (check:boundaries) or: node --test scripts/check-rule-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkSection, duplicateRuleDefinitionIds } from './check-rule-coverage.mjs';

const INFRA = { name: 'infrastructure', prefix: 'I', doc: 'docs/v2/infrastructure.md', dirs: [] };

test('duplicateRuleDefinitionIds reports the same (added) id twice', () => {
  const fixture = [
    '- **R-1** (added 2026-01-01, #1) first.',
    '- **R-1** (added 2026-01-02, #2) second.',
  ].join('\n');
  assert.deepEqual(duplicateRuleDefinitionIds(fixture), ['R-1']);
});

test('duplicateRuleDefinitionIds ignores amended bullets and distinct ids', () => {
  const fixture = [
    '- **A-1** (added 2026-01-01, #1) first.',
    '- **A-1** (amended 2026-01-02, #2) amendment.',
    '- **A-2** (added 2026-01-01, #3) other.',
  ].join('\n');
  assert.deepEqual(duplicateRuleDefinitionIds(fixture), []);
});

test('duplicateRuleDefinitionIds passes on the real docs tree', () => {
  assert.deepEqual(duplicateRuleDefinitionIds(), []);
});

test('retired id with no test passes', () => {
  const { failures } = checkSection(INFRA, {
    defined: ['I-1', 'I-90'],
    covered: new Set(['I-1']),
    pending: new Map(),
    retired: new Map([['infrastructure:I-90', { issue: '#1057', reason: 'Legacy import removed with its test.' }]]),
  });
  assert.deepEqual(failures, []);
});

test('retired id that also has a test fails', () => {
  const { failures } = checkSection(INFRA, {
    defined: ['I-90'],
    covered: new Set(['I-90']),
    pending: new Map(),
    retired: new Map([['infrastructure:I-90', { issue: '#1057', reason: 'Legacy import removed with its test.' }]]),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /I-90 is listed as retired \(#1057\) but has a test/);
});

test('retired id missing from docs fails', () => {
  const { failures } = checkSection(INFRA, {
    defined: ['I-1'],
    covered: new Set(['I-1']),
    pending: new Map(),
    retired: new Map([['infrastructure:I-90', { issue: '#1057', reason: 'Legacy import removed with its test.' }]]),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /I-90 is listed as retired \(#1057\) but not defined/);
});

test('retired entry without reason fails', () => {
  const { failures } = checkSection(INFRA, {
    defined: ['I-90'],
    covered: new Set(),
    pending: new Map(),
    retired: new Map([['infrastructure:I-90', { issue: '#1057', reason: '   ' }]]),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /I-90 is listed as retired but has no reason/);
});

test('pending id with no test passes and covered pending fails', () => {
  const pending = new Map([['infrastructure:I-99', '#9999']]);
  assert.deepEqual(
    checkSection(INFRA, { defined: ['I-1', 'I-99'], covered: new Set(['I-1']), pending, retired: new Map() }).failures,
    [],
  );
  const coveredPending = checkSection(INFRA, {
    defined: ['I-99'],
    covered: new Set(['I-99']),
    pending,
    retired: new Map(),
  }).failures;
  assert.equal(coveredPending.length, 1);
  assert.match(coveredPending[0], /I-99 is listed as pending \(#9999\) but already has a test/);
});
